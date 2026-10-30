/**
 * Host half of the DSH run monitor.
 *
 * Reads the sanitized status files the dsh-mcp-bridge publishes under
 * `$DSH_HOME/storages/dsh-run-monitor` and exposes them through the
 * authenticated Connection fetch registry (`/api/dsh-run-monitor`). It never
 * opens a port and never reads task prompts, tool arguments or credentials.
 */

import { readdir, lstat, readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { basename, join } from 'node:path'

const inject = ['connection']
const API_PATH = '/api/dsh-run-monitor'
const FILE_RE = /^bridge-[A-Za-z0-9._-]+\.json$/
const MAX_FILE_BYTES = 256 * 1024
const MAX_FILES = 64
const MAX_RUNS = 50
const MAX_RUN_AGE_MS = 7 * 24 * 60 * 60 * 1000

function text(value, limit) {
  return typeof value === 'string' ? value.slice(0, limit) : undefined
}

function number(value) {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function count(value) {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : undefined
}

function positiveCount(value) {
  const parsed = count(value)
  return parsed !== undefined && parsed > 0 ? parsed : undefined
}

function sanitizeProgress(value) {
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

function clamp(value, fallback, min, max) {
  return typeof value === 'number' && Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : fallback
}

const STATUS_LABELS = {
  queued: '排队中',
  running: '运行中',
  succeeded: '已完成',
  error: '失败',
  interrupted: '已中断',
  stopped: '已停止',
  incomplete: '已结束（无收尾事件）',
}

function formatDuration(ms) {
  if (typeof ms !== 'number' || !Number.isFinite(ms) || ms < 0) return '未知'
  if (ms < 1_000) return `${Math.round(ms)}ms`
  const seconds = ms / 1_000
  if (seconds < 60) return `${seconds.toFixed(seconds < 10 ? 1 : 0)}s`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ${String(Math.floor(seconds % 60)).padStart(2, '0')}s`
  return `${Math.floor(minutes / 60)}h ${String(minutes % 60).padStart(2, '0')}m`
}

function formatAge(ms) {
  if (typeof ms !== 'number' || !Number.isFinite(ms) || ms < 0) return '未知'
  if (ms < 1_000) return '刚刚'
  if (ms < 60_000) return `${Math.floor(ms / 1_000)}s 前`
  if (ms < 3_600_000) return `${Math.floor(ms / 60_000)}m 前`
  return `${Math.floor(ms / 3_600_000)}h 前`
}

function formatTokens(value) {
  return typeof value === 'number' && Number.isFinite(value) ? value.toLocaleString('en-US') : '未知'
}

/** Rebuild the same Chinese one-line summary the bridge uses. */
function buildLiveStatusLine(run) {
  const parts = [STATUS_LABELS[run.status] ?? String(run.status ?? '未知'), formatDuration(run.durationMs)]
  if (run.currentStep && typeof run.currentStep === 'object') {
    parts.push(`turn ${run.currentStep.turn ?? '?'} / step ${run.currentStep.step ?? '?'}`)
  }
  if (Array.isArray(run.currentTools) && run.currentTools.length > 0) {
    const names = run.currentTools.map((tool) => tool?.name).filter((name) => typeof name === 'string' && name !== '')
    if (names.length > 0) parts.push(`工具 ${names.slice(0, 4).join(' + ')}`)
  }
  if (run.usage === null || run.usage === undefined) {
    parts.push('token 未上报')
  } else {
    const cacheRead = run.usage.cacheReadTokens === null || run.usage.cacheReadTokens === undefined
      ? '未知'
      : formatTokens(run.usage.cacheReadTokens)
    const cacheWrite = run.usage.cacheWriteTokens === null || run.usage.cacheWriteTokens === undefined
      ? '未知'
      : formatTokens(run.usage.cacheWriteTokens)
    const prefix = run.usage.partial === true ? 'token 已上报（部分）' : 'token 已上报'
    parts.push(`${prefix} ${formatTokens(run.usage.totalTokens)}（未缓存输入 ${formatTokens(run.usage.uncachedInputTokens)}`
      + ` · 缓存读 ${cacheRead} · 缓存写 ${cacheWrite} · 输出 ${formatTokens(run.usage.outputTokens)}）`)
  }
  parts.push(run.lastEventAgeMs === null || run.lastEventAgeMs === undefined
    ? '尚无事件'
    : `最近活动 ${formatAge(run.lastEventAgeMs)}`)
  if (typeof run.note === 'string' && run.note !== '') parts.push(run.note.slice(0, 200))
  return parts.join(' · ').slice(0, 1_200)
}

/** Recompute a live run's clock-derived fields at read time. */
function projectLiveRun(run, now) {
  const startedAtMs = Date.parse(run.startedAt)
  if (Number.isFinite(startedAtMs)) run.durationMs = Math.max(0, now - startedAtMs)
  const lastTime = run.lastEvent && typeof run.lastEvent === 'object' ? run.lastEvent.time : undefined
  if (typeof lastTime === 'number' && Number.isFinite(lastTime)) {
    const age = Math.max(0, now - lastTime)
    run.lastEventAgeMs = age
    run.silentForMs = age
    run.lastEvent = { ...run.lastEvent, ageMs: age }
  }
  if (run.currentStep && typeof run.currentStep === 'object') {
    const stepStarted = Date.parse(run.currentStep.startedAt)
    if (Number.isFinite(stepStarted)) run.currentStep = { ...run.currentStep, elapsedMs: Math.max(0, now - stepStarted) }
  }
  if (Array.isArray(run.currentTools)) {
    run.currentTools = run.currentTools.map((tool) => {
      const toolStarted = Date.parse(tool.startedAt)
      return Number.isFinite(toolStarted) ? { ...tool, elapsedMs: Math.max(0, now - toolStarted) } : tool
    })
  }
  run.statusLine = buildLiveStatusLine(run)
}

/** Default status directory; matches dsh-mcp-bridge's resolveStatusConfig. */
export function resolveStatusDir(env = process.env, config = {}) {
  return config.statusDir?.trim()
    || env.DSH_MONITOR_STATUS_DIR?.trim()
    || env.DSH_MCP_STATUS_DIR?.trim()
    || join(env.DSH_HOME?.trim() || join(homedir(), '.dsh'), 'storages', 'dsh-run-monitor')
}

function sanitizeUsage(usage) {
  if (!usage || typeof usage !== 'object') return undefined
  const out = {}
  for (const key of [
    'scope', 'source', 'final', 'complete', 'partial', 'countedSamples', 'attempts', 'steps',
    'expectedSteps', 'stepsWithUsage', 'expectedAttempts', 'attemptsWithUsage',
    'invalidSamples', 'note', 'updatedAt', 'lastEventSeq',
  ]) {
    if (usage[key] !== undefined && usage[key] !== null) out[key] = usage[key]
  }
  for (const key of ['uncachedInputTokens', 'cacheReadTokens', 'cacheWriteTokens', 'outputTokens', 'totalTokens']) {
    if (usage[key] !== undefined) out[key] = usage[key]
  }
  if (Array.isArray(usage.missingBuckets)) out.missingBuckets = usage.missingBuckets.slice(0, 4).map((item) => text(item, 60)).filter(Boolean)
  for (const key of ['missingUsageSteps', 'missingUsageAttempts', 'missingBoundaries']) {
    if (Array.isArray(usage[key])) {
      out[key] = usage[key].slice(0, 20).map((item) => {
        if (!item || typeof item !== 'object') return undefined
        const entry = {}
        for (const field of ['turn', 'step']) if (item[field] !== undefined) entry[field] = item[field]
        const reason = text(item.reason, 200)
        if (reason !== undefined) entry.reason = reason
        return Object.keys(entry).length === 0 ? undefined : entry
      }).filter(Boolean)
    }
  }
  if (usage.lastSample && typeof usage.lastSample === 'object') {
    out.lastSample = pick(usage.lastSample, ['turn', 'step', 'totalTokens', 'at', 'seq'])
  }
  return Object.keys(out).length === 0 ? undefined : out
}

function sanitizeRun(run) {
  if (!run || typeof run !== 'object') return undefined
  const out = {}
  for (const key of ['sessionId', 'cwd', 'provider', 'model', 'status', 'statusLine', 'note', 'startedAt', 'finishedAt']) {
    const value = text(run[key], key === 'cwd' ? 500 : key === 'statusLine' ? 600 : key === 'note' ? 200 : 200)
    if (value !== undefined) out[key] = value
  }
  if (typeof run.isRunning === 'boolean') out.isRunning = run.isRunning
  for (const key of ['durationMs', 'lastEventAgeMs', 'silentForMs']) {
    const value = number(run[key])
    if (value !== undefined) out[key] = value
  }
  const currentTurn = count(run.currentTurn)
  if (currentTurn !== undefined) out.currentTurn = currentTurn
  const contextWindow = positiveCount(run.contextWindow)
  if (contextWindow !== undefined) out.contextWindow = contextWindow
  const progress = sanitizeProgress(run.progress)
  if (progress !== undefined) out.progress = progress
  if (run.currentStep && typeof run.currentStep === 'object') out.currentStep = pick(run.currentStep, ['turn', 'step', 'startedAt', 'elapsedMs'])
  if (run.lastEvent && typeof run.lastEvent === 'object') out.lastEvent = pick(run.lastEvent, ['seq', 'type', 'time', 'ageMs'])
  if (Array.isArray(run.currentTools)) {
    out.currentTools = run.currentTools.slice(0, 20).map((tool) => {
      if (!tool || typeof tool !== 'object') return undefined
      const name = text(tool.name, 100)
      if (name === undefined) return undefined
      const sanitized = { name }
      for (const key of ['callId', 'turn', 'step', 'startedAt', 'elapsedMs']) {
        if (tool[key] !== undefined) sanitized[key] = typeof tool[key] === 'string' ? text(tool[key], 120) : tool[key]
      }
      return sanitized
    }).filter(Boolean)
  }
  const usage = sanitizeUsage(run.usage)
  if (usage !== undefined) out.usage = usage
  return Object.keys(out).length === 0 ? undefined : out
}

/**
 * Sanitize one parsed status document and compute heartbeat staleness. A
 * running file that stopped heartbeating is reported as stale and its runs are
 * no longer shown as running.
 */
export function sanitizeStatusDocument(raw, { now = Date.now(), maxRunAgeMs = MAX_RUN_AGE_MS } = {}) {
  if (!raw || typeof raw !== 'object' || !Array.isArray(raw.runs)) {
    return { error: 'unsupported status document' }
  }
  if (raw.schemaVersion !== undefined && raw.schemaVersion !== 1) {
    return { error: `unsupported schemaVersion: ${String(raw.schemaVersion).slice(0, 40)}` }
  }
  const bridgeRaw = raw.bridge && typeof raw.bridge === 'object' ? raw.bridge : {}
  const instanceId = text(bridgeRaw.instanceId, 120)
  const state = ['running', 'idle', 'stopped'].includes(bridgeRaw.state) ? bridgeRaw.state : 'unknown'
  const heartbeatAt = text(bridgeRaw.heartbeatAt, 60)
  const heartbeatAtMs = heartbeatAt === undefined ? undefined : Date.parse(heartbeatAt)
  const heartbeatIntervalMs = clamp(number(bridgeRaw.heartbeatIntervalMs), 5000, 1000, 60_000)
  const staleAfterMs = clamp(number(bridgeRaw.staleAfterMs), heartbeatIntervalMs * 3, 1000, 24 * 60 * 60 * 1000)
  const heartbeatAgeMs = heartbeatAtMs === undefined || !Number.isFinite(heartbeatAtMs)
    ? null
    : Math.max(0, now - heartbeatAtMs)
  const stale = state === 'running'
    && (heartbeatAgeMs === null || heartbeatAgeMs > staleAfterMs)
  const runs = []
  for (const run of raw.runs.slice(0, MAX_RUNS)) {
    const sanitized = sanitizeRun(run)
    if (sanitized === undefined) continue
    if (stale || state === 'stopped') {
      if (sanitized.isRunning) {
        sanitized.isRunning = false
        sanitized.status = stale ? 'stale' : 'stopped'
        sanitized.statusLine = (stale
          ? '状态已过期：桥不再发送心跳'
          : '桥已停止') + (sanitized.note ? ` · ${sanitized.note}` : '')
      }
    } else if (state !== 'running' && sanitized.isRunning) {
      // An idle/unknown bridge cannot be the authority for a live task.
      sanitized.isRunning = false
      sanitized.status = 'incomplete'
      sanitized.statusLine = '桥已空闲但任务没有终态；不显示为运行中'
    }
    if (state !== 'running' || stale) {
      // Current step/tool belong to a live process; do not advertise last-known
      // values as current after the heartbeat expired or the bridge stopped.
      sanitized.currentTools = []
      delete sanitized.currentTool
      delete sanitized.currentStep
    } else if (sanitized.isRunning === true) {
      // A fresh running document still needs read-time projection: its cached
      // duration and last-activity age were frozen when the last event landed.
      projectLiveRun(sanitized, now)
    }
    const finishedMs = sanitized.finishedAt === undefined ? undefined : Date.parse(sanitized.finishedAt)
    if (finishedMs !== undefined && Number.isFinite(finishedMs) && now - finishedMs > maxRunAgeMs) continue
    runs.push(sanitized)
  }
  return {
    bridge: {
      instanceId: instanceId ?? 'unknown',
      pid: number(bridgeRaw.pid),
      version: text(bridgeRaw.version, 40),
      state,
      startedAt: text(bridgeRaw.startedAt, 60),
      updatedAt: text(bridgeRaw.updatedAt, 60),
      heartbeatAt,
      heartbeatIntervalMs,
      staleAfterMs,
      heartbeatAgeMs,
      stale,
    },
    runs,
  }
}

/**
 * Read every bridge-owned status file. Missing status directory is an empty
 * state; corrupt, oversized, non-regular and unsupported files become entries
 * with `error` instead of failing the whole panel.
 */
export async function readStatusFiles({ statusDir, now = Date.now(), maxBytes = MAX_FILE_BYTES, maxFiles = MAX_FILES } = {}) {
  const dir = statusDir ?? resolveStatusDir()
  let names
  try {
    names = await readdir(dir)
  } catch (error) {
    if (error?.code === 'ENOENT') {
      return { statusDir: dir, now, files: [], missing: true }
    }
    throw error
  }
  const discovered = []
  for (const name of names.filter((entry) => FILE_RE.test(entry))) {
    try {
      const stat = await lstat(join(dir, name))
      discovered.push({ name, stat, mtimeMs: stat.mtimeMs })
    } catch (error) {
      discovered.push({ name, stat: undefined, mtimeMs: 0, statError: String(error?.message ?? error) })
    }
  }
  // Newest first, then bounded. Sorting all candidates by mtime avoids hiding a
  // newly active bridge behind dozens of old restart files.
  discovered.sort((a, b) => b.mtimeMs - a.mtimeMs || String(b.name).localeCompare(String(a.name)))
  const candidates = discovered.slice(0, maxFiles)
  const files = []
  for (const entry of candidates) {
    const name = entry.name
    const full = join(dir, name)
    const file = basename(name)
    try {
      const stat = entry.stat
      if (stat === undefined) throw new Error(entry.statError ?? 'stat failed')
      if (!stat.isFile() || stat.isSymbolicLink()) {
        files.push({ file, error: 'not a regular file' })
        continue
      }
      if (stat.size > maxBytes) {
        files.push({ file, error: 'status file too large', size: stat.size })
        continue
      }
      let parsed
      try {
        parsed = JSON.parse(await readFile(full, 'utf8'))
      } catch {
        files.push({ file, error: 'invalid JSON' })
        continue
      }
      const sanitized = sanitizeStatusDocument(parsed, { now })
      if (sanitized.error !== undefined) files.push({ file, error: sanitized.error })
      else files.push({ file, ...sanitized })
    } catch (error) {
      files.push({ file, error: String(error?.message ?? error).slice(0, 200) })
    }
  }
  files.sort((a, b) => {
    const aRunning = a.bridge?.state === 'running' && !a.bridge?.stale ? 1 : 0
    const bRunning = b.bridge?.state === 'running' && !b.bridge?.stale ? 1 : 0
    return bRunning - aRunning || String(a.file).localeCompare(String(b.file))
  })
  return { statusDir: dir, now, files, missing: false }
}

/** Create the testable request handler. */
export function createStatusHandler({ statusDir, now = () => Date.now(), maxBytes } = {}) {
  return async function handle() {
    const at = now()
    try {
      const value = await readStatusFiles({ statusDir, now: at, maxBytes })
      return { ok: true, value: { schemaVersion: 1, generatedAt: new Date(at).toISOString(), ...value } }
    } catch (error) {
      return { ok: false, error: { code: 'internal', message: String(error?.message ?? error), details: {} } }
    }
  }
}

function apply(ctx, config = {}) {
  if (ctx === undefined || ctx.connection === undefined) return
  const statusDir = resolveStatusDir(process.env, config)
  const handle = createStatusHandler({ statusDir, maxBytes: config.maxBytes })
  ctx.connection.fetch.register({
    path: API_PATH,
    methods: ['POST'],
    requestBody: 'buffered',
    fetch: async (request) => {
      const type = request.headers.get('content-type')?.split(';', 1)[0]?.trim().toLowerCase()
      if (type !== undefined && type !== 'application/json') {
        return Response.json({ ok: false, error: { code: 'internal', message: 'content type must be application/json' } }, { status: 415 })
      }
      return Response.json(await handle(), { headers: { 'cache-control': 'no-store' } })
    },
  })
}

export { apply, inject, API_PATH }
