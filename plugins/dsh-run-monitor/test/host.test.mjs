import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import test, { after } from 'node:test'
import { fileURLToPath } from 'node:url'
import {
  API_PATH,
  apply,
  createStatusHandler,
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

test('empty and missing status directories are normal empty states', async () => {
  const empty = path.join(root, 'empty')
  await fs.mkdir(empty, { recursive: true })
  const read = await readStatusFiles({ statusDir: empty, now: NOW })
  assert.deepEqual(read.files, [])
  assert.equal(read.missing, false)

  const missing = await readStatusFiles({ statusDir: path.join(root, 'missing'), now: NOW })
  assert.deepEqual(missing.files, [])
  assert.equal(missing.missing, true)
  const result = await createStatusHandler({ statusDir: path.join(root, 'missing'), now: () => NOW })()
  assert.equal(result.ok, true)
  assert.deepEqual(result.value.files, [])
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

  const read = await readStatusFiles({ statusDir: dir, now: NOW })
  const byFile = Object.fromEntries(read.files.map((file) => [file.file, file]))
  assert.equal(byFile['bridge-a.json'].bridge.stale, false)
  assert.equal(byFile['bridge-a.json'].runs[0].isRunning, true)
  assert.equal(byFile['bridge-a.json'].runs[0].usage.totalTokens, 130)
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

  const strict = await readStatusFiles({ statusDir: dir, now: NOW, maxBytes: 100 })
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
