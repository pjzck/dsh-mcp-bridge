import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import test, { after } from 'node:test'
import { fileURLToPath } from 'node:url'
import {
  StatusPublisher,
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

test('sanitizeRun passes live window, turn and progress fields through when valid', () => {
  const sanitized = sanitizeRun(run({
    currentTurn: 3,
    contextWindow: 128_000,
    progress: { completedSteps: 2, toolCalls: 3, completedToolCalls: 1 },
  }))
  assert.equal(sanitized.currentTurn, 3)
  assert.equal(sanitized.contextWindow, 128_000)
  assert.deepEqual(sanitized.progress, { completedSteps: 2, toolCalls: 3, completedToolCalls: 1 })
})

test('sanitizeRun rejects malformed window, turn and progress values', () => {
  const invalid = sanitizeRun(run({
    currentTurn: -1,
    contextWindow: 0,
    progress: { completedSteps: 1.5, toolCalls: -2, completedToolCalls: '3' },
  }))
  assert.equal('currentTurn' in invalid, false)
  assert.equal('contextWindow' in invalid, false)
  assert.equal('progress' in invalid, false)

  const overflow = sanitizeRun(run({
    currentTurn: Number.MAX_SAFE_INTEGER + 1,
    contextWindow: Number.MAX_SAFE_INTEGER + 1,
    progress: { completedSteps: Number.NaN, toolCalls: Number.POSITIVE_INFINITY },
  }))
  assert.equal('currentTurn' in overflow, false)
  assert.equal('contextWindow' in overflow, false)
  assert.equal('progress' in overflow, false)

  // Valid counters survive next to malformed siblings; the bad values never do.
  const mixed = sanitizeRun(run({
    progress: { completedSteps: 2, toolCalls: '3', completedToolCalls: Number.NaN },
  }))
  assert.deepEqual(mixed.progress, { completedSteps: 2 })
})

test('publisher writes no empty snapshot before the first task and then publishes atomically', async () => {
  const dir = path.join(root, 'atomic')
  const publisher = new StatusPublisher({
    dir,
    instanceId: 'bridge-test',
    heartbeatMs: 15,
    staleAfterMs: 45,
    bridgeVersion: '9.9.9',
  })
  const file = path.join(dir, 'bridge-test.json')
  await publisher.start()
  await assert.rejects(fs.stat(file), (error) => error.code === 'ENOENT', 'start must not create an empty file')

  await publisher.update({ state: 'idle', runs: [] })
  await assert.rejects(fs.stat(file), (error) => error.code === 'ENOENT', 'idle without history must not create a file')
  assert.equal(publisher.timer, undefined)

  await publisher.update({ state: 'running', runs: [sanitizeRun(run())], updatedAt: 1_000 })
  let payload = await readPayload(file)
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

test('publisher keeps empty idle and stopped snapshots after the first task', async () => {
  const dir = path.join(root, 'retain')
  const file = path.join(dir, 'bridge-retain.json')
  const publisher = new StatusPublisher({ dir, instanceId: 'bridge-retain' })
  await publisher.start()

  await publisher.update({ state: 'running', runs: [sanitizeRun(run())] })
  assert.equal((await readPayload(file)).bridge.state, 'running')

  // Once a task has been published the file is history: an idle pass and the
  // shutdown tombstone are still written, even when the caller clears runs.
  await publisher.update({ state: 'idle', runs: [] })
  let payload = await readPayload(file)
  assert.equal(payload.bridge.state, 'idle')
  assert.deepEqual(payload.runs, [])

  await publisher.stop()
  payload = await readPayload(file)
  assert.equal(payload.bridge.state, 'stopped')
  assert.deepEqual(payload.runs, [])
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
