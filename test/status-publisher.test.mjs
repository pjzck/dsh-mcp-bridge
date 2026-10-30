import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import test, { after } from 'node:test'
import { fileURLToPath } from 'node:url'
import {
  StatusPublisher,
  createStatusPublisher,
  projectRun,
  resolveStatusConfig,
  sanitizeRun,
} from '../src/status-publisher.mjs'

const here = path.dirname(fileURLToPath(import.meta.url))
const root = path.join(here, '..', '.smoke-workspace', `status-test-${process.pid}-${Date.now()}`)

after(async () => {
  await fs.rm(root, { recursive: true, force: true })
})

const run = (overrides = {}) => ({
  sessionId: 'session-1',
  cwd: 'H:\\workspace\\repo',
  provider: 'deepseek-official',
  model: 'deepseek-flash',
  status: 'running',
  isRunning: true,
  startedAt: '2026-10-25T00:00:00.000Z',
  finishedAt: null,
  durationMs: 1_234,
  statusLine: '运行中 · 1.2s',
  currentStep: { turn: 1, step: 2, startedAt: '2026-10-25T00:00:00.000Z', elapsedMs: 100 },
  currentTools: [{ name: 'pwsh', callId: 'c1' }],
  lastEvent: { seq: 9, type: 'tool/call', time: 1_000, ageMs: 200 },
  lastEventAgeMs: 200,
  usage: {
    scope: 'run',
    source: 'provider',
    final: false,
    complete: false,
    partial: true,
    countedSamples: 1,
    attempts: 1,
    steps: 1,
    invalidSamples: 0,
    missingBuckets: [],
    uncachedInputTokens: 100,
    cacheReadTokens: 20,
    cacheWriteTokens: 0,
    outputTokens: 10,
    totalTokens: 130,
    updatedAt: '2026-10-25T00:00:01.000Z',
    lastEventSeq: 9,
    note: 'running',
    lastSample: { turn: 1, step: 2, totalTokens: 130, at: '2026-10-25T00:00:01.000Z', seq: 9 },
  },
  assistantText: 'PRIVATE ANSWER',
  toolCalls: [{ callId: 'c1', name: 'pwsh', arguments: 'TOP SECRET', status: 'called' }],
  error: { message: 'PRIVATE ERROR' },
  ...overrides,
})

const readPayload = async (file) => JSON.parse(await fs.readFile(file, 'utf8'))

test('sanitizeRun keeps only the shared status contract', () => {
  const sanitized = sanitizeRun(run())
  const text = JSON.stringify(sanitized)
  assert.equal(text.includes('PRIVATE ANSWER'), false)
  assert.equal(text.includes('TOP SECRET'), false)
  assert.equal(text.includes('PRIVATE ERROR'), false)
  assert.equal(text.includes('arguments'), false)
  assert.equal(sanitized.usage.totalTokens, 130)
  assert.deepEqual(sanitized.currentTools.map((tool) => tool.name), ['pwsh'])
  assert.match(sanitized.statusLine, /运行中/)
})

test('publisher writes one atomic idle file and then a running heartbeat file', async () => {
  const dir = path.join(root, 'atomic')
  const publisher = new StatusPublisher({
    dir,
    instanceId: 'bridge-test',
    heartbeatMs: 15,
    staleAfterMs: 45,
    bridgeVersion: '9.9.9',
  })
  await publisher.start()
  const file = path.join(dir, 'bridge-test.json')
  let payload = await readPayload(file)
  assert.equal(payload.bridge.state, 'idle')
  assert.deepEqual(payload.runs, [])
  assert.equal(publisher.timer, undefined)

  await publisher.update({ state: 'running', runs: [sanitizeRun(run())], updatedAt: 1_000 })
  payload = await readPayload(file)
  assert.equal(payload.bridge.state, 'running')
  assert.equal(payload.bridge.heartbeatIntervalMs, 15)
  assert.equal(payload.bridge.staleAfterMs, 45)
  assert.equal(payload.runs[0].usage.totalTokens, 130)
  assert.notEqual(publisher.timer, undefined)

  const firstHeartbeat = payload.bridge.heartbeatAt
  await new Promise((resolve) => setTimeout(resolve, 60))
  payload = await readPayload(file)
  assert.notEqual(payload.bridge.heartbeatAt, firstHeartbeat, 'heartbeat should rewrite while running')

  await publisher.stop()
  payload = await readPayload(file)
  assert.equal(payload.bridge.state, 'stopped')
  assert.equal(payload.runs[0].isRunning, false)
  assert.equal(payload.runs[0].status, 'stopped')
  assert.equal(publisher.timer, undefined)

  const entries = await fs.readdir(dir)
  assert.deepEqual(entries, ['bridge-test.json'])
})

test('idle publisher stops rewriting and leaves other bridge files alone', async () => {
  const dir = path.join(root, 'idle')
  const publisher = new StatusPublisher({ dir, instanceId: 'bridge-a', heartbeatMs: 10, staleAfterMs: 30 })
  await publisher.start()
  await publisher.update({ state: 'running', runs: [sanitizeRun(run())] })
  await publisher.update({ state: 'idle', runs: [sanitizeRun(run({ status: 'succeeded', isRunning: false, finishedAt: '2026-10-25T00:00:02.000Z' }))] })
  assert.equal(publisher.timer, undefined)
  const before = await fs.stat(path.join(dir, 'bridge-a.json'))
  await new Promise((resolve) => setTimeout(resolve, 40))
  const afterStat = await fs.stat(path.join(dir, 'bridge-a.json'))
  assert.equal(afterStat.mtimeMs, before.mtimeMs)

  await fs.writeFile(path.join(dir, 'bridge-b.json'), '{"schemaVersion":1,"bridge":{"instanceId":"b"},"runs":[]}\n')
  await fs.writeFile(path.join(dir, 'notes.txt'), 'keep me')
  await publisher.update({ state: 'idle', runs: [] })
  assert.equal(await fs.readFile(path.join(dir, 'notes.txt'), 'utf8'), 'keep me')
  assert.equal(await fs.readFile(path.join(dir, 'bridge-b.json'), 'utf8'), '{"schemaVersion":1,"bridge":{"instanceId":"b"},"runs":[]}\n')
})

test('running heartbeat projects elapsed duration and last-activity age', () => {
  let now = 1_700_000_000_000
  const publisher = new StatusPublisher({
    dir: path.join(root, 'projection'),
    instanceId: 'bridge-projection',
    heartbeatMs: 5_000,
    staleAfterMs: 15_000,
    now: () => now,
    bridgeVersion: '0.1.0',
  })
  const startedAt = new Date(now - 15_000).toISOString()
  const lastEventAt = now - 14_000
  publisher.runs = [sanitizeRun(run({
    startedAt,
    durationMs: 5_000,
    lastEvent: { seq: 7, type: 'tool/call', time: lastEventAt, ageMs: 4_000 },
    lastEventAgeMs: 4_000,
    currentStep: { turn: 1, step: 1, startedAt, elapsedMs: 5_000 },
    currentTools: [{ name: 'pwsh', callId: 'c1', startedAt, elapsedMs: 5_000 }],
  }))]
  publisher.state = 'running'

  const first = publisher.payload()
  assert.equal(first.runs[0].durationMs, 15_000)
  assert.equal(first.runs[0].lastEventAgeMs, 14_000)
  assert.equal(first.runs[0].lastEvent.ageMs, 14_000)
  assert.match(first.runs[0].statusLine, /15s/)
  assert.match(first.runs[0].statusLine, /14s 前/)

  now += 10_000
  const later = publisher.payload()
  assert.equal(later.runs[0].durationMs, 25_000)
  assert.equal(later.runs[0].lastEventAgeMs, 24_000)
  assert.match(later.runs[0].statusLine, /25s/)

  const terminal = projectRun(sanitizeRun(run({
    status: 'succeeded',
    isRunning: false,
    startedAt,
    finishedAt: new Date(now - 10_000).toISOString(),
    durationMs: 5_000,
    lastEvent: { seq: 9, type: 'turn/end', time: now - 10_000, ageMs: 4_000 },
    lastEventAgeMs: 4_000,
  })), now)
  assert.equal(terminal.durationMs, 5_000)
  assert.equal(terminal.lastEventAgeMs, 4_000)
})

test('status config supports disable and custom directory', () => {
  const disabled = createStatusPublisher({ DSH_MCP_STATUS_DISABLED: '1' })
  assert.equal(disabled, null)
  const config = resolveStatusConfig({ DSH_MCP_STATUS_DIR: 'H:\\tmp\\status', DSH_MCP_STATUS_HEARTBEAT_MS: '2000', DSH_MCP_STATUS_STALE_MS: '5000' })
  assert.equal(config.dir, 'H:\\tmp\\status')
  assert.equal(config.heartbeatMs, 2_000)
  assert.equal(config.staleAfterMs, 5_000)
})

test('publisher reports write failures without throwing through update()', async () => {
  const messages = []
  const publisher = new StatusPublisher({
    dir: path.join(root, 'blocked'),
    instanceId: 'bridge-fail',
    log: (message) => messages.push(message),
  })
  // Make the parent a file: mkdir/rename under it must fail.
  await fs.mkdir(root, { recursive: true })
  await fs.writeFile(path.join(root, 'blocked'), 'not a directory')
  await publisher.update({ state: 'idle', runs: [] })
  assert.equal(messages.length > 0, true)
  assert.match(messages[0], /status write failed/)
})
