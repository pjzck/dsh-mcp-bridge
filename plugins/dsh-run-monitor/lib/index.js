/**
 * Host half of the DSH run monitor.
 *
 * Reads the sanitized status files the dsh-mcp-bridge publishes under
 * `$DSH_HOME/storages/dsh-run-monitor` and exposes them through the
 * authenticated Connection fetch registry (`/api/dsh-run-monitor`). It never
 * opens a port and never reads task prompts, tool arguments or credentials.
 */

import { readdir, lstat, readFile, mkdir, rename } from 'node:fs/promises'
import { homedir } from 'node:os'
import { basename, join, resolve } from 'node:path'
import { createTranscriptHandler, errorResult } from './transcript.js'

const inject = ['connection']
const API_PATH = '/api/dsh-run-monitor'
const FILE_RE = /^bridge-[A-Za-z0-9._-]+\.json$/
const MAX_FILE_BYTES = 256 * 1024
const MAX_FILES = 64
const MAX_RUNS = 50
const MAX_RUN_AGE_MS = 7 * 24 * 60 * 60 * 1000
const ARCHIVE_DIR_NAME = 'archive'
const DEFAULT_ARCHIVE_GRACE_MS = 60_000
const MAINTENANCE_INTERVAL_MS = 60_000
const MAX_ARCHIVE_FILES = 256
/** Last successful archive pass per resolved status directory. */
const maintenanceAt = new Map()

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
  for (const key of ['sessionId', 'title', 'cwd', 'provider', 'model', 'status', 'statusLine', 'note', 'startedAt', 'finishedAt']) {
    const value = text(run[key], key === 'title' ? 120 : key === 'cwd' ? 500 : key === 'statusLine' ? 600 : key === 'note' ? 200 : 200)
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

function timestamp(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string') {
    const parsed = Date.parse(value)
    if (Number.isFinite(parsed)) return parsed
  }
  return undefined
}

/**
 * Return true only when the pid is known to exist. A missing process yields
 * `false`; permission errors are `undefined` (unknown), because the caller
 * must keep the snapshot rather than guess.
 */
function defaultIsProcessAlive(pid) {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return error?.code === 'ESRCH' ? false : undefined
  }
}

function processState(pid, isProcessAlive) {
  try {
    const alive = isProcessAlive(pid)
    if (alive === false) return 'dead'
    if (alive === true) return 'alive'
    return 'unknown'
  } catch {
    return 'unknown'
  }
}

async function ensureArchiveDirectory(archiveDir) {
  let stat
  try {
    stat = await lstat(archiveDir)
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error
    await mkdir(archiveDir, { recursive: true })
    stat = await lstat(archiveDir)
  }
  if (stat.isSymbolicLink()) throw new Error('archive path is a symbolic link')
  if (!stat.isDirectory()) throw new Error('archive path is not a directory')
}

function sameSnapshot(before, after) {
  return before.dev === after.dev
    && before.ino === after.ino
    && before.size === after.size
    && before.mtimeMs === after.mtimeMs
}

/**
 * Move bridge snapshots whose process is confirmed dead and whose newest
 * timestamps are older than the grace period into `<statusDir>/archive`.
 * Every file is handled in isolation: no snapshot is deleted, an existing
 * archive target is never overwritten and the process is never signalled.
 */
export async function maintainStatusFiles({
  statusDir,
  now = Date.now(),
  graceMs = DEFAULT_ARCHIVE_GRACE_MS,
  isProcessAlive = defaultIsProcessAlive,
} = {}) {
  const dir = statusDir ?? resolveStatusDir()
  const archiveDir = join(dir, ARCHIVE_DIR_NAME)
  const result = { statusDir: dir, archiveDir, now, archived: [], kept: [], errors: [] }
  let names
  try {
    names = await readdir(dir)
  } catch (error) {
    if (error?.code === 'ENOENT') return result
    throw error
  }
  const grace = typeof graceMs === 'number' && Number.isFinite(graceMs)
    ? Math.max(0, graceMs)
    : DEFAULT_ARCHIVE_GRACE_MS
  let archiveReady = false
  for (const name of names.filter((entry) => FILE_RE.test(entry)).sort()) {
    try {
      const source = join(dir, name)
      const before = await lstat(source)
      if (before.isSymbolicLink() || !before.isFile()) {
        result.kept.push({ file: name, reason: 'not a regular file' })
        continue
      }
      if (before.size > MAX_FILE_BYTES) {
        result.kept.push({ file: name, reason: 'status file too large' })
        continue
      }
      let raw
      try {
        raw = JSON.parse(await readFile(source, 'utf8'))
      } catch {
        result.kept.push({ file: name, reason: 'invalid JSON' })
        continue
      }
      if (!raw || typeof raw !== 'object' || raw.schemaVersion !== 1 || raw.kind !== 'dsh-run-monitor') {
        result.kept.push({ file: name, reason: 'unsupported status document' })
        continue
      }
      const bridge = raw.bridge
      if (!bridge || typeof bridge !== 'object') {
        result.kept.push({ file: name, reason: 'missing bridge record' })
        continue
      }
      if (typeof bridge.instanceId !== 'string' || `${bridge.instanceId}.json` !== name) {
        result.kept.push({ file: name, reason: 'file name does not match instanceId' })
        continue
      }
      const pid = bridge.pid
      if (!Number.isSafeInteger(pid) || pid <= 0) {
        result.kept.push({ file: name, reason: 'invalid pid' })
        continue
      }
      const firstState = processState(pid, isProcessAlive)
      if (firstState !== 'dead') {
        result.kept.push({ file: name, reason: firstState === 'alive' ? 'process is alive' : 'process liveness unknown' })
        continue
      }
      const heartbeat = timestamp(bridge.heartbeatAt)
      const heartbeatInterval = clamp(number(bridge.heartbeatIntervalMs), 5000, 1000, 60_000)
      const staleAfter = clamp(number(bridge.staleAfterMs), heartbeatInterval * 3, 1000, 24 * 60 * 60 * 1000)
      if (bridge.state === 'running' && heartbeat !== undefined && now - heartbeat <= staleAfter) {
        result.kept.push({ file: name, reason: 'running heartbeat is fresh' })
        continue
      }
      const stamps = [
        before.mtimeMs,
        timestamp(bridge.heartbeatAt),
        timestamp(bridge.updatedAt),
        timestamp(bridge.startedAt),
      ].filter((value) => value !== undefined)
      if (!(now - Math.max(...stamps) > grace)) {
        result.kept.push({ file: name, reason: 'within grace period' })
        continue
      }

      if (!archiveReady) {
        await ensureArchiveDirectory(archiveDir)
        archiveReady = true
      }
      const target = join(archiveDir, name)
      try {
        await lstat(target)
        result.kept.push({ file: name, reason: 'archive target exists' })
        continue
      } catch (error) {
        if (error?.code !== 'ENOENT') throw error
      }

      // The file and the process can change while this pass runs. Re-check
      // both immediately before the move.
      const secondState = processState(pid, isProcessAlive)
      if (secondState !== 'dead') {
        result.kept.push({ file: name, reason: secondState === 'alive' ? 'process is alive' : 'process liveness unknown' })
        continue
      }
      const after = await lstat(source)
      if (after.isSymbolicLink() || !after.isFile() || !sameSnapshot(before, after)) {
        result.kept.push({ file: name, reason: 'source snapshot changed' })
        continue
      }

      await rename(source, target)
      result.archived.push({
        file: name,
        pid,
        runs: Array.isArray(raw.runs) ? raw.runs.length : 0,
      })
    } catch (error) {
      result.errors.push({ file: name, error: String(error?.message ?? error).slice(0, 200) })
    }
  }
  return result
}

/**
 * Read archived snapshots. Only records that still contain task entries are
 * returned, and archived runs are never advertised as running. Counts are
 * best-effort: when a limit or a corrupt file makes them inexact, `truncated`
 * is set so the caller does not present them as complete.
 */
async function readArchivedStatusFiles({ statusDir, now, maxBytes, maxFiles }) {
  const dir = join(statusDir, ARCHIVE_DIR_NAME)
  const summary = { files: 0, runs: 0 }
  let names
  try {
    const archiveStat = await lstat(dir)
    if (archiveStat.isSymbolicLink() || !archiveStat.isDirectory()) return { files: [], summary, truncated: true }
    names = await readdir(dir)
  } catch (error) {
    if (error?.code === 'ENOENT') return { files: [], summary, truncated: false }
    return { files: [], summary, truncated: true }
  }
  const candidates = names.filter((entry) => FILE_RE.test(entry))
  summary.files = candidates.length
  const discovered = []
  let truncated = false
  for (const name of candidates) {
    try {
      discovered.push({ name, stat: await lstat(join(dir, name)) })
    } catch {
      discovered.push({ name, stat: undefined })
      truncated = true
    }
  }
  discovered.sort((a, b) => (b.stat?.mtimeMs ?? 0) - (a.stat?.mtimeMs ?? 0)
    || String(b.name).localeCompare(String(a.name)))
  if (discovered.length > maxFiles) truncated = true
  const files = []
  for (const entry of discovered.slice(0, maxFiles)) {
    const file = basename(entry.name)
    try {
      const stat = entry.stat
      if (stat === undefined || stat.isSymbolicLink() || !stat.isFile()) {
        truncated = true
        continue
      }
      if (stat.size > maxBytes) {
        truncated = true
        continue
      }
      let parsed
      try {
        parsed = JSON.parse(await readFile(join(dir, entry.name), 'utf8'))
      } catch {
        truncated = true
        continue
      }
      if (Array.isArray(parsed?.runs) && parsed.runs.length > MAX_RUNS) truncated = true
      const sanitized = sanitizeStatusDocument(parsed, { now, maxRunAgeMs: Number.POSITIVE_INFINITY })
      if (sanitized.error !== undefined) {
        truncated = true
        continue
      }
      for (const run of sanitized.runs) {
        if (run.isRunning === true || run.status === 'running' || run.status === 'queued' || run.status === 'stale') {
          run.isRunning = false
          run.status = 'stopped'
          run.statusLine = '已归档 · 桥进程已退出'
        }
        // A live tool/step belongs to the dead process; keep only terminal data.
        run.currentTools = []
        delete run.currentTool
        delete run.currentStep
      }
      summary.runs += sanitized.runs.length
      if (sanitized.runs.length === 0) continue
      const archivedAt = new Date(stat.mtimeMs)
      files.push({
        file,
        archived: true,
        ...(Number.isFinite(archivedAt.getTime()) ? { archivedAt: archivedAt.toISOString() } : {}),
        bridge: sanitized.bridge,
        runs: sanitized.runs,
      })
    } catch {
      truncated = true
    }
  }
  return { files, summary, truncated }
}

/**
 * Read every bridge-owned status file. Missing status directory is an empty
 * state; corrupt, oversized, non-regular and unsupported files become entries
 * with `error` instead of failing the whole panel.
 *
 * Before reading, snapshots of confirmed-dead processes older than the grace
 * period are moved into the archive. This maintenance runs at most once per
 * minute per directory; a failed pass is retried on the next read and never
 * breaks reading.
 */
export async function readStatusFiles({
  statusDir,
  now = Date.now(),
  maxBytes = MAX_FILE_BYTES,
  maxFiles = MAX_FILES,
  graceMs = DEFAULT_ARCHIVE_GRACE_MS,
  isProcessAlive,
  maintain = true,
  maxArchiveFiles = MAX_ARCHIVE_FILES,
} = {}) {
  const dir = statusDir ?? resolveStatusDir()
  if (maintain) {
    const key = resolve(dir)
    const last = maintenanceAt.get(key)
    if (last === undefined || now - last >= MAINTENANCE_INTERVAL_MS) {
      try {
        const report = await maintainStatusFiles({ statusDir: dir, now, graceMs, isProcessAlive })
        // A pass with file-level errors is retried on the next read so that a
        // transient permission/rename failure recovers immediately.
        if (report.errors.length === 0) maintenanceAt.set(key, now)
      } catch {
        // Keep reading; the next call retries the archive pass.
      }
    }
  }
  let names
  try {
    names = await readdir(dir)
  } catch (error) {
    if (error?.code === 'ENOENT') {
      return {
        statusDir: dir,
        now,
        files: [],
        archivedFiles: [],
        archiveSummary: { files: 0, runs: 0 },
        discoveredFiles: 0,
        missing: true,
      }
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
  const archive = await readArchivedStatusFiles({ statusDir: dir, now, maxBytes, maxFiles: maxArchiveFiles })
  return {
    statusDir: dir,
    now,
    files,
    archivedFiles: archive.files,
    archiveSummary: archive.summary,
    discoveredFiles: discovered.length,
    missing: false,
    ...(archive.truncated ? { truncated: true } : {}),
  }
}

/** Create the testable request handler. */
export function createStatusHandler({ statusDir, now = () => Date.now(), maxBytes, graceMs, isProcessAlive, maintain, readSession, resolveReadSession } = {}) {
  const titles = new Map()
  let pendingTitles = 0
  function enrichTitles(value) {
    const reader = typeof readSession === 'function' ? readSession : resolveReadSession?.()
    if (typeof reader !== 'function') return
    for (const file of [...value.files, ...value.archivedFiles]) for (const run of file.runs || []) {
      if (run.title || !run.sessionId || !file.bridge?.instanceId) continue
      const key = JSON.stringify([file.bridge.instanceId, run.sessionId, run.startedAt])
      const cached = titles.get(key)
      if (cached?.title) { run.title = cached.title; continue }
      if (cached?.pending || cached?.retryAt > now() || pendingTitles >= 2) continue
      if (titles.size >= 128) titles.delete(titles.keys().next().value)
      titles.set(key, { pending: true })
      pendingTitles++
      // Legacy snapshots have no title. Fill a short public task label in the
      // background; a large persisted log must never delay the state response.
      Promise.resolve().then(() => reader(run.sessionId)).then(log => {
        const message = [...(Array.isArray(log?.events) ? log.events : [])].reverse().find(event => event?.type === 'user/message' && event.data?.source?.kind === 'user')
        const text = (message?.data?.content || []).filter(block => block?.type === 'text').map(block => block.text || '').join(' ')
        const title = text.trim().split(/[\r\n。！？!?]/, 1)[0].replace(/^\s*[#>*-]+\s*/, '').replace(/\s+/g, ' ').slice(0, 80)
        titles.set(key, { title, retryAt: now() + 10000 })
      }).catch(() => titles.set(key, { retryAt: now() + 10000 })).finally(() => { pendingTitles-- })
    }
  }
  return async function handle() {
    const at = now()
    try {
      const value = await readStatusFiles({ statusDir, now: at, maxBytes, graceMs, isProcessAlive, maintain })
      enrichTitles(value)
      return { ok: true, value: { schemaVersion: 1, generatedAt: new Date(at).toISOString(), ...value } }
    } catch (error) {
      return { ok: false, error: { code: 'internal', message: String(error?.message ?? error), details: {} } }
    }
  }
}

/** True only when a current or archived snapshot pairs both identifiers. */
function statusContainsSession(status, bridgeInstanceId, sessionId) {
  const files = [
    ...(Array.isArray(status?.files) ? status.files : []),
    ...(Array.isArray(status?.archivedFiles) ? status.archivedFiles : []),
  ]
  for (const file of files) {
    if (!file || typeof file !== 'object' || file.error !== undefined) continue
    if (file.bridge?.instanceId !== bridgeInstanceId) continue
    if (!Array.isArray(file.runs)) continue
    if (file.runs.some((run) => run?.sessionId === sessionId)) return true
  }
  return false
}

const ERROR_STATUS = {
  'invalid-body': 400,
  'invalid-method': 400,
  'invalid-argument': 400,
  'not-authorized': 403,
  unavailable: 503,
  'session-read-failed': 502,
  internal: 500,
}

function statusForError(result) {
  if (result?.ok === true) return 200
  return ERROR_STATUS[result?.error?.code] ?? 500
}

/** Build a method dispatcher over the existing state handler and transcript. */
export function createApiHandler({
  statusDir,
  now = () => Date.now(),
  maxBytes,
  graceMs,
  isProcessAlive,
  maintain,
  readSession,
  resolveReadSession,
  maxResponseBytes,
} = {}) {
  const statusHandler = createStatusHandler({ statusDir, now, maxBytes, graceMs, isProcessAlive, maintain, readSession, resolveReadSession })
  const transcriptHandler = createTranscriptHandler({
    authorizeSession: async ({ bridgeInstanceId, sessionId }) => {
      // Authorization always reads the status snapshots without invoking the
      // archive pass, so a read request never moves bridge files.
      const status = await readStatusFiles({
        statusDir,
        now: now(),
        maxBytes,
        graceMs,
        isProcessAlive,
        maintain: false,
      })
      return statusContainsSession(status, bridgeInstanceId, sessionId)
    },
    readSession,
    resolveReadSession,
    maxResponseBytes,
  })

  return async function handleApi(body) {
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      return { status: 400, body: errorResult('invalid-body', 'request body must be a JSON object') }
    }
    const method = body.method === undefined ? 'state' : body.method
    if (method === 'state') {
      return { status: 200, body: await statusHandler() }
    }
    if (method === 'transcript') {
      const result = await transcriptHandler(body)
      return { status: statusForError(result), body: result }
    }
    return {
      status: 400,
      body: errorResult('invalid-method', 'body.method must be "state" or "transcript"', {
        method: typeof method === 'string' ? method.slice(0, 40) : typeof method,
      }),
    }
  }
}

async function readJsonBody(request) {
  let raw
  try {
    raw = await request.text()
  } catch {
    return { error: errorResult('invalid-body', 'failed to read the request body') }
  }
  if (raw.trim() === '') return { body: {} }
  let parsed
  try {
    parsed = JSON.parse(raw)
  } catch {
    return { error: errorResult('invalid-body', 'request body must be valid JSON') }
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { error: errorResult('invalid-body', 'request body must be a JSON object') }
  }
  return { body: parsed }
}

function apply(ctx, config = {}) {
  if (ctx === undefined || ctx.connection === undefined) return
  const statusDir = resolveStatusDir(process.env, config)
  const configuredReadSession = typeof config.readSession === 'function' ? config.readSession : undefined
  // Cordis has no optional-inject object form. Keep `connection` required and
  // resolve the optional `sessionQuery` service at request time.
  const resolveReadSession = configuredReadSession === undefined
    ? () => {
        let service
        try {
          service = typeof ctx.get === 'function' ? ctx.get('sessionQuery') : undefined
        } catch {
          return undefined
        }
        if (!service || typeof service.readSession !== 'function') return undefined
        return (sessionId) => service.readSession(sessionId)
      }
    : () => configuredReadSession
  const handle = createApiHandler({
    statusDir,
    maxBytes: config.maxBytes,
    readSession: configuredReadSession,
    resolveReadSession,
  })
  ctx.connection.fetch.register({
    path: API_PATH,
    methods: ['POST'],
    requestBody: 'buffered',
    fetch: async (request) => {
      const type = request.headers.get('content-type')?.split(';', 1)[0]?.trim().toLowerCase()
      if (type !== undefined && type !== 'application/json') {
        return Response.json({ ok: false, error: { code: 'internal', message: 'content type must be application/json' } }, { status: 415 })
      }
      const parsed = await readJsonBody(request)
      if (parsed.error !== undefined) {
        return Response.json(parsed.error, { status: 400, headers: { 'cache-control': 'no-store' } })
      }
      let result
      try {
        result = await handle(parsed.body)
      } catch (error) {
        result = {
          status: 500,
          body: { ok: false, error: { code: 'internal', message: String(error?.message ?? error), details: {} } },
        }
      }
      return Response.json(result.body, { status: result.status, headers: { 'cache-control': 'no-store' } })
    },
  })
}

export { apply, inject, API_PATH }
