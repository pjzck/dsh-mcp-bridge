import assert from 'node:assert/strict'
import test from 'node:test'
import { DshManager } from '../src/manager.mjs'
import { RunState } from '../src/run-state.mjs'

const usage = (inputTokens, outputTokens, cacheReadTokens = 0, cacheWriteTokens = 0) => ({
  inputTokens,
  outputTokens,
  cacheReadTokens,
  cacheWriteTokens,
  totalTokens: inputTokens + outputTokens + cacheReadTokens + cacheWriteTokens,
})

const event = (seq, type, time, data) => ({ seq, type, time, data })

class FakeRuntime {
  constructor() {
    this.exited = false
    this.baselineSeq = -1
    this.state = undefined
    this.promptError = undefined
    this.waitResult = true
    this.waitError = undefined
    this.promptCalls = 0
    this.onStateChange = undefined
    this.onRuntimeExit = undefined
    this.sessions = new Set()
    this.child = undefined
    this.initialized = true
    this.permissionMode = 'danger-full-access'
    this.now = () => Date.now()
  }

  async start() { return this }
  async kill() {}
  async shutdown() {}
  baseline() { return this.baselineSeq }
  hasSession() { return true }
  async resume() {}
  async prompt() {
    this.promptCalls += 1
    if (this.promptError !== undefined) throw this.promptError
    return { messageId: 'message-1' }
  }
  async wait() {
    if (this.waitError !== undefined) throw this.waitError
    return this.waitResult
  }
  beginRun(sessionId, baselineSeq, queuedAt) {
    this.state = new RunState({ sessionId, baselineSeq, queuedAt })
    return this.state
  }
  snapshot(sessionId, baselineSeq) {
    const view = this.state.view(this.now())
    return {
      ...view,
      status: view.status === 'queued' ? 'running' : view.status,
      liveStatus: 'running',
      runtimeExited: this.exited,
      subagents: [],
    }
  }
  emit(events) {
    for (const item of events) this.state.apply(item)
    this.onStateChange?.()
  }
  exit(message) {
    this.exited = true
    this.onRuntimeExit?.(new Error(message))
  }
}

function makeManager() {
  const runtime = new FakeRuntime()
  let now = 1_000
  const clock = () => now
  runtime.now = clock
  const manager = new DshManager(
    { DSH_MCP_PROVIDER: 'deepseek-official', DSH_MCP_MODEL: 'deepseek-flash', DSH_HOME: process.cwd() },
    { runtimeFactory: () => runtime, statusPublisher: null, now: clock },
  )
  return {
    manager,
    runtime,
    advance(ms) { now += ms },
    setNow(value) { now = value },
  }
}

async function startRun(manager) {
  return manager.start({ task: 'do work', cwd: process.cwd() })
}

test('start returns running and completed run freezes duration and usage', async () => {
  const { manager, runtime, setNow } = makeManager()
  const started = await startRun(manager)
  assert.equal(started.status, 'running')
  assert.equal(started.isRunning, true)
  assert.match(started.statusLine, /运行中/)
  assert.equal(started.finishedAt, null)

  runtime.emit([
    event(1, 'turn/start', 1_100, { turn: 1 }),
    event(2, 'step/start', 1_200, { turn: 1, step: 1 }),
    event(3, 'assistant/message', 1_300, {
      turn: 1,
      step: 1,
      usage: usage(5_324, 836, 5_760, 0, 11_920),
      message: { content: [{ type: 'text', text: 'working' }] },
    }),
    event(4, 'step/end', 1_400, { turn: 1, step: 1 }),
    event(5, 'turn/end', 2_500, { turn: 1, reason: { kind: 'completed' } }),
  ])
  setNow(3_000)
  const done = manager.get(started.sessionId)
  assert.equal(done.status, 'succeeded')
  assert.equal(done.isRunning, false)
  assert.equal(done.durationMs, 1_400)
  assert.equal(done.usage.totalTokens, 11_920)
  assert.equal(done.usage.complete, true)
  assert.match(done.statusLine, /已完成/)
  const finishedAt = done.finishedAt

  setNow(30_000)
  const later = manager.get(started.sessionId)
  assert.equal(later.durationMs, 1_400)
  assert.equal(later.finishedAt, finishedAt)
})

test('a finished session can be continued without a prior get/wait', async () => {
  const { manager, runtime } = makeManager()
  const started = await startRun(manager)
  runtime.emit([
    event(1, 'turn/start', 1_100, { turn: 1 }),
    event(2, 'step/start', 1_200, { turn: 1, step: 1 }),
    event(3, 'assistant/message', 1_300, {
      turn: 1,
      step: 1,
      usage: usage(10, 2, 0, 0),
      message: { content: [{ type: 'text', text: 'first turn' }] },
    }),
    event(4, 'step/end', 1_400, { turn: 1, step: 1 }),
    event(5, 'turn/end', 1_500, { turn: 1, reason: { kind: 'completed' } }),
  ])
  // No get/wait: the cached run.status is still "running".
  const continued = await manager.start({ task: 'second turn', cwd: process.cwd(), sessionId: started.sessionId })
  assert.equal(continued.status, 'running')
  assert.equal(runtime.promptCalls, 2)
})

test('a genuinely running session still blocks a second prompt', async () => {
  const { manager, runtime } = makeManager()
  const started = await startRun(manager)
  runtime.emit([event(1, 'turn/start', 1_100, { turn: 1 })])
  await assert.rejects(
    () => manager.start({ task: 'second turn', cwd: process.cwd(), sessionId: started.sessionId }),
    /already has an active run/,
  )
})

test('runtime exit does not leave a run running forever', async () => {
  const { manager, runtime, setNow } = makeManager()
  const started = await startRun(manager)
  runtime.emit([event(1, 'turn/start', 1_100, { turn: 1 })])
  setNow(2_000)
  runtime.exit('SDK crashed for the test')
  const errored = manager.get(started.sessionId)
  assert.equal(errored.status, 'error')
  assert.equal(errored.isRunning, false)
  assert.equal(errored.durationMs, 900)
  assert.match(errored.error.message, /SDK crashed/)
  const finishedAt = errored.finishedAt

  setNow(20_000)
  const later = manager.get(started.sessionId)
  assert.equal(later.durationMs, 900)
  assert.equal(later.finishedAt, finishedAt)
  assert.equal(later.isRunning, false)
})

test('wait timeout returns the running snapshot and does not finish the run', async () => {
  const { manager, runtime } = makeManager()
  runtime.waitResult = false
  const started = await startRun(manager)
  runtime.emit([event(1, 'turn/start', 1_100, { turn: 1 })])
  const waited = await manager.wait(started.sessionId, 100)
  assert.equal(waited.status, 'running')
  assert.equal(waited.timedOut, true)
  assert.equal(waited.isRunning, true)
})

test('list and info expose the same live summary and publication is sanitized', async () => {
  const updates = []
  const publisher = {
    dir: 'C:/tmp/status',
    file: 'C:/tmp/status/bridge-test.json',
    instanceId: 'bridge-test',
    heartbeatMs: 5_000,
    staleAfterMs: 15_000,
    async update(payload) { updates.push(payload) },
    async stop() { updates.push({ stopped: true }) },
  }
  const runtime = new FakeRuntime()
  let now = 1_000
  runtime.now = () => now
  const manager = new DshManager(
    { DSH_MCP_PROVIDER: 'p', DSH_MCP_MODEL: 'm', DSH_HOME: process.cwd() },
    { runtimeFactory: () => runtime, statusPublisher: publisher, now: () => now },
  )
  const started = await startRun(manager)
  runtime.emit([
    event(1, 'turn/start', 1_100, { turn: 1 }),
    event(2, 'request/context', 1_150, { provider: 'p', model: 'm', contextWindow: 64_000 }),
    event(3, 'step/start', 1_200, { turn: 1, step: 1 }),
    event(4, 'tool/call', 1_300, { turn: 1, step: 1, callId: 'c', name: 'pwsh', arguments: 'TOP SECRET' }),
    event(5, 'assistant/message', 1_400, {
      turn: 1,
      step: 1,
      usage: usage(10, 2, 3, 0),
      message: { content: [{ type: 'text', text: 'PRIVATE ANSWER' }] },
    }),
  ])
  await manager.publish()
  assert.ok(updates.length >= 1)
  const latest = updates[updates.length - 1]
  assert.equal(latest.state, 'running')
  assert.equal(latest.runs.length, 1)
  assert.match(latest.runs[0].statusLine, /运行中/)
  assert.equal(latest.runs[0].usage.totalTokens, 15)
  assert.equal(latest.runs[0].currentTurn, 1)
  assert.equal(latest.runs[0].contextWindow, 64_000)
  assert.deepEqual(latest.runs[0].progress, { completedSteps: 0, toolCalls: 1, completedToolCalls: 0 })
  assert.equal(JSON.stringify(latest).includes('TOP SECRET'), false)
  assert.equal(JSON.stringify(latest).includes('PRIVATE ANSWER'), false)

  const list = manager.list()
  assert.equal(list.length, 1)
  assert.equal(list[0].sessionId, started.sessionId)
  assert.match(list[0].statusLine, /运行中/)
  assert.equal(list[0].usage.totalTokens, 15)
  assert.equal(list[0].currentTool.name, 'pwsh')
  assert.equal(list[0].currentTurn, 1)
  assert.equal(list[0].contextWindow, 64_000)
  assert.deepEqual(list[0].progress, { completedSteps: 0, toolCalls: 1, completedToolCalls: 0 })
  const info = manager.info()
  assert.equal(info.statusPublisher.enabled, true)
  assert.equal(info.runs.length, 1)

  runtime.emit([
    event(6, 'tool/result', 1_500, { turn: 1, step: 1, message: { toolCallId: 'c', isError: false } }),
    event(7, 'step/end', 1_600, { turn: 1, step: 1 }),
    event(8, 'turn/end', 2_500, { turn: 1, reason: { kind: 'completed' } }),
  ])
  now = 3_000
  await manager.publish()
  assert.equal(updates[updates.length - 1].state, 'idle')
  assert.equal(updates[updates.length - 1].runs[0].isRunning, false)
  assert.equal(updates[updates.length - 1].runs[0].durationMs, 1_400)
  assert.deepEqual(updates[updates.length - 1].runs[0].progress, { completedSteps: 1, toolCalls: 1, completedToolCalls: 1 })
})
