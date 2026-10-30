import { randomUUID } from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import { resolveDshCommand, resolveDshHome, resolveModel, readApiKey, resolvePermissionMode } from './config.mjs'
import { DshRuntime } from './runtime.mjs'
import { iso } from './run-state.mjs'
import { buildStatusLine, formatDuration } from './status-line.mjs'
import { createStatusPublisher, sanitizeRun } from './status-publisher.mjs'

const DEFAULT_RUN_TIMEOUT_MS = 15 * 60 * 1000
const WAIT_SLICE_MS = 30_000
const PUBLISH_THROTTLE_MS = 750

/**
 * Owns the SDK runtimes and the MCP-level run records. One runtime per
 * (cwd, provider, model) keeps session directories and model routes stable
 * without restarting a runtime when the caller switches workspace.
 */
export class DshManager {
  /**
   * @param {NodeJS.ProcessEnv} env
   * @param {object} [options]
   * @param {(options:any)=>DshRuntime} [options.runtimeFactory]
   * @param {import('./status-publisher.mjs').StatusPublisher | null} [options.statusPublisher]
   * @param {() => number} [options.now]
   * @param {string} [options.bridgeVersion]
   */
  constructor(env = process.env, {
    runtimeFactory,
    statusPublisher,
    now = () => Date.now(),
    bridgeVersion = '0.0.0',
  } = {}) {
    this.env = env
    this.now = now
    this.bridgeVersion = bridgeVersion
    this.runtimeFactory = runtimeFactory ?? ((options) => new DshRuntime(options))
    this.publisher = statusPublisher === undefined
      ? createStatusPublisher(env, { bridgeVersion })
      : statusPublisher
    this.publishTimer = undefined
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
    const runtime = this.runtimeFactory({
      cwd,
      provider,
      model,
      command: resolveDshCommand(this.env),
      env: this.env,
    })
    runtime.onStateChange = () => this.#publishSoon()
    runtime.onRuntimeExit = (failure) => this.#onRuntimeExit(runtime, failure)
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
      // The cached status may be stale: the previous turn may have ended
      // without anyone calling get/wait. Refresh from RunState before refusing
      // a continuation.
      if (existing?.status === 'running') this.#refreshRun(existing)
      if (existing?.status === 'running') throw new Error(`session already has an active run: ${requested}`)
    }
    const activeSession = requested || `session-${randomUUID()}`

    const runtime = await this.#ensureRuntime({ cwd: resolvedCwd, ...route })
    if (requested && !runtime.hasSession(activeSession)) {
      // A caller-supplied id names a persisted session; the SDK runtime must
      // restore it rather than create a fresh empty one with the same id.
      await runtime.resume(activeSession)
    }
    const queuedAtMs = this.now()
    const baselineSeq = runtime.baseline(activeSession)
    // Arm tracking before the prompt: events may stream back before the
    // session/prompt response resolves.
    const state = runtime.beginRun(activeSession, baselineSeq, queuedAtMs)
    const run = {
      sessionId: activeSession,
      cwd: resolvedCwd,
      provider: route.provider,
      model: route.model,
      baselineSeq,
      messageId: undefined,
      queuedAt: iso(queuedAtMs),
      startedAt: iso(queuedAtMs),
      finishedAt: undefined,
      status: 'running',
      runtime,
      state,
      lastView: undefined,
      last: undefined,
      error: undefined,
      note: undefined,
    }
    this.runs.set(activeSession, run)
    try {
      const { messageId } = await runtime.prompt(activeSession, text)
      run.messageId = messageId
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      state.markError(message, this.now())
      this.#settle(run, 'error', this.now(), { error: message })
      this.#publishSoon()
      throw error
    }
    this.#publishSoon()
    return this.#decorate(run, this.#viewFor(run))
  }

  #viewFor(run) {
    if (run.state !== undefined) return run.state.view(this.now())
    return run.lastView ?? {
      sessionId: run.sessionId,
      status: run.status,
      isRunning: run.status === 'running',
      startedAtMs: Date.parse(run.startedAt),
      finishedAtMs: run.finishedAt === undefined ? undefined : Date.parse(run.finishedAt),
      durationMs: null,
      currentTurn: null,
      currentStep: null,
      currentTool: null,
      currentTools: [],
      toolCalls: [],
      assistantText: '',
      lastEvent: null,
      lastEventAgeMs: null,
      usage: null,
      usageUnavailableReason: 'run has no tracked events',
      turnEnd: undefined,
      events: [],
      recentEvents: [],
    }
  }

  #settle(run, status, finishedAtMs, extra = {}) {
    if (run.status !== 'running') return
    const view = run.state === undefined ? run.lastView : run.state.view(this.now())
    if (view?.startedAtMs !== undefined) run.startedAt = iso(view.startedAtMs)
    run.status = status
    run.finishedAt = iso(finishedAtMs ?? view?.finishedAtMs ?? this.now()) ?? new Date(this.now()).toISOString()
    if (extra.error !== undefined) run.error = extra.error
    if (extra.note !== undefined) run.note = extra.note
    run.lastView = run.state === undefined ? run.lastView : run.state.view(this.now())
    this.#publishSoon()
  }

  #refreshRun(run) {
    if (run.status !== 'running') return
    const view = this.#viewFor(run)
    if (run.runtime?.exited === true && (view.status === 'running' || view.status === 'queued')) {
      const message = 'DSH SDK runtime exited before the turn finished'
      run.state?.markError(message, this.now())
      this.#settle(run, 'error', this.now(), { error: message })
      run.lastView = this.#viewFor(run)
      return
    }
    if (view.status !== 'running' && view.status !== 'queued') {
      this.#settle(run, view.status, view.finishedAtMs)
    }
    run.lastView = this.#viewFor(run)
  }

  #decorate(run, view, extra = {}) {
    const now = this.now()
    const effectiveStartedAt = view.turnStartedAtMs === null || view.turnStartedAtMs === undefined
      ? run.startedAt
      : iso(view.turnStartedAtMs)
    const startedAtMs = Date.parse(effectiveStartedAt)
    const finishedAtMs = run.finishedAt === undefined ? undefined : Date.parse(run.finishedAt)
    const isRunning = run.status === 'running'
    const effectiveEnd = isRunning ? now : (finishedAtMs ?? now)
    const durationMs = Number.isFinite(startedAtMs) ? Math.max(0, effectiveEnd - startedAtMs) : null
    const decorated = {
      ...view,
      status: run.status,
      isRunning,
      cwd: run.cwd,
      provider: run.provider,
      model: run.model,
      messageId: run.messageId,
      queuedAt: run.queuedAt,
      startedAt: effectiveStartedAt,
      finishedAt: run.finishedAt ?? null,
      durationMs,
      eventCount: view.eventsSeen,
      ...(run.error === undefined ? {} : { error: { message: run.error } }),
      ...(run.note === undefined ? {} : { note: run.note }),
      ...extra,
    }
    decorated.statusLine = buildStatusLine(decorated)
    return decorated
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
    this.#refreshRun(run)
    if (run.status !== 'running') {
      return this.#decorate(run, this.#viewFor(run))
    }
    try {
      const settled = await run.runtime.wait(sessionId, budget)
      this.#refreshRun(run)
      if (settled && run.status === 'running') {
        // session/wait says the session is idle but no turn/end arrived. Do not
        // claim success without the turn boundary; finish with an explicit note.
        this.#settle(run, 'incomplete', this.now(), {
          note: 'session/wait reported idle without a turn/end event',
        })
      }
      const view = this.#viewFor(run)
      return this.#decorate(run, view, settled || run.status !== 'running'
        ? {}
        : { timedOut: true })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      run.state?.markError(message, this.now())
      this.#settle(run, 'error', this.now(), { error: message })
      const view = this.#viewFor(run)
      return this.#decorate(run, view)
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
    const deadline = this.now() + Math.max(1, timeoutMs)
    let snapshot = first
    while (snapshot.status === 'running') {
      const remaining = deadline - this.now()
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
    this.#refreshRun(run)
    return this.#decorate(run, this.#viewFor(run))
  }

  #summary(run) {
    this.#refreshRun(run)
    const view = this.#viewFor(run)
    const decorated = this.#decorate(run, view)
    return {
      sessionId: run.sessionId,
      cwd: run.cwd,
      provider: run.provider,
      model: run.model,
      status: run.status,
      isRunning: decorated.isRunning,
      startedAt: decorated.startedAt,
      finishedAt: decorated.finishedAt,
      durationMs: decorated.durationMs,
      statusLine: decorated.statusLine,
      currentStep: decorated.currentStep,
      currentTool: decorated.currentTool,
      currentTools: decorated.currentTools,
      lastEvent: decorated.lastEvent,
      lastEventType: decorated.lastEventType,
      lastEventAgeMs: decorated.lastEventAgeMs,
      silentForMs: decorated.silentForMs,
      usage: decorated.usage,
      usageUnavailableReason: decorated.usageUnavailableReason,
      assistantText: (run.last?.assistantText ?? decorated.assistantText ?? '').slice(0, 1_000),
    }
  }

  list() {
    return [...this.runs.values()]
      .sort((a, b) => Date.parse(b.startedAt) - Date.parse(a.startedAt))
      .slice(0, 50)
      .map((run) => this.#summary(run))
  }

  info() {
    return {
      dshCommand: resolveDshCommand(this.env),
      dshHome: resolveDshHome(this.env),
      apiKeyAvailable: Boolean(readApiKey(resolveDshHome(this.env), this.env)),
      defaultRoute: resolveModel(this.env),
      permissionMode: resolvePermissionMode(this.env),
      statusPublisher: this.publisher === null
        ? { enabled: false }
        : {
            enabled: true,
            dir: this.publisher.dir,
            file: this.publisher.file,
            instanceId: this.publisher.instanceId,
            heartbeatMs: this.publisher.heartbeatMs,
            staleAfterMs: this.publisher.staleAfterMs,
          },
      runtimes: [...this.runtimes.entries()].map(([key, runtime]) => ({
        key,
        cwd: runtime.cwd,
        provider: runtime.provider,
        model: runtime.model,
        pid: runtime.child?.pid ?? null,
        exited: runtime.exited,
        initialized: runtime.initialized,
        permissionMode: runtime.permissionMode,
        sessions: [...runtime.sessions],
      })),
      runs: this.list(),
    }
  }

  #onRuntimeExit(runtime, failure) {
    const message = failure instanceof Error ? failure.message : String(failure)
    for (const run of this.runs.values()) {
      if (run.runtime !== runtime || run.status !== 'running') continue
      run.state?.markError(message, this.now())
      this.#settle(run, 'error', this.now(), { error: message })
      run.lastView = this.#viewFor(run)
    }
    this.#publishSoon()
  }

  #publishSoon() {
    if (this.publisher === null || this.publishTimer !== undefined) return
    this.publishTimer = setTimeout(() => {
      this.publishTimer = undefined
      void this.#publishNow()
    }, PUBLISH_THROTTLE_MS)
    this.publishTimer.unref?.()
  }

  #publicationRuns() {
    return [...this.runs.values()]
      .sort((a, b) => Date.parse(b.startedAt) - Date.parse(a.startedAt))
      .slice(0, 50)
      .map((run) => {
        this.#refreshRun(run)
        const decorated = this.#decorate(run, this.#viewFor(run))
        return sanitizeRun(decorated)
      })
      .filter(Boolean)
  }

  async #publishNow() {
    if (this.publisher === null) return
    const runs = this.#publicationRuns()
    const state = runs.some((run) => run.isRunning) ? 'running' : 'idle'
    try {
      await this.publisher.update({ state, runs, updatedAt: this.now() })
    } catch {
      // Status publication is best-effort and must never fail a task.
    }
  }

  /** Publish one immediate snapshot (used by tests and server startup). */
  async publish() {
    if (this.publishTimer !== undefined) {
      clearTimeout(this.publishTimer)
      this.publishTimer = undefined
    }
    await this.#publishNow()
  }

  async shutdown() {
    const runtimes = [...this.runtimes.values()]
    this.runtimes.clear()
    for (const run of this.runs.values()) {
      if (run.status === 'running') {
        run.state?.markStopped(this.now())
        this.#settle(run, 'stopped', this.now())
        run.lastView = this.#viewFor(run)
      }
    }
    await Promise.allSettled(runtimes.map((runtime) => runtime.shutdown()))
    if (this.publisher !== null) {
      if (this.publishTimer !== undefined) {
        clearTimeout(this.publishTimer)
        this.publishTimer = undefined
      }
      await this.#publishNow()
      await this.publisher.stop()
    }
  }
}

export { formatDuration }
