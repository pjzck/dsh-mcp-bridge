import { spawn, spawnSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { resolveDshCommand } from './config.mjs'

/** A JSON-RPC request that outlived its caller's budget. The runtime keeps working. */
export class RuntimeTimeoutError extends Error {
  constructor(method, timeoutMs) {
    super(`${method} did not answer within ${timeoutMs}ms`)
    this.name = 'RuntimeTimeoutError'
  }
}

/**
 * One configured DSH SDK child process and its newline-delimited JSON-RPC
 * session. The runtime owns the child; disposing it disposes every session in
 * that child.
 */
export class DshRuntime {
  /**
   * @param {object} options
   * @param {string} options.cwd
   * @param {string} options.provider
   * @param {string} options.model
   * @param {string} [options.reasoningEffort]
   * @param {number} [options.maxTokens]
   * @param {string} [options.profile]
   * @param {string[]} [options.patches]
   * @param {object} [options.providerConfig]
   * @param {string} [options.command]
   * @param {NodeJS.ProcessEnv} [options.env]
   */
  constructor({ cwd, provider, model, reasoningEffort, maxTokens, command, profile = 'sdk', patches = [], providerConfig, env = process.env }) {
    this.cwd = cwd
    this.provider = provider
    this.model = model
    this.reasoningEffort = reasoningEffort
    this.maxTokens = maxTokens
    this.command = command ?? resolveDshCommand(env)
    this.env = env
    this.profile = profile
    this.patches = patches
    this.providerConfig = providerConfig
    this.patchDirectory = undefined
    this.child = undefined
    this.initialized = false
    this.exited = false
    this.stderr = ''
    this.buffer = ''
    this.pending = new Map()
    this.nextId = 1
    /** @type {Map<string, any[]>} */
    this.events = new Map()
    /** @type {Map<string, number>} */
    this.lastSeq = new Map()
    /** @type {Map<string, string>} */
    this.status = new Map()
    /** @type {Map<string, any>} */
    this.subagents = new Map()
    /** Sessions this runtime has created or resumed. @type {Set<string>} */
    this.sessions = new Set()
  }

  async start() {
    if (this.child) return this
    const argv = ['--profile', this.profile]
    for (const patch of this.patches) argv.push('--patch', patch)
    if (this.providerConfig) {
      this.patchDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'dsh-mcp-'))
      const patch = path.join(this.patchDirectory, 'provider.json')
      await fs.writeFile(patch, JSON.stringify([{ id: 'llm-deepseek', config: this.providerConfig }]), { mode: 0o600 })
      argv.push('--patch', patch)
    }
    const shell = process.platform === 'win32' && /\.(cmd|bat)$/i.test(this.command)
    // cmd.exe requires explicit quoting for launchers and patch paths containing spaces.
    const quote = (value) => {
      if (/["\r\n%]/.test(value)) throw new Error('Invalid character in Windows DSH launcher argument')
      return `"${value}"`
    }
    const launchCommand = shell ? [this.command, ...argv].map(quote).join(' ') : this.command
    const child = spawn(launchCommand, shell ? [] : argv, {
      cwd: this.cwd,
      env: {
        ...this.env,
        NO_COLOR: '1',
      },
      // Windows `.cmd` launchers are resolved by cmd.exe; the argv contains
      // only launcher flags, never caller text. A POSIX runtime gets its own
      // process group so a stop reaches every descendant.
      shell,
      detached: process.platform !== 'win32',
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe'],
    })
    this.child = child
    child.stdout.setEncoding('utf8')
    child.stderr.setEncoding('utf8')
    child.stdout.on('data', (chunk) => this.#onStdout(chunk))
    child.stderr.on('data', (chunk) => {
      this.stderr = `${this.stderr}${chunk}`.slice(-16_384)
      if (this.env.DSH_MCP_DEBUG === '1') process.stderr.write(`[dsh-sdk] ${chunk}`)
    })
    child.on('error', (error) => this.#onExit(undefined, error))
    child.on('exit', (code, signal) => this.#onExit(code ?? undefined, undefined, signal ?? undefined))
    await this.#initialize()
    return this
  }

  async #initialize() {
    const params = {
      cwd: this.cwd,
      provider: this.provider,
      model: this.model,
      ...(this.reasoningEffort ? { reasoningEffort: this.reasoningEffort } : {}),
      ...(this.maxTokens ? { maxTokens: this.maxTokens } : {}),
    }
    await this.request('initialize', params, 60_000)
    this.initialized = true
  }

  #write(message) {
    if (!this.child || this.exited) throw new Error('DSH runtime is not running')
    this.child.stdin.write(`${JSON.stringify(message)}\n`)
  }

  /**
   * @template T
   * @param {string} method
   * @param {object} params
   * @param {number} timeoutMs
   * @returns {Promise<T>}
   */
  request(method, params, timeoutMs = 60_000) {
    const id = `mcp_${this.nextId++}_${randomUUID().replaceAll('-', '')}`
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id)
        reject(new RuntimeTimeoutError(method, timeoutMs))
      }, timeoutMs)
      this.pending.set(id, {
        resolve: (value) => {
          clearTimeout(timer)
          resolve(value)
        },
        reject: (error) => {
          clearTimeout(timer)
          reject(error)
        },
      })
      try {
        this.#write({ jsonrpc: '2.0', id, method, params })
      } catch (error) {
        clearTimeout(timer)
        this.pending.delete(id)
        reject(error)
      }
    })
  }

  #onStdout(chunk) {
    this.buffer += chunk
    for (;;) {
      const newline = this.buffer.indexOf('\n')
      if (newline < 0) break
      const line = this.buffer.slice(0, newline).trim()
      this.buffer = this.buffer.slice(newline + 1)
      if (!line) continue
      let message
      try {
        message = JSON.parse(line)
      } catch {
        continue
      }
      if (message.id !== undefined && this.pending.has(message.id)) {
        const pending = this.pending.get(message.id)
        this.pending.delete(message.id)
        if (message.error) {
          const error = new Error(message.error.message ?? 'DSH SDK error')
          error.code = message.error.code
          error.data = message.error.data
          pending.reject(error)
        } else {
          pending.resolve(message.result)
        }
        continue
      }
      if (typeof message.method === 'string') this.#onNotification(message.method, message.params ?? {})
    }
  }

  #onNotification(method, params) {
    if (method === 'session.event') {
      const sessionId = params.sessionId
      const event = params.event
      if (typeof sessionId !== 'string' || !event) return
      const list = this.events.get(sessionId) ?? []
      list.push(event)
      if (list.length > 2_000) list.splice(0, list.length - 2_000)
      this.events.set(sessionId, list)
      if (typeof event.seq === 'number') {
        this.lastSeq.set(sessionId, Math.max(this.lastSeq.get(sessionId) ?? -1, event.seq))
      }
      return
    }
    if (method === 'session.status') {
      if (typeof params.sessionId === 'string' && typeof params.status === 'string') {
        this.status.set(params.sessionId, params.status)
      }
      return
    }
    if (method === 'subagent.started') {
      if (typeof params.childSessionId === 'string') this.subagents.set(params.childSessionId, { ...params, state: 'started' })
      return
    }
    if (method === 'subagent.finished') {
      if (typeof params.childSessionId === 'string') this.subagents.set(params.childSessionId, { ...params, state: 'finished' })
    }
  }

  #onExit(code, error, signal) {
    if (this.exited) return
    this.exited = true
    void this.#cleanupPatch()
    const tail = this.stderr.trim().split('\n').slice(-30).join('\n')
    const reason = error
      ? error.message
      : `DSH SDK runtime exited (code ${String(code)}, signal ${String(signal)})`
    const failure = new Error(tail ? `${reason}\n${tail}` : reason)
    for (const pending of this.pending.values()) pending.reject(failure)
    this.pending.clear()
  }

  baseline(sessionId) {
    return this.lastSeq.get(sessionId) ?? -1
  }

  hasSession(sessionId) {
    return this.sessions.has(sessionId)
  }

  async prompt(sessionId, text) {
    const result = await this.request(
      'session/prompt',
      { sessionId, contentBlocks: [{ type: 'text', text }] },
      30_000,
    )
    this.sessions.add(sessionId)
    return result
  }

  async resume(sessionId) {
    const result = await this.request('session/resume', { sessionId }, 60_000)
    this.sessions.add(sessionId)
    return result
  }

  /**
   * Wait for the session to become idle.
   * @returns {Promise<boolean>} false when the caller's budget elapsed first.
   */
  async wait(sessionId, timeoutMs) {
    try {
      await this.request('session/wait', { sessionId }, timeoutMs)
      return true
    } catch (error) {
      if (error instanceof RuntimeTimeoutError) return false
      throw error
    }
  }

  async shutdown() {
    if (!this.child || this.exited) return
    try {
      await this.request('shutdown', {}, 3_000)
    } catch {
      // A dead or wedged child is still killed below.
    }
    await this.kill()
  }

  async #cleanupPatch() {
    const directory = this.patchDirectory
    this.patchDirectory = undefined
    if (directory) await fs.rm(directory, { recursive: true, force: true }).catch(() => {})
  }

  async kill() {
    await this.#cleanupPatch()
    const child = this.child
    if (!child || this.exited || child.exitCode !== null) return
    this.exited = true
    const failure = new Error('DSH runtime was stopped')
    for (const pending of this.pending.values()) pending.reject(failure)
    this.pending.clear()
    if (process.platform === 'win32' && child.pid !== undefined) {
      // `shell: true` inserts cmd.exe between us and the Electron runtime;
      // kill the whole tree so an interrupted MCP session leaves no orphan.
      spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], {
        windowsHide: true,
        stdio: 'ignore',
      })
      return
    }
    try {
      process.kill(-child.pid, 'SIGTERM')
    } catch {
      try {
        child.kill()
      } catch {
        // Already gone.
      }
    }
  }

  /**
   * Project the events committed after `baselineSeq` into a small, stable view.
   * @param {string} sessionId
   * @param {number} baselineSeq
   */
  snapshot(sessionId, baselineSeq) {
    const events = (this.events.get(sessionId) ?? []).filter((event) => (event.seq ?? -1) > baselineSeq)
    const toolCalls = new Map()
    let assistantText = ''
    let lastAssistantSeq = -1
    let turnEnd
    let usage
    for (const event of events) {
      if (event.type === 'assistant/message') {
        const content = event.data?.message?.content
        if (Array.isArray(content)) {
          const text = content
            .filter((block) => block?.type === 'text' && typeof block.text === 'string')
            .map((block) => block.text)
            .join('')
          if (text.trim() !== '' && (event.seq ?? 0) >= lastAssistantSeq) {
            assistantText = text
            lastAssistantSeq = event.seq ?? 0
          }
        }
        continue
      }
      if (event.type === 'tool/call') {
        const data = event.data ?? {}
        toolCalls.set(data.callId ?? `${event.seq}`, {
          name: data.name ?? 'unknown',
          arguments: typeof data.arguments === 'string' && data.arguments.length > 500
            ? `${data.arguments.slice(0, 500)}…`
            : data.arguments,
          status: 'called',
        })
        continue
      }
      if (event.type === 'tool/result') {
        const data = event.data ?? {}
        const key = data.callId
        const current = key === undefined ? undefined : toolCalls.get(key)
        if (current !== undefined) {
          current.status = data.status ?? (data.error ? 'error' : data.ok === false ? 'error' : 'completed')
          if (data.error) current.error = typeof data.error === 'string' ? data.error : data.error.message
        }
        continue
      }
      if (event.type === 'step/end') {
        if (event.data?.usage) usage = event.data.usage
        continue
      }
      if (event.type === 'turn/end') {
        turnEnd = event.data?.reason
      }
    }
    const liveStatus = this.status.get(sessionId)
    let status = 'running'
    if (turnEnd?.kind === 'error') status = 'error'
    else if (turnEnd !== undefined) status = 'succeeded'
    return {
      sessionId,
      status,
      liveStatus: liveStatus ?? 'unknown',
      assistantText,
      toolCalls: [...toolCalls.values()],
      usage,
      turnEnd,
      ...(turnEnd?.kind === 'error' && turnEnd.error
        ? { error: { code: turnEnd.error.code, message: turnEnd.error.message } }
        : {}),
      events: events.slice(-80).map((event) => ({ seq: event.seq, type: event.type })),
      subagents: [...this.subagents.values()].filter((item) => item.parentSessionId === sessionId),
    }
  }
}
