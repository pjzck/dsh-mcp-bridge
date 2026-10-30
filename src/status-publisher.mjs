/**
 * Publishes one compact, sanitized JSON file per bridge process so other DSH
 * plugins can observe SDK tasks without opening a port or sharing a process.
 *
 * - one file per publisher instance, atomic replace via temp file + rename;
 * - no file exists until the first task publishes a non-empty snapshot;
 * - heartbeat only while a run is active (idle processes stop rewriting);
 * - after the first task a graceful shutdown writes a terminal `stopped`
 *   tombstone;
 * - a crashed/hung publisher stops heartbeating, so readers age the file out
 *   instead of showing a stale task as running forever.
 */

import { randomBytes } from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import { resolveDshHome } from './config.mjs'
import { buildStatusLine } from './status-line.mjs'

export const STATUS_SCHEMA_VERSION = 1
export const DEFAULT_HEARTBEAT_MS = 5_000

function clampInt(value, fallback, min, max) {
  const parsed = Number.parseInt(String(value ?? ''), 10)
  if (!Number.isFinite(parsed)) return fallback
  return Math.min(max, Math.max(min, parsed))
}

/** @returns {{disabled:boolean, dir:string, heartbeatMs:number, staleAfterMs:number}} */
export function resolveStatusConfig(env = process.env) {
  const disabled = ['1', 'true', 'yes'].includes(String(env.DSH_MCP_STATUS_DISABLED ?? '').trim().toLowerCase())
  const dir = env.DSH_MCP_STATUS_DIR?.trim() || path.join(resolveDshHome(env), 'storages', 'dsh-run-monitor')
  const heartbeatMs = clampInt(env.DSH_MCP_STATUS_HEARTBEAT_MS, DEFAULT_HEARTBEAT_MS, 1_000, 60_000)
  const staleAfterMs = clampInt(env.DSH_MCP_STATUS_STALE_MS, heartbeatMs * 3, heartbeatMs * 2, 24 * 60 * 60 * 1000)
  return { disabled, dir, heartbeatMs, staleAfterMs }
}

function str(value, limit) {
  return typeof value === 'string' ? value.slice(0, limit) : undefined
}

function num(value) {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function count(value) {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : undefined
}

function positiveCount(value) {
  const parsed = count(value)
  return parsed !== undefined && parsed > 0 ? parsed : undefined
}

function progressOf(value) {
  if (!value || typeof value !== 'object') return undefined
  const out = {}
  for (const key of ['completedSteps', 'toolCalls', 'completedToolCalls']) {
    const parsed = count(value[key])
    if (parsed !== undefined) out[key] = parsed
  }
  return Object.keys(out).length === 0 ? undefined : out
}

function pick(source, keys) {
  const out = {}
  for (const key of keys) {
    if (source[key] !== undefined && source[key] !== null) out[key] = source[key]
  }
  return out
}

/**
 * Keep only fields the panel needs. Tool arguments, prompts, assistant text and
 * result bodies are deliberately absent from the shared status contract.
 */
export function sanitizeRun(run) {
  if (!run || typeof run !== 'object') return undefined
  const out = {}
  const stringKeys = ['sessionId', 'title', 'cwd', 'provider', 'model', 'status', 'statusLine', 'note', 'startedAt', 'finishedAt']
  for (const key of stringKeys) {
    const value = str(run[key], key === 'title' ? 120 : key === 'cwd' ? 500 : key === 'statusLine' ? 600 : key === 'note' ? 200 : 200)
    if (value !== undefined) out[key] = value
  }
  if (typeof run.isRunning === 'boolean') out.isRunning = run.isRunning
  for (const key of ['durationMs', 'lastEventAgeMs', 'silentForMs']) {
    const value = num(run[key])
    if (value !== undefined) out[key] = value
  }
  const currentTurn = count(run.currentTurn)
  if (currentTurn !== undefined) out.currentTurn = currentTurn
  const contextWindow = positiveCount(run.contextWindow)
  if (contextWindow !== undefined) out.contextWindow = contextWindow
  const progress = progressOf(run.progress)
  if (progress !== undefined) out.progress = progress
  if (run.currentStep && typeof run.currentStep === 'object') {
    out.currentStep = pick(run.currentStep, ['turn', 'step', 'startedAt', 'elapsedMs'])
  }
  if (run.lastEvent && typeof run.lastEvent === 'object') {
    out.lastEvent = pick(run.lastEvent, ['seq', 'type', 'time', 'ageMs'])
  }
  if (Array.isArray(run.currentTools)) {
    out.currentTools = run.currentTools
      .slice(0, 20)
      .map((tool) => (tool && typeof tool === 'object' ? pick(tool, ['name', 'callId', 'turn', 'step', 'startedAt', 'elapsedMs']) : undefined))
      .filter(Boolean)
  }
  if (run.usage && typeof run.usage === 'object') {
    const usage = {}
    for (const key of [
      'scope', 'source', 'final', 'complete', 'partial', 'countedSamples', 'attempts', 'steps',
      'expectedSteps', 'stepsWithUsage', 'expectedAttempts', 'attemptsWithUsage',
      'invalidSamples', 'note', 'updatedAt', 'lastEventSeq',
    ]) {
      if (run.usage[key] !== undefined && run.usage[key] !== null) usage[key] = run.usage[key]
    }
    for (const key of [
      'uncachedInputTokens', 'cacheReadTokens', 'cacheWriteTokens', 'outputTokens', 'totalTokens',
    ]) {
      if (run.usage[key] !== undefined) usage[key] = run.usage[key]
    }
    if (Array.isArray(run.usage.missingBuckets)) usage.missingBuckets = run.usage.missingBuckets.slice(0, 4)
    for (const key of ['missingUsageSteps', 'missingUsageAttempts', 'missingBoundaries']) {
      if (Array.isArray(run.usage[key])) {
        usage[key] = run.usage[key].slice(0, 20).map((item) => (item && typeof item === 'object' ? {
          ...pick(item, ['turn', 'step', 'reason']),
        } : undefined)).filter(Boolean)
      }
    }
    if (run.usage.lastSample && typeof run.usage.lastSample === 'object') {
      usage.lastSample = pick(run.usage.lastSample, ['turn', 'step', 'totalTokens', 'at', 'seq'])
    }
    out.usage = usage
  }
  return Object.keys(out).length === 0 ? undefined : out
}

/**
 * Project a running run's clock-derived fields at read/write time. A heartbeat
 * must not replay a cached duration/age from the last state event: a long tool
 * execution with no new events still elapses. Terminal runs keep their frozen
 * values.
 */
export function projectRun(run, now = Date.now()) {
  if (!run || run.isRunning !== true) return run
  const next = { ...run }
  const startedAtMs = Date.parse(run.startedAt)
  if (Number.isFinite(startedAtMs)) next.durationMs = Math.max(0, now - startedAtMs)
  const lastEventTime = run.lastEvent && typeof run.lastEvent === 'object' ? run.lastEvent.time : undefined
  if (typeof lastEventTime === 'number' && Number.isFinite(lastEventTime)) {
    const age = Math.max(0, now - lastEventTime)
    next.lastEventAgeMs = age
    next.silentForMs = age
    next.lastEvent = { ...run.lastEvent, ageMs: age }
  }
  if (next.currentStep && typeof next.currentStep === 'object') {
    const stepStarted = Date.parse(next.currentStep.startedAt)
    if (Number.isFinite(stepStarted)) next.currentStep = { ...next.currentStep, elapsedMs: Math.max(0, now - stepStarted) }
  }
  if (Array.isArray(next.currentTools)) {
    next.currentTools = next.currentTools.map((tool) => {
      const toolStarted = Date.parse(tool.startedAt)
      return Number.isFinite(toolStarted) ? { ...tool, elapsedMs: Math.max(0, now - toolStarted) } : tool
    })
  }
  next.statusLine = buildStatusLine(next)
  return next
}

function defaultInstanceId(pid = process.pid) {
  return `bridge-${pid}-${randomBytes(4).toString('hex')}`
}

export class StatusPublisher {
  /**
   * @param {object} options
   * @param {string} options.dir
   * @param {string} [options.instanceId]
   * @param {number} [options.heartbeatMs]
   * @param {number} [options.staleAfterMs]
   * @param {string} [options.bridgeVersion]
   * @param {() => number} [options.now]
   * @param {(message:string)=>void} [options.log]
   */
  constructor({
    dir,
    instanceId = defaultInstanceId(),
    heartbeatMs = DEFAULT_HEARTBEAT_MS,
    staleAfterMs = heartbeatMs * 3,
    bridgeVersion = '0.0.0',
    now = () => Date.now(),
    log = (message) => console.error(`[dsh-mcp/status] ${message}`),
  }) {
    this.dir = dir
    this.instanceId = instanceId
    this.heartbeatMs = heartbeatMs
    this.staleAfterMs = staleAfterMs
    this.bridgeVersion = bridgeVersion
    this.now = now
    this.log = log
    this.file = path.join(dir, `${instanceId}.json`)
    this.startedAt = now()
    this.state = 'idle'
    this.runs = []
    this.updatedAt = this.startedAt
    this.timer = undefined
    this.queue = Promise.resolve()
    this.closed = false
    /** True after the first non-empty snapshot was written successfully. */
    this.published = false
  }

  async start() {
    await this.#enqueueWrite()
    return this
  }

  /** Replace the published runs. Heartbeats keep rewriting this cached set. */
  update({ state, runs, updatedAt } = {}) {
    if (this.closed) return this.queue
    if (state === 'running' || state === 'idle' || state === 'stopped') this.state = state
    if (Array.isArray(runs)) this.runs = runs
    this.updatedAt = num(updatedAt) ?? this.now()
    this.#syncTimer()
    return this.#enqueueWrite()
  }

  async stop() {
    if (this.closed) return this.queue
    this.closed = true
    this.#clearTimer()
    this.state = 'stopped'
    this.updatedAt = this.now()
    this.runs = this.runs.map((run) => (run.isRunning ? { ...run, status: 'stopped', isRunning: false } : run))
    await this.#enqueueWrite()
    return this.queue
  }

  #syncTimer() {
    if (this.closed) return
    if (this.state === 'running') {
      if (this.timer !== undefined) return
      this.timer = setInterval(() => {
        // Heartbeat is a rewrite of the cached snapshot; it does not rebuild
        // run history.
        this.#enqueueWrite().catch(() => {})
      }, this.heartbeatMs)
      this.timer.unref?.()
    } else {
      this.#clearTimer()
    }
  }

  #clearTimer() {
    if (this.timer !== undefined) {
      clearInterval(this.timer)
      this.timer = undefined
    }
  }

  #enqueueWrite() {
    this.queue = this.queue.then(() => this.#writeNow()).catch((error) => {
      this.log(`status write failed: ${error instanceof Error ? error.message : String(error)}`)
    })
    return this.queue
  }

  payload() {
    const now = this.now()
    return {
      schemaVersion: STATUS_SCHEMA_VERSION,
      kind: 'dsh-run-monitor',
      bridge: {
        instanceId: this.instanceId,
        pid: process.pid,
        version: this.bridgeVersion,
        node: process.version,
        platform: process.platform,
        state: this.state,
        startedAt: new Date(this.startedAt).toISOString(),
        updatedAt: new Date(this.updatedAt).toISOString(),
        heartbeatAt: new Date(now).toISOString(),
        heartbeatIntervalMs: this.heartbeatMs,
        staleAfterMs: this.staleAfterMs,
      },
      runs: this.runs.slice(0, 50).map((run) => projectRun(run, now)),
    }
  }

  async #writeNow() {
    // Before the first task there is no history worth sharing. Writing an
    // empty idle/stopped snapshot here would make every short-lived MCP
    // connection leave a file that only ages into the archive.
    if (!this.published && this.runs.length === 0) return
    const payload = this.payload()
    const text = `${JSON.stringify(payload)}\n`
    await fs.mkdir(this.dir, { recursive: true })
    const tmp = path.join(this.dir, `.${this.instanceId}.json.tmp-${process.pid}-${randomBytes(4).toString('hex')}`)
    try {
      await fs.writeFile(tmp, text, 'utf8')
      await fs.rename(tmp, this.file)
    } catch (error) {
      await fs.unlink(tmp).catch(() => {})
      throw error
    }
    this.published = true
  }
}

/** Resolve config and create a publisher, or `null` when disabled. */
export function createStatusPublisher(env = process.env, { bridgeVersion } = {}) {
  const config = resolveStatusConfig(env)
  if (config.disabled) return null
  return new StatusPublisher({
    dir: config.dir,
    heartbeatMs: config.heartbeatMs,
    staleAfterMs: config.staleAfterMs,
    ...(bridgeVersion === undefined ? {} : { bridgeVersion }),
  })
}
