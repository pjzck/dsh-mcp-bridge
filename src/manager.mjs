import { randomUUID } from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import { resolveDshCommand, resolveDshHome, resolveModel, readApiKey } from './config.mjs'
import { DshRuntime } from './runtime.mjs'

const DEFAULT_RUN_TIMEOUT_MS = 15 * 60 * 1000
const WAIT_SLICE_MS = 30_000

/**
 * Owns the SDK runtimes and the MCP-level run records. One runtime per
 * (cwd, provider, model) keeps session directories and model routes stable
 * without restarting a runtime when the caller switches workspace.
 */
export class DshManager {
  constructor(env = process.env) {
    this.env = env
    this.runtimes = new Map()
    /** @type {Map<string, any>} */
    this.runs = new Map()
  }

  #runtimeKey({ cwd, provider, model }) {
    return `${cwd}\n${provider}\n${model}`
  }

  async #ensureRuntime({ cwd, provider, model }) {
    const key = this.#runtimeKey({ cwd, provider, model })
    const existing = this.runtimes.get(key)
    if (existing && !existing.exited) return existing
    const runtime = new DshRuntime({
      cwd,
      provider,
      model,
      command: resolveDshCommand(this.env),
      env: this.env,
    })
    try {
      await runtime.start()
    } catch (error) {
      await runtime.kill()
      throw error
    }
    this.runtimes.set(key, runtime)
    return runtime
  }

  async #resolveCwd(input) {
    const absolute = path.resolve(input ?? process.cwd())
    const real = await fs.realpath(absolute)
    const stat = await fs.stat(real)
    if (!stat.isDirectory()) throw new Error(`cwd is not a directory: ${real}`)
    return real
  }

  /**
   * Queue one task and return immediately.
   * @param {object} input
   * @param {string} input.task
   * @param {string} [input.cwd]
   * @param {string} [input.sessionId]
   * @param {string} [input.provider]
   * @param {string} [input.model]
   */
  async start({ task, cwd, sessionId, provider, model }) {
    const text = task?.trim()
    if (!text) throw new Error('task must not be empty')
    if (text.length > 100_000) throw new Error('task exceeds the 100,000 character limit')
    const resolvedCwd = await this.#resolveCwd(cwd)
    const defaults = resolveModel(this.env)
    const route = {
      provider: provider?.trim() || defaults.provider,
      model: model?.trim() || defaults.model,
    }
    if (!route.provider || !route.model) throw new Error('provider and model must not be empty')

    const requested = sessionId?.trim()
    if (requested) {
      const existing = this.runs.get(requested)
      if (existing?.status === 'running') throw new Error(`session already has an active run: ${requested}`)
    }
    const activeSession = requested || `session-${randomUUID()}`

    const runtime = await this.#ensureRuntime({ cwd: resolvedCwd, ...route })
    if (requested && !runtime.hasSession(activeSession)) {
      // A caller-supplied id names a persisted session; the SDK runtime must
      // restore it rather than create a fresh empty one with the same id.
      await runtime.resume(activeSession)
    }
    const baselineSeq = runtime.baseline(activeSession)
    const { messageId } = await runtime.prompt(activeSession, text)
    const run = {
      sessionId: activeSession,
      cwd: resolvedCwd,
      provider: route.provider,
      model: route.model,
      baselineSeq,
      messageId,
      startedAt: new Date().toISOString(),
      finishedAt: undefined,
      status: 'running',
      runtime,
      last: undefined,
      error: undefined,
    }
    this.runs.set(activeSession, run)
    return this.#decorate(run, {
      sessionId: activeSession,
      status: 'running',
      assistantText: '',
      toolCalls: [],
      events: [],
    })
  }

  #decorate(run, snapshot, extra = {}) {
    return {
      ...snapshot,
      cwd: run.cwd,
      provider: run.provider,
      model: run.model,
      messageId: run.messageId,
      startedAt: run.startedAt,
      finishedAt: run.finishedAt,
      durationMs: Date.now() - Date.parse(run.startedAt),
      ...extra,
    }
  }

  /**
   * Wait for a run's current turn to settle. A timeout leaves the turn running
   * and returns the partial view; call again to keep waiting.
   * @param {string} sessionId
   * @param {number} [timeoutMs]
   */
  async wait(sessionId, timeoutMs = WAIT_SLICE_MS) {
    const run = this.runs.get(sessionId)
    if (!run) throw new Error(`unknown session: ${sessionId}`)
    const budget = Math.max(1, Math.min(timeoutMs, WAIT_SLICE_MS))
    if (run.status !== 'running') {
      return this.#decorate(run, run.last ?? { sessionId, status: run.status, assistantText: '', toolCalls: [], events: [] })
    }
    try {
      const settled = await run.runtime.wait(sessionId, budget)
      const snapshot = run.runtime.snapshot(sessionId, run.baselineSeq)
      if (settled || snapshot.status !== 'running') {
        run.status = snapshot.status
        run.last = snapshot
        if (snapshot.status !== 'running') run.finishedAt = new Date().toISOString()
      }
      return this.#decorate(run, snapshot, settled ? {} : { timedOut: snapshot.status === 'running' })
    } catch (error) {
      run.status = 'error'
      run.error = error instanceof Error ? error.message : String(error)
      run.finishedAt = new Date().toISOString()
      const snapshot = {
        sessionId,
        status: 'error',
        assistantText: '',
        toolCalls: [],
        events: [],
        error: { message: run.error },
      }
      run.last = snapshot
      return this.#decorate(run, snapshot)
    }
  }

  /**
   * Queue and wait in one call, in 30-second slices so a long task remains
   * observable and a client-side timeout can be retried with dsh_wait.
   * @param {object} input
   * @param {number} [input.timeoutMs]
   */
  async run({ timeoutMs = DEFAULT_RUN_TIMEOUT_MS, ...input }) {
    const first = await this.start(input)
    const deadline = Date.now() + Math.max(1, timeoutMs)
    let snapshot = first
    while (snapshot.status === 'running') {
      const remaining = deadline - Date.now()
      if (remaining <= 0) {
        return { ...snapshot, timedOut: true, note: `still running; call dsh_wait with sessionId ${snapshot.sessionId}` }
      }
      snapshot = await this.wait(snapshot.sessionId, Math.min(WAIT_SLICE_MS, remaining))
    }
    return snapshot
  }

  get(sessionId) {
    const run = this.runs.get(sessionId)
    if (!run) throw new Error(`unknown session: ${sessionId}`)
    if (run.status === 'running') {
      const snapshot = run.runtime.snapshot(sessionId, run.baselineSeq)
      if (snapshot.status !== 'running') {
        run.status = snapshot.status
        run.last = snapshot
        run.finishedAt = new Date().toISOString()
      }
      return this.#decorate(run, snapshot)
    }
    return this.#decorate(run, run.last ?? { sessionId, status: run.status, assistantText: '', toolCalls: [], events: [] })
  }

  list() {
    return [...this.runs.values()]
      .sort((a, b) => Date.parse(b.startedAt) - Date.parse(a.startedAt))
      .slice(0, 50)
      .map((run) => ({
        sessionId: run.sessionId,
        cwd: run.cwd,
        provider: run.provider,
        model: run.model,
        status: run.status,
        startedAt: run.startedAt,
        finishedAt: run.finishedAt,
        assistantText: (run.last?.assistantText ?? '').slice(0, 1_000),
      }))
  }

  info() {
    return {
      dshCommand: resolveDshCommand(this.env),
      dshHome: resolveDshHome(this.env),
      apiKeyAvailable: Boolean(readApiKey(resolveDshHome(this.env), this.env)),
      defaultRoute: resolveModel(this.env),
      runtimes: [...this.runtimes.entries()].map(([key, runtime]) => ({
        key,
        cwd: runtime.cwd,
        provider: runtime.provider,
        model: runtime.model,
        pid: runtime.child?.pid ?? null,
        exited: runtime.exited,
        initialized: runtime.initialized,
        sessions: [...runtime.sessions],
      })),
      runs: this.list(),
    }
  }

  async shutdown() {
    const runtimes = [...this.runtimes.values()]
    this.runtimes.clear()
    await Promise.allSettled(runtimes.map((runtime) => runtime.shutdown()))
    for (const run of this.runs.values()) {
      if (run.status === 'running') {
        run.status = 'stopped'
        run.finishedAt = new Date().toISOString()
      }
    }
  }
}
