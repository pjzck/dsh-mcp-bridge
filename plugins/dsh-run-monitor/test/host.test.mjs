import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import { writeFileSync } from 'node:fs'
import path from 'node:path'
import test, { after } from 'node:test'
import { fileURLToPath } from 'node:url'
import {
  API_PATH,
  apply,
  createStatusHandler,
  maintainStatusFiles,
  readStatusFiles,
  sanitizeStatusDocument,
} from '../lib/index.js'

const here = path.dirname(fileURLToPath(import.meta.url))
const root = path.join(here, '..', '..', '.smoke-workspace', `plugin-host-test-${process.pid}-${Date.now()}`)
const NOW = Date.parse('2026-10-25T12:00:00.000Z')

after(async () => {
  await fs.rm(root, { recursive: true, force: true })
})

function document(overrides = {}) {
  return {
    schemaVersion: 1,
    kind: 'dsh-run-monitor',
    bridge: {
      instanceId: 'bridge-a',
      pid: 123,
      version: '0.1.0',
      state: 'running',
      startedAt: '2026-10-25T11:59:00.000Z',
      updatedAt: '2026-10-25T11:59:59.000Z',
      heartbeatAt: '2026-10-25T11:59:59.500Z',
      heartbeatIntervalMs: 5000,
      staleAfterMs: 15000,
      ...overrides.bridge,
    },
    runs: overrides.runs ?? [{
      sessionId: 'session-a',
      cwd: 'H:\\workspace\\repo',
      provider: 'deepseek-official',
      model: 'deepseek-flash',
      status: 'running',
      isRunning: true,
      startedAt: '2026-10-25T11:59:10.000Z',
      finishedAt: null,
      durationMs: 30000,
      statusLine: '运行中 · 30s · <img src=x onerror=alert(1)>',
      currentStep: { turn: 1, step: 2, elapsedMs: 100 },
      currentTools: [{ name: 'pwsh', callId: 'c1' }],
      lastEvent: { seq: 7, type: 'tool/call', time: NOW - 500, ageMs: 500 },
      lastEventAgeMs: 500,
      currentTurn: 2,
      contextWindow: 128_000,
      progress: { completedSteps: 3, toolCalls: 4, completedToolCalls: 2 },
      usage: {
        scope: 'run',
        source: 'provider',
        partial: true,
        complete: false,
        uncachedInputTokens: 100,
        cacheReadTokens: 20,
        cacheWriteTokens: 0,
        outputTokens: 10,
        totalTokens: 130,
        assistantText: 'PRIVATE',
        lastSample: { turn: 1, step: 2, totalTokens: 130 },
      },
      assistantText: 'PRIVATE ANSWER',
      toolCalls: [{ name: 'pwsh', arguments: 'TOP SECRET' }],
      apiKey: 'sk-secret',
    }],
  }
}

const OLD = Date.parse('2026-10-01T00:00:00.000Z')

function storedDocument({ instanceId, pid = 4242, state = 'idle', heartbeatAt, updatedAt, startedAt, runs } = {}) {
  return {
    schemaVersion: 1,
    kind: 'dsh-run-monitor',
    bridge: {
      instanceId,
      pid,
      state,
      startedAt: startedAt ?? '2026-10-01T00:00:00.000Z',
      updatedAt: updatedAt ?? '2026-10-01T00:00:00.000Z',
      heartbeatAt: heartbeatAt ?? updatedAt ?? '2026-10-01T00:00:00.000Z',
      heartbeatIntervalMs: 5000,
      staleAfterMs: 15000,
    },
    runs: runs ?? [],
  }
}

function finishedRun(overrides = {}) {
  return {
    sessionId: 'session-old',
    cwd: 'H:\\workspace\\old',
    provider: 'deepseek-official',
    model: 'deepseek-flash',
    status: 'succeeded',
    isRunning: false,
    startedAt: '2026-10-01T00:00:00.000Z',
    finishedAt: '2026-10-01T00:01:00.000Z',
    durationMs: 60_000,
    statusLine: '已完成',
    ...overrides,
  }
}

async function writeDocument(dir, name, raw, mtime = OLD) {
  const file = path.join(dir, name)
  await fs.writeFile(file, typeof raw === 'string' ? raw : JSON.stringify(raw))
  if (mtime !== undefined) {
    const when = new Date(mtime)
    await fs.utimes(file, when, when)
  }
  return file
}

test('empty and missing status directories are normal empty states', async () => {
  const empty = path.join(root, 'empty')
  await fs.mkdir(empty, { recursive: true })
  const read = await readStatusFiles({ statusDir: empty, now: NOW })
  assert.deepEqual(read.files, [])
  assert.deepEqual(read.archivedFiles, [])
  assert.deepEqual(read.archiveSummary, { files: 0, runs: 0 })
  assert.equal(read.discoveredFiles, 0)
  assert.equal(read.missing, false)

  const missing = await readStatusFiles({ statusDir: path.join(root, 'missing'), now: NOW })
  assert.deepEqual(missing.files, [])
  assert.deepEqual(missing.archivedFiles, [])
  assert.deepEqual(missing.archiveSummary, { files: 0, runs: 0 })
  assert.equal(missing.discoveredFiles, 0)
  assert.equal(missing.missing, true)
  const result = await createStatusHandler({ statusDir: path.join(root, 'missing'), now: () => NOW })()
  assert.equal(result.ok, true)
  assert.deepEqual(result.value.files, [])
  assert.deepEqual(result.value.archivedFiles, [])
})

test('multiple bridge files, staleness, corruption and oversized files are isolated', async () => {
  const dir = path.join(root, 'mixed')
  await fs.mkdir(dir, { recursive: true })
  await fs.writeFile(path.join(dir, 'bridge-a.json'), JSON.stringify(document()))
  await fs.writeFile(path.join(dir, 'bridge-b.json'), JSON.stringify(document({
    bridge: { instanceId: 'bridge-b', heartbeatAt: '2026-10-25T11:55:00.000Z' },
    runs: [{ ...document().runs[0], sessionId: 'session-b' }],
  })))
  await fs.writeFile(path.join(dir, 'bridge-c.json'), '{"broken":')
  await fs.writeFile(path.join(dir, 'bridge-d.json'), JSON.stringify({ schemaVersion: 99, bridge: {}, runs: [] }))
  await fs.writeFile(path.join(dir, 'not-a-bridge.json'), '{"ignored":true}')
  await fs.writeFile(path.join(dir, 'notes.txt'), 'ignored')

  const read = await readStatusFiles({ statusDir: dir, now: NOW, isProcessAlive: () => true })
  const byFile = Object.fromEntries(read.files.map((file) => [file.file, file]))
  assert.equal(read.discoveredFiles, 4)
  assert.equal(byFile['bridge-a.json'].bridge.stale, false)
  assert.equal(byFile['bridge-a.json'].runs[0].isRunning, true)
  assert.equal(byFile['bridge-a.json'].runs[0].usage.totalTokens, 130)
  assert.equal(byFile['bridge-a.json'].runs[0].currentTurn, 2)
  assert.equal(byFile['bridge-a.json'].runs[0].contextWindow, 128_000)
  assert.deepEqual(byFile['bridge-a.json'].runs[0].progress, { completedSteps: 3, toolCalls: 4, completedToolCalls: 2 })
  assert.equal(JSON.stringify(byFile['bridge-a.json']).includes('PRIVATE ANSWER'), false)
  assert.equal(JSON.stringify(byFile['bridge-a.json']).includes('TOP SECRET'), false)
  assert.equal(JSON.stringify(byFile['bridge-a.json']).includes('sk-secret'), false)
  assert.equal(JSON.stringify(byFile['bridge-a.json']).includes('assistantText'), false)

  assert.equal(byFile['bridge-b.json'].bridge.stale, true)
  assert.equal(byFile['bridge-b.json'].runs[0].isRunning, false)
  assert.equal(byFile['bridge-b.json'].runs[0].status, 'stale')
  assert.match(byFile['bridge-b.json'].runs[0].statusLine, /状态已过期/)
  assert.deepEqual(byFile['bridge-b.json'].runs[0].currentTools, [])
  assert.equal(byFile['bridge-b.json'].runs[0].currentStep, undefined)

  assert.equal(byFile['bridge-c.json'].error, 'invalid JSON')
  assert.match(byFile['bridge-d.json'].error, /unsupported schemaVersion/)
  assert.equal(byFile['not-a-bridge.json'], undefined)
  assert.equal(byFile['notes.txt'], undefined)

  // Sorted: live running bridge first.
  assert.equal(read.files[0].file, 'bridge-a.json')

  const strict = await readStatusFiles({ statusDir: dir, now: NOW, maxBytes: 100, isProcessAlive: () => true })
  const oversized = strict.files.find((file) => file.file === 'bridge-a.json')
  assert.equal(oversized.error, 'status file too large')
})

test('running reads project duration and last-activity age at read time', () => {
  const doc = document({
    runs: [{
      ...document().runs[0],
      startedAt: new Date(NOW - 15_000).toISOString(),
      durationMs: 5_000,
      lastEvent: { seq: 7, type: 'tool/call', time: NOW - 14_000, ageMs: 4_000 },
      lastEventAgeMs: 4_000,
    }],
  })
  const sanitized = sanitizeStatusDocument(doc, { now: NOW })
  const run = sanitized.runs[0]
  assert.equal(run.durationMs, 15_000)
  assert.equal(run.lastEventAgeMs, 14_000)
  assert.equal(run.lastEvent.ageMs, 14_000)
  assert.match(run.statusLine, /15s/)
  assert.match(run.statusLine, /14s 前/)

  const finished = sanitizeStatusDocument(document({
    bridge: { state: 'idle' },
    runs: [{
      ...document().runs[0],
      status: 'succeeded',
      isRunning: false,
      startedAt: new Date(NOW - 15_000).toISOString(),
      finishedAt: new Date(NOW - 10_000).toISOString(),
      durationMs: 5_000,
      lastEvent: { seq: 7, type: 'turn/end', time: NOW - 10_000, ageMs: 4_000 },
      lastEventAgeMs: 4_000,
    }],
  }), { now: NOW })
  assert.equal(finished.runs[0].durationMs, 5_000, 'terminal duration must stay frozen')
  assert.equal(finished.runs[0].lastEventAgeMs, 4_000, 'terminal age must stay frozen')
})

test('host rejects malformed live window, turn and progress values', () => {
  const invalid = sanitizeStatusDocument(document({
    runs: [{
      ...document().runs[0],
      currentTurn: -1,
      contextWindow: 0,
      progress: { completedSteps: 1.5, toolCalls: Number.MAX_SAFE_INTEGER + 1, completedToolCalls: '2' },
    }],
  }), { now: NOW }).runs[0]
  assert.equal('currentTurn' in invalid, false)
  assert.equal('contextWindow' in invalid, false)
  assert.equal('progress' in invalid, false)

  // Valid counters survive next to malformed siblings; the bad values never do.
  const mixed = sanitizeStatusDocument(document({
    runs: [{
      ...document().runs[0],
      currentTurn: 7,
      contextWindow: 32_000,
      progress: { completedSteps: 5, toolCalls: Number.NaN, completedToolCalls: 4 },
    }],
  }), { now: NOW }).runs[0]
  assert.equal(mixed.currentTurn, 7)
  assert.equal(mixed.contextWindow, 32_000)
  assert.deepEqual(mixed.progress, { completedSteps: 5, completedToolCalls: 4 })
})

test('host registers one authenticated POST endpoint and serves the sanitized state', async () => {
  const dir = path.join(root, 'endpoint')
  await fs.mkdir(dir, { recursive: true })
  await fs.writeFile(path.join(dir, 'bridge-a.json'), JSON.stringify(document()))
  let registration
  const ctx = {
    connection: { fetch: { register(entry) { registration = entry } } },
    get() { return undefined },
  }
  apply(ctx, { statusDir: dir })
  assert.equal(registration.path, API_PATH)
  assert.deepEqual(registration.methods, ['POST'])
  assert.equal(registration.requestBody, 'buffered')

  const response = await registration.fetch(new Request('http://localhost/api/dsh-run-monitor', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ method: 'state' }),
  }))
  assert.equal(response.status, 200)
  assert.equal(response.headers.get('cache-control'), 'no-store')
  const body = await response.json()
  assert.equal(body.ok, true)
  assert.equal(body.value.files.length, 1)
  assert.equal(body.value.files[0].runs[0].usage.totalTokens, 130)

  const bad = await registration.fetch(new Request('http://localhost/api/dsh-run-monitor', {
    method: 'POST',
    headers: { 'content-type': 'text/plain' },
    body: 'nope',
  }))
  assert.equal(bad.status, 415)
  assert.equal((await bad.json()).ok, false)
})

test('maintainStatusFiles archives only old snapshots of confirmed-dead processes', async () => {
  const dir = path.join(root, 'maintain')
  await fs.mkdir(dir, { recursive: true })
  const dead = storedDocument({ instanceId: 'bridge-dead', pid: 4242, runs: [finishedRun()] })
  const deadFile = await writeDocument(dir, 'bridge-dead.json', dead)
  await writeDocument(dir, 'bridge-live.json', storedDocument({ instanceId: 'bridge-live', pid: 4243, state: 'running' }))
  await writeDocument(dir, 'bridge-unknown.json', storedDocument({ instanceId: 'bridge-unknown', pid: 4244 }))
  const freshHeartbeat = new Date(NOW - 5_000).toISOString()
  await writeDocument(dir, 'bridge-fresh.json', storedDocument({
    instanceId: 'bridge-fresh',
    pid: 4245,
    state: 'running',
    heartbeatAt: freshHeartbeat,
    updatedAt: freshHeartbeat,
  }))
  await writeDocument(dir, 'bridge-mismatch.json', storedDocument({ instanceId: 'bridge-other', pid: 4246 }))
  await writeDocument(dir, 'bridge-schema.json', {
    ...storedDocument({ instanceId: 'bridge-schema', pid: 4247 }),
    schemaVersion: 2,
  })
  await writeDocument(dir, 'bridge-kind.json', {
    ...storedDocument({ instanceId: 'bridge-kind', pid: 4248 }),
    kind: 'not-dsh-run-monitor',
  })
  await writeDocument(dir, 'notes.txt', 'keep me')
  await writeDocument(dir, 'not-a-bridge.json', '{}')
  await fs.mkdir(path.join(dir, 'bridge-dir.json'))
  await fs.mkdir(path.join(dir, 'link-target'))
  await fs.symlink(path.join(dir, 'link-target'), path.join(dir, 'bridge-link.json'), 'junction')

  const result = await maintainStatusFiles({
    statusDir: dir,
    now: NOW,
    graceMs: 60_000,
    isProcessAlive: (pid) => (pid === 4242 || pid === 4245 ? false : pid === 4243 ? true : undefined),
  })
  assert.deepEqual(result.archived, [{ file: 'bridge-dead.json', pid: 4242, runs: 1 }])
  assert.deepEqual(await fs.readdir(path.join(dir, 'archive')), ['bridge-dead.json'])
  await assert.rejects(fs.stat(deadFile), (error) => error.code === 'ENOENT')
  const archived = JSON.parse(await fs.readFile(path.join(dir, 'archive', 'bridge-dead.json'), 'utf8'))
  assert.deepEqual(archived, dead, 'archived snapshot content must stay intact')

  const reasons = Object.fromEntries(result.kept.map((entry) => [entry.file, entry.reason]))
  assert.equal(reasons['bridge-live.json'], 'process is alive')
  assert.equal(reasons['bridge-unknown.json'], 'process liveness unknown')
  assert.equal(reasons['bridge-fresh.json'], 'running heartbeat is fresh')
  assert.equal(reasons['bridge-mismatch.json'], 'file name does not match instanceId')
  assert.equal(reasons['bridge-schema.json'], 'unsupported status document')
  assert.equal(reasons['bridge-kind.json'], 'unsupported status document')
  assert.equal(reasons['bridge-dir.json'], 'not a regular file')
  assert.equal(reasons['bridge-link.json'], 'not a regular file')
  assert.equal(result.kept.some((entry) => entry.file === 'notes.txt'), false)
  assert.equal(result.kept.some((entry) => entry.file === 'not-a-bridge.json'), false)
  assert.deepEqual(result.errors, [])
})

test('maintainStatusFiles never overwrites an archive or follows an archive link', async (t) => {
  const conflictDir = path.join(root, 'conflict')
  await fs.mkdir(path.join(conflictDir, 'archive'), { recursive: true })
  const conflictSource = await writeDocument(conflictDir, 'bridge-dead.json', storedDocument({
    instanceId: 'bridge-dead',
    pid: 4242,
    runs: [finishedRun()],
  }))
  const conflictTarget = path.join(conflictDir, 'archive', 'bridge-dead.json')
  await fs.writeFile(conflictTarget, 'existing archive')

  const conflict = await maintainStatusFiles({ statusDir: conflictDir, now: NOW, isProcessAlive: () => false })
  assert.deepEqual(conflict.archived, [])
  assert.equal(conflict.kept.find((entry) => entry.file === 'bridge-dead.json')?.reason, 'archive target exists')
  assert.equal(await fs.readFile(conflictTarget, 'utf8'), 'existing archive')
  await fs.stat(conflictSource)

  const linkedDir = path.join(root, 'linked-status')
  const elsewhere = path.join(root, 'elsewhere')
  await fs.mkdir(linkedDir, { recursive: true })
  await fs.mkdir(elsewhere, { recursive: true })
  const linkedSource = await writeDocument(linkedDir, 'bridge-dead.json', storedDocument({
    instanceId: 'bridge-dead',
    pid: 4243,
  }))
  try {
    await fs.symlink(elsewhere, path.join(linkedDir, 'archive'), 'junction')
  } catch (error) {
    t.skip(`directory symlink unavailable: ${error?.code ?? error}`)
    return
  }

  const linked = await maintainStatusFiles({ statusDir: linkedDir, now: NOW, isProcessAlive: () => false })
  assert.deepEqual(linked.archived, [])
  assert.equal(linked.errors.length, 1)
  assert.match(linked.errors[0].error, /symbolic link/)
  assert.deepEqual(await fs.readdir(elsewhere), [])
  await fs.stat(linkedSource)
})

test('fresh running heartbeat is protected even with a zero archive grace', async () => {
  const dir = path.join(root, 'fresh-zero-grace')
  await fs.mkdir(dir, { recursive: true })
  await writeDocument(dir, 'bridge-fresh.json', storedDocument({
    instanceId: 'bridge-fresh', pid: 4242, state: 'running',
    heartbeatAt: new Date(NOW - 5_000).toISOString(),
  }))
  const result = await maintainStatusFiles({ statusDir: dir, now: NOW, graceMs: 0, isProcessAlive: () => false })
  assert.deepEqual(result.archived, [])
  assert.equal(result.kept[0].reason, 'running heartbeat is fresh')
})

test('archive reading refuses a linked directory instead of reading unrelated records', async () => {
  const dir = path.join(root, 'archive-read-link')
  const elsewhere = path.join(root, 'archive-read-elsewhere')
  await fs.mkdir(dir, { recursive: true })
  await fs.mkdir(elsewhere, { recursive: true })
  await writeDocument(elsewhere, 'bridge-elsewhere.json', storedDocument({ instanceId: 'bridge-elsewhere', pid: 4242, runs: [finishedRun()] }))
  await fs.symlink(elsewhere, path.join(dir, 'archive'), 'junction')
  const result = await readStatusFiles({ statusDir: dir, now: NOW, maintain: false })
  assert.deepEqual(result.archivedFiles, [])
  assert.equal(result.truncated, true)
  await fs.stat(path.join(elsewhere, 'bridge-elsewhere.json'))
})

test('maintainStatusFiles rechecks the source snapshot before moving it', async () => {
  const dir = path.join(root, 'atomic-archive')
  await fs.mkdir(dir, { recursive: true })
  const source = await writeDocument(dir, 'bridge-change.json', storedDocument({
    instanceId: 'bridge-change',
    pid: 4242,
    runs: [finishedRun()],
  }))
  let calls = 0
  const result = await maintainStatusFiles({
    statusDir: dir,
    now: NOW,
    isProcessAlive: () => {
      calls += 1
      if (calls === 2) {
        writeFileSync(source, `${JSON.stringify(storedDocument({ instanceId: 'bridge-change', pid: 4242 }))}\n`)
      }
      return false
    },
  })
  assert.equal(calls, 2)
  assert.deepEqual(result.archived, [])
  assert.equal(result.kept.find((entry) => entry.file === 'bridge-change.json')?.reason, 'source snapshot changed')
  assert.equal(JSON.parse(await fs.readFile(source, 'utf8')).runs.length, 0)
  await assert.rejects(fs.stat(path.join(dir, 'archive', 'bridge-change.json')), (error) => error.code === 'ENOENT')
})

test('readStatusFiles returns archived task history without live state', async () => {
  const dir = path.join(root, 'archive-read')
  const archiveDir = path.join(dir, 'archive')
  await fs.mkdir(archiveDir, { recursive: true })
  await writeDocument(dir, 'bridge-current.json', document())
  const runningHeartbeat = new Date(NOW - 1_000).toISOString()
  await writeDocument(archiveDir, 'bridge-live.json', storedDocument({
    instanceId: 'bridge-live',
    pid: 4242,
    state: 'running',
    heartbeatAt: runningHeartbeat,
    updatedAt: runningHeartbeat,
    runs: [finishedRun({
      status: 'running',
      isRunning: true,
      finishedAt: null,
      statusLine: '运行中',
      currentTools: [{ name: 'pwsh', callId: 'c1' }],
      currentStep: { turn: 1, step: 1 },
    })],
  }))
  await writeDocument(archiveDir, 'bridge-done.json', storedDocument({
    instanceId: 'bridge-done',
    pid: 4243,
    runs: [finishedRun({ sessionId: 'session-done' })],
  }))
  await writeDocument(archiveDir, 'bridge-empty.json', storedDocument({ instanceId: 'bridge-empty', pid: 4244 }))
  await writeDocument(archiveDir, 'bridge-broken.json', '{"broken":')

  const read = await readStatusFiles({ statusDir: dir, now: NOW, isProcessAlive: () => true })
  assert.deepEqual(read.files.map((entry) => entry.file), ['bridge-current.json'])
  assert.equal(read.discoveredFiles, 1)
  const byFile = Object.fromEntries(read.archivedFiles.map((entry) => [entry.file, entry]))
  assert.deepEqual(Object.keys(byFile).sort(), ['bridge-done.json', 'bridge-live.json'])
  assert.equal(byFile['bridge-live.json'].archived, true)
  assert.equal(byFile['bridge-live.json'].runs[0].isRunning, false)
  assert.equal(byFile['bridge-live.json'].runs[0].status, 'stopped')
  assert.match(byFile['bridge-live.json'].runs[0].statusLine, /已归档/)
  assert.deepEqual(byFile['bridge-live.json'].runs[0].currentTools, [])
  assert.equal(byFile['bridge-live.json'].runs[0].currentStep, undefined)
  assert.equal(byFile['bridge-done.json'].runs[0].status, 'succeeded')
  assert.equal(byFile['bridge-done.json'].runs[0].sessionId, 'session-done')
  assert.equal(typeof byFile['bridge-done.json'].archivedAt, 'string')
  assert.deepEqual(read.archiveSummary, { files: 4, runs: 2 })
  assert.equal(read.truncated, true)
})

test('readStatusFiles archives at most once per minute per directory', async () => {
  const dir = path.join(root, 'throttle')
  await fs.mkdir(dir, { recursive: true })
  await writeDocument(dir, 'bridge-first.json', storedDocument({
    instanceId: 'bridge-first',
    pid: 4242,
    runs: [finishedRun()],
  }))
  const isProcessAlive = () => false

  let read = await readStatusFiles({ statusDir: dir, now: NOW, graceMs: 60_000, isProcessAlive })
  assert.equal(read.discoveredFiles, 0)
  assert.deepEqual(read.files, [])
  assert.deepEqual(read.archivedFiles.map((entry) => entry.file), ['bridge-first.json'])
  assert.deepEqual(read.archiveSummary, { files: 1, runs: 1 })

  await writeDocument(dir, 'bridge-second.json', storedDocument({
    instanceId: 'bridge-second',
    pid: 4243,
    runs: [finishedRun({ sessionId: 'session-second' })],
  }))
  read = await readStatusFiles({ statusDir: dir, now: NOW, graceMs: 60_000, isProcessAlive })
  assert.equal(read.discoveredFiles, 1)
  assert.deepEqual(read.files.map((entry) => entry.file), ['bridge-second.json'])
  assert.equal(read.archiveSummary.files, 1)

  read = await readStatusFiles({ statusDir: dir, now: NOW + 60_000, graceMs: 60_000, isProcessAlive })
  assert.equal(read.discoveredFiles, 0)
  assert.deepEqual(read.archivedFiles.map((entry) => entry.file).sort(), ['bridge-first.json', 'bridge-second.json'])
  assert.deepEqual(read.archiveSummary, { files: 2, runs: 2 })
})

test('a failed archive pass neither breaks reads nor blocks the next retry', async () => {
  const dir = path.join(root, 'retry')
  await fs.mkdir(dir, { recursive: true })
  await writeDocument(dir, 'bridge-blocked.json', storedDocument({
    instanceId: 'bridge-blocked',
    pid: 4242,
    runs: [finishedRun()],
  }))
  await fs.writeFile(path.join(dir, 'archive'), 'not a directory')

  let read = await readStatusFiles({ statusDir: dir, now: NOW, graceMs: 60_000, isProcessAlive: () => false })
  assert.deepEqual(read.files.map((entry) => entry.file), ['bridge-blocked.json'])
  assert.equal(read.discoveredFiles, 1)

  await fs.unlink(path.join(dir, 'archive'))
  read = await readStatusFiles({ statusDir: dir, now: NOW, graceMs: 60_000, isProcessAlive: () => false })
  assert.equal(read.discoveredFiles, 0)
  assert.deepEqual(read.archivedFiles.map((entry) => entry.file), ['bridge-blocked.json'])
})

test('archive reading marks truncated counts when limits are hit', async () => {
  const dir = path.join(root, 'archive-limits')
  const archiveDir = path.join(dir, 'archive')
  await fs.mkdir(archiveDir, { recursive: true })
  await writeDocument(archiveDir, 'bridge-one.json', storedDocument({
    instanceId: 'bridge-one',
    runs: [finishedRun()],
  }), OLD)
  await writeDocument(archiveDir, 'bridge-two.json', storedDocument({
    instanceId: 'bridge-two',
    runs: [finishedRun({ sessionId: 'session-two' })],
  }), OLD + 1)

  let read = await readStatusFiles({ statusDir: dir, now: NOW, maintain: false, maxArchiveFiles: 1 })
  assert.deepEqual(read.archivedFiles.map((entry) => entry.file), ['bridge-two.json'])
  assert.deepEqual(read.archiveSummary, { files: 2, runs: 1 })
  assert.equal(read.truncated, true)

  read = await readStatusFiles({ statusDir: dir, now: NOW, maintain: false, maxBytes: 10 })
  assert.deepEqual(read.archivedFiles, [])
  assert.deepEqual(read.archiveSummary, { files: 2, runs: 0 })
  assert.equal(read.truncated, true)
})
