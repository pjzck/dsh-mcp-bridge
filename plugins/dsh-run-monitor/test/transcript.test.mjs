import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import test, { after } from 'node:test'
import { fileURLToPath } from 'node:url'
import {
  API_PATH,
  apply,
  createApiHandler,
} from '../lib/index.js'
import {
  MAX_MESSAGE_TEXT,
  MAX_TOOL_ARGUMENTS,
  MAX_TOOL_RESULT,
  TRANSCRIPT_DEFAULT_LIMIT,
  TRANSCRIPT_MAX_LIMIT,
  projectTranscriptEvents,
} from '../lib/transcript.js'

const here = path.dirname(fileURLToPath(import.meta.url))
const root = path.join(here, '..', '..', '.smoke-workspace', `transcript-test-${process.pid}-${Date.now()}`)
const NOW = Date.parse('2026-10-30T12:00:00.000Z')
const T = Date.parse('2026-10-30T11:00:00.000Z')

after(async () => {
  await fs.rm(root, { recursive: true, force: true })
})

function user(seq, text, source = { kind: 'user' }) {
  return {
    type: 'user/message',
    seq,
    time: T + seq,
    data: {
      id: `user-message-${seq}`,
      role: 'user',
      content: [{ type: 'text', text }],
      source,
    },
  }
}

function assistant(seq, content) {
  return {
    type: 'assistant/message',
    seq,
    time: T + seq,
    data: {
      turn: 1,
      step: 1,
      message: {
        id: `assistant-message-${seq}`,
        role: 'assistant',
        content,
        source: { kind: 'model', provider: 'deepseek-official', model: 'deepseek-flash' },
      },
    },
  }
}

function toolCall(seq, callId, name, args) {
  return {
    type: 'tool/call',
    seq,
    time: T + seq,
    data: { turn: 1, step: 1, callId, name, arguments: args },
  }
}

test('pairs Desktop 0.2 SDK tool results with top-level message fields', () => {
  const value=projectTranscriptEvents([toolCall(1,'old-sdk','pwsh','{}'),{seq:2,time:T+2,type:'tool/result',data:{message:{toolCallId:'old-sdk',isError:true,content:[{type:'text',text:'command failed'}]}}}])
  assert.equal(value.entries.length,1)
  assert.equal(value.entries[0].status,'error')
  assert.equal(value.entries[0].result,'command failed')
})

function toolResult(seq, callId, text, { isError = false, error } = {}) {
  return {
    type: 'tool/result',
    seq,
    time: T + seq,
    data: {
      turn: 1,
      step: 1,
      message: {
        id: `tool-result-${seq}`,
        role: 'user',
        source: { kind: 'tool', callId },
        content: [{
          type: 'tool-result',
          toolCallId: callId,
          content: text === undefined ? [] : [{ type: 'text', text }],
          ...(isError ? { isError: true } : {}),
        }],
      },
      ...(error === undefined ? {} : { error }),
    },
  }
}

function turnEnd(seq, turn, reason) {
  return { type: 'turn/end', seq, time: T + seq, data: { turn, reason } }
}

function statusDocument(instanceId, sessionIds) {
  const stamp = new Date(T).toISOString()
  return {
    schemaVersion: 1,
    kind: 'dsh-run-monitor',
    bridge: {
      instanceId,
      pid: process.pid,
      version: '0.1.0',
      state: 'idle',
      startedAt: stamp,
      updatedAt: stamp,
      heartbeatAt: stamp,
      heartbeatIntervalMs: 5000,
      staleAfterMs: 15000,
    },
    runs: sessionIds.map((sessionId, index) => ({
      sessionId,
      cwd: 'H:\\workspace\\repo',
      provider: 'deepseek-official',
      model: 'deepseek-flash',
      status: 'succeeded',
      isRunning: false,
      startedAt: new Date(T + index).toISOString(),
      finishedAt: new Date(T + index + 1).toISOString(),
      durationMs: 1000,
      statusLine: '已完成',
    })),
  }
}

async function createAuthDir(name = 'auth') {
  const dir = path.join(root, name)
  await fs.mkdir(path.join(dir, 'archive'), { recursive: true })
  await fs.writeFile(path.join(dir, 'bridge-a.json'), JSON.stringify(statusDocument('bridge-a', ['session-a'])))
  await fs.writeFile(path.join(dir, 'archive', 'bridge-b.json'), JSON.stringify(statusDocument('bridge-b', ['session-b'])))
  return dir
}

function handlerFor(dir, readSession, extra = {}) {
  return createApiHandler({ statusDir: dir, now: () => NOW, readSession, ...extra })
}

test('projects real event shapes and omits non-public content', async () => {
  const dir = await createAuthDir('shape')
  let readSessionId
  const events = [
    { type: 'turn/start', seq: 0, time: T, data: { turn: 1 } },
    {
      type: 'request/header',
      seq: 1,
      time: T + 1,
      data: {
        header: {
          config: { provider: 'deepseek-official', model: 'deepseek-flash' },
          system: 'TOP SECRET SYSTEM',
          tools: [{ name: 'pwsh', description: 'TOP SECRET TOOL SCHEMA' }],
        },
        reason: 'initial',
      },
    },
    {
      ...user(2, '你好'),
      data: {
        ...user(2, '你好').data,
        content: [
          { type: 'text', text: '你好' },
          { type: 'reasoning', text: 'PRIVATE THOUGHT' },
        ],
      },
    },
    { type: 'step/start', seq: 3, time: T + 3, data: { turn: 1, step: 1 } },
    assistant(4, [
      { type: 'reasoning', text: 'PRIVATE REASONING' },
      { type: 'text', text: '回答' },
      { type: 'tool-call', id: 'c1', name: 'pwsh', arguments: '{"cmd":"dir"}' },
    ]),
    {
      type: 'assistant/chunk',
      seq: 5,
      time: T + 5,
      data: { turn: 1, step: 1, chunk: { type: 'text-delta', text: 'PRIVATE CHUNK' } },
    },
    toolCall(6, 'c1', 'pwsh', '{"cmd":"dir"}'),
    toolResult(7, 'c1', '输出'),
    { type: 'step/end', seq: 8, time: T + 8, data: { turn: 1, step: 1 } },
    assistant(9, [{ type: 'tool-call', id: 'c2', name: 'read', arguments: '{"path":"a"}' }]),
    toolCall(10, 'c2', 'read', '{"path":"a"}'),
    turnEnd(11, 1, { kind: 'completed' }),
    user(12, 'SYSTEM INSTRUCTIONS', { kind: 'plugin', plugin: 'test' }),
    user(13, 'GOAL ROUND', { kind: 'goal', goalId: 'g1' }),
    turnEnd(14, 2, { kind: 'error', error: { code: 'E_FAIL', message: 'provider exploded' } }),
  ]

  const api = handlerFor(dir, async (sessionId) => {
    readSessionId = sessionId
    return { session: { id: sessionId }, events }
  })
  const response = await api({ method: 'transcript', bridgeInstanceId: 'bridge-a', sessionId: 'session-a' })
  assert.equal(response.status, 200)
  assert.equal(response.body.ok, true)
  const value = response.body.value
  assert.equal(readSessionId, 'session-a')
  assert.equal(value.sessionId, 'session-a')
  assert.equal(value.bridgeInstanceId, 'bridge-a')
  assert.equal(value.readOnly, true)
  assert.equal(value.lastSeq, 14)
  assert.equal(value.hasOlder, false)
  assert.equal(value.beforeSeq, null)
  assert.deepEqual(value.entries.map((entry) => [entry.seq, entry.kind]), [
    [2, 'user'],
    [4, 'assistant'],
    [6, 'tool'],
    [10, 'tool'],
    [11, 'event'],
    [14, 'event'],
  ])

  const userEntry = value.entries[0]
  assert.equal(userEntry.id, 'user:2')
  assert.equal(userEntry.text, '你好')
  assert.equal(userEntry.time, T + 2)

  const assistantEntry = value.entries[1]
  assert.equal(assistantEntry.id, 'assistant:4')
  assert.equal(assistantEntry.text, '回答')

  const paired = value.entries[2]
  assert.equal(paired.id, 'c1')
  assert.equal(paired.callId, 'c1')
  assert.equal(paired.toolName, 'pwsh')
  assert.equal(paired.arguments, '{"cmd":"dir"}')
  assert.equal(paired.result, '输出')
  assert.equal(paired.status, 'ok')
  assert.equal(paired.truncated, undefined)

  const pending = value.entries[3]
  assert.equal(pending.id, 'c2')
  assert.equal(pending.status, 'pending')
  assert.equal('result' in pending, false)

  assert.equal(value.entries[4].status, 'completed')
  assert.match(value.entries[4].text, /第 1 轮结束/)
  assert.equal(value.entries[5].status, 'error')
  assert.match(value.entries[5].text, /第 2 轮失败/)
  assert.match(value.entries[5].text, /E_FAIL/)
  assert.match(value.entries[5].text, /provider exploded/)

  const serialized = JSON.stringify(value)
  for (const secret of [
    'TOP SECRET SYSTEM',
    'TOP SECRET TOOL SCHEMA',
    'PRIVATE THOUGHT',
    'PRIVATE REASONING',
    'PRIVATE CHUNK',
    'SYSTEM INSTRUCTIONS',
    'GOAL ROUND',
  ]) {
    assert.equal(serialized.includes(secret), false, `${secret} must not be exposed`)
  }
  assert.equal(serialized.includes('"events"'), false)
  assert.equal(serialized.includes('request/header'), false)
})

test('sorts events by seq and ignores malformed envelopes', () => {
  const projected = projectTranscriptEvents([
    user(5, 'later'),
    { type: 'user/message', seq: 'bad', data: { content: [] } },
    { type: 'assistant/message', seq: 3, data: { message: { content: [{ type: 'text', text: 'earlier' }] } } },
    null,
    { type: 'step/start', seq: 9, time: T, data: { turn: 1, step: 1 } },
    user(1, 'first'),
  ])
  assert.deepEqual(projected.entries.map((entry) => entry.seq), [1, 3, 5])
  assert.equal(projected.lastSeq, 9)
})

test('pairs tool call/result once and keeps orphan or failed results', () => {
  const projected = projectTranscriptEvents([
    toolCall(0, 'c1', 'pwsh', '{"cmd":"dir"}'),
    toolResult(1, 'c1', 'boom', { isError: true, error: { name: 'ToolError', code: 'E_FAIL' } }),
    toolResult(2, 'c1', 'second'),
    toolCall(3, 'c1', 'pwsh', '{"cmd":"ignored"}'),
    toolResult(4, 'c2', 'orphan'),
    toolResult(5, 'c3', undefined, { error: { name: 'ToolError', code: 'E_EMPTY' } }),
    toolResult(6, '', 'no call id'),
  ])
  const entries = projected.entries
  assert.deepEqual(entries.map((entry) => entry.id), ['c1', 'c2', 'c3'])
  assert.equal(entries[0].status, 'error')
  assert.equal(entries[0].result, 'boom')
  assert.equal(entries[0].seq, 0)
  assert.equal(entries[1].status, 'ok')
  assert.equal(entries[1].result, 'orphan')
  assert.equal(entries[2].status, 'error')
  assert.equal(entries[2].result, 'ToolError: E_EMPTY')
  assert.equal(projected.lastSeq, 6)
})

test('pages projected entries with a strict beforeSeq cursor', async () => {
  const dir = await createAuthDir('paging')
  const events = Array.from({ length: 250 }, (_value, seq) => user(seq, `message-${seq}`))
  const api = handlerFor(dir, async () => ({ events }))

  const first = await api({ method: 'transcript', bridgeInstanceId: 'bridge-a', sessionId: 'session-a' })
  assert.equal(first.status, 200)
  assert.equal(first.body.value.entries.length, TRANSCRIPT_DEFAULT_LIMIT)
  assert.equal(first.body.value.entries[0].seq, 170)
  assert.equal(first.body.value.entries.at(-1).seq, 249)
  assert.equal(first.body.value.hasOlder, true)
  assert.equal(first.body.value.beforeSeq, 170)
  assert.equal(first.body.value.lastSeq, 249)

  const second = await api({
    method: 'transcript',
    bridgeInstanceId: 'bridge-a',
    sessionId: 'session-a',
    beforeSeq: 170,
  })
  assert.deepEqual(second.body.value.entries.map((entry) => entry.seq), Array.from({ length: 80 }, (_value, index) => 90 + index))
  assert.equal(second.body.value.hasOlder, true)
  assert.equal(second.body.value.beforeSeq, 90)

  const third = await api({
    method: 'transcript',
    bridgeInstanceId: 'bridge-a',
    sessionId: 'session-a',
    beforeSeq: 90,
  })
  assert.equal(third.body.value.entries[0].seq, 10)
  assert.equal(third.body.value.entries.at(-1).seq, 89)
  assert.equal(third.body.value.beforeSeq, 10)
  assert.equal(third.body.value.hasOlder, true)

  const last = await api({
    method: 'transcript',
    bridgeInstanceId: 'bridge-a',
    sessionId: 'session-a',
    beforeSeq: 10,
  })
  assert.deepEqual(last.body.value.entries.map((entry) => entry.seq), Array.from({ length: 10 }, (_value, index) => index))
  assert.equal(last.body.value.hasOlder, false)
  assert.equal(last.body.value.beforeSeq, null)
  assert.equal(last.body.value.lastSeq, 249)

  const empty = await api({
    method: 'transcript',
    bridgeInstanceId: 'bridge-a',
    sessionId: 'session-a',
    beforeSeq: 0,
  })
  assert.deepEqual(empty.body.value.entries, [])
  assert.equal(empty.body.value.hasOlder, false)
  assert.equal(empty.body.value.beforeSeq, null)
  assert.equal(empty.body.value.lastSeq, 249)

  const capped = await api({
    method: 'transcript',
    bridgeInstanceId: 'bridge-a',
    sessionId: 'session-a',
    limit: 1000,
  })
  assert.equal(capped.body.value.entries.length, TRANSCRIPT_MAX_LIMIT)
  assert.equal(capped.body.value.entries[0].seq, 50)
  assert.equal(capped.body.value.hasOlder, true)
  assert.equal(capped.body.value.beforeSeq, 50)

  for (const page of [first, second, third, last, empty, capped]) {
    const seqs = page.body.value.entries.map((entry) => entry.seq)
    assert.deepEqual(seqs, [...seqs].sort((left, right) => left - right))
  }
})

test('rejects malformed or malicious transcript parameters before reading', async () => {
  const dir = await createAuthDir('validation')
  let reads = 0
  const api = handlerFor(dir, async () => {
    reads += 1
    return { events: [user(0, 'hello')] }
  })

  const cases = [
    [{ method: 'transcript' }, 'invalid-argument'],
    [{ method: 'transcript', bridgeInstanceId: 'bridge-a' }, 'invalid-argument'],
    [{ method: 'transcript', sessionId: 'session-a' }, 'invalid-argument'],
    [{ method: 'transcript', bridgeInstanceId: '', sessionId: 'session-a' }, 'invalid-argument'],
    [{ method: 'transcript', bridgeInstanceId: 'bridge-a\n', sessionId: 'session-a' }, 'invalid-argument'],
    [{ method: 'transcript', bridgeInstanceId: 1, sessionId: 'session-a' }, 'invalid-argument'],
    [{ method: 'transcript', bridgeInstanceId: 'bridge-a', sessionId: 'x'.repeat(201) }, 'invalid-argument'],
    [{ method: 'transcript', bridgeInstanceId: 'bridge-a', sessionId: 'session-a', limit: 0 }, 'invalid-argument'],
    [{ method: 'transcript', bridgeInstanceId: 'bridge-a', sessionId: 'session-a', limit: 1.5 }, 'invalid-argument'],
    [{ method: 'transcript', bridgeInstanceId: 'bridge-a', sessionId: 'session-a', limit: '80' }, 'invalid-argument'],
    [{ method: 'transcript', bridgeInstanceId: 'bridge-a', sessionId: 'session-a', beforeSeq: -1 }, 'invalid-argument'],
    [{ method: 'transcript', bridgeInstanceId: 'bridge-a', sessionId: 'session-a', beforeSeq: 1.5 }, 'invalid-argument'],
    [{ method: 'transcript', bridgeInstanceId: 'bridge-a', sessionId: 'session-a', beforeSeq: '1' }, 'invalid-argument'],
    [{ method: 'other', bridgeInstanceId: 'bridge-a', sessionId: 'session-a' }, 'invalid-method'],
    [{ method: ['transcript'], bridgeInstanceId: 'bridge-a', sessionId: 'session-a' }, 'invalid-method'],
  ]
  for (const [body, code] of cases) {
    const response = await api(body)
    assert.equal(response.status, 400, JSON.stringify(body))
    assert.equal(response.body.ok, false)
    assert.equal(response.body.error.code, code, JSON.stringify(body))
    assert.equal(typeof response.body.error.message, 'string')
    assert.equal(typeof response.body.error.details, 'object')
  }

  for (const body of [null, [], 'not-an-object', 42]) {
    const response = await api(body)
    assert.equal(response.status, 400)
    assert.equal(response.body.error.code, 'invalid-body')
  }
  assert.equal(reads, 0)
})

test('authorizes current and archived runs before calling the query service', async () => {
  const dir = await createAuthDir('authorization')
  let calls = 0
  const api = handlerFor(dir, async (sessionId) => {
    calls += 1
    return { events: [user(0, `hello-${sessionId}`)] }
  })

  const current = await api({ method: 'transcript', bridgeInstanceId: 'bridge-a', sessionId: 'session-a' })
  assert.equal(current.status, 200)
  assert.equal(calls, 1)

  const archived = await api({ method: 'transcript', bridgeInstanceId: 'bridge-b', sessionId: 'session-b' })
  assert.equal(archived.status, 200)
  assert.equal(archived.body.value.entries[0].text, 'hello-session-b')
  assert.equal(calls, 2)

  const rejected = [
    { bridgeInstanceId: 'bridge-b', sessionId: 'session-a' },
    { bridgeInstanceId: 'bridge-a', sessionId: 'session-b' },
    { bridgeInstanceId: 'bridge-a', sessionId: 'session-missing' },
    { bridgeInstanceId: 'bridge-missing', sessionId: 'session-a' },
  ]
  for (const ids of rejected) {
    const response = await api({ method: 'transcript', ...ids })
    assert.equal(response.status, 403, JSON.stringify(ids))
    assert.equal(response.body.ok, false)
    assert.equal(response.body.error.code, 'not-authorized')
  }
  assert.equal(calls, 2, 'unauthorized requests must never reach readSession')
})

test('reports unavailable and read failures without breaking state', async () => {
  const dir = await createAuthDir('failures')
  const unavailableApi = createApiHandler({ statusDir: dir, now: () => NOW })
  const unavailable = await unavailableApi({ method: 'transcript', bridgeInstanceId: 'bridge-a', sessionId: 'session-a' })
  assert.equal(unavailable.status, 503)
  assert.equal(unavailable.body.ok, false)
  assert.equal(unavailable.body.error.code, 'unavailable')

  const failingApi = handlerFor(dir, async () => {
    throw new Error('persistence exploded')
  })
  const failed = await failingApi({ method: 'transcript', bridgeInstanceId: 'bridge-a', sessionId: 'session-a' })
  assert.equal(failed.status, 502)
  assert.equal(failed.body.error.code, 'session-read-failed')
  assert.equal(JSON.stringify(failed.body).includes('persistence exploded'), false)

  const state = await failingApi({ method: 'state' })
  assert.equal(state.status, 200)
  assert.equal(state.body.ok, true)
  assert.equal(state.body.value.files.length, 1)

  const malformedApi = handlerFor(dir, async () => ({ events: 'not-an-array' }))
  const malformed = await malformedApi({ method: 'transcript', bridgeInstanceId: 'bridge-a', sessionId: 'session-a' })
  assert.equal(malformed.status, 502)
  assert.equal(malformed.body.error.code, 'session-read-failed')
})

test('truncates long fields and keeps the serialized response bounded', async () => {
  const dir = await createAuthDir('truncation')
  const events = [
    user(0, 'x'.repeat(MAX_MESSAGE_TEXT + 100)),
    assistant(1, [{ type: 'text', text: 'y'.repeat(MAX_MESSAGE_TEXT + 1) }]),
    toolCall(2, 'c1', 'pwsh', 'a'.repeat(MAX_TOOL_ARGUMENTS + 1)),
    toolResult(3, 'c1', 'r'.repeat(MAX_TOOL_RESULT + 1)),
  ]
  const api = handlerFor(dir, async () => ({ events }))
  const response = await api({ method: 'transcript', bridgeInstanceId: 'bridge-a', sessionId: 'session-a' })
  assert.equal(response.status, 200)
  const entries = response.body.value.entries
  assert.equal(entries[0].text.length, MAX_MESSAGE_TEXT)
  assert.equal(entries[0].truncated, true)
  assert.equal(entries[1].text.length, MAX_MESSAGE_TEXT)
  assert.equal(entries[1].truncated, true)
  assert.equal(entries[2].arguments.length, MAX_TOOL_ARGUMENTS)
  assert.equal(entries[2].truncated, true)
  assert.equal(entries[2].result.length, MAX_TOOL_RESULT)
  assert.equal(entries[2].truncated, true)
  assert.equal(entries[2].status, 'ok')

  const bigEvents = Array.from({ length: 100 }, (_value, seq) => user(seq, 'z'.repeat(MAX_MESSAGE_TEXT)))
  const budget = 64 * 1024
  const boundedApi = handlerFor(dir, async () => ({ events: bigEvents }), { maxResponseBytes: budget })
  const bounded = await boundedApi({ method: 'transcript', bridgeInstanceId: 'bridge-a', sessionId: 'session-a', limit: 200 })
  assert.equal(bounded.status, 200)
  const page = bounded.body.value
  assert.ok(page.entries.length > 0)
  assert.ok(page.entries.length < 100)
  assert.ok(Buffer.byteLength(JSON.stringify(page.entries), 'utf8') <= budget + 2)
  assert.equal(page.entries.at(-1).seq, 99)
  assert.equal(page.entries[0].seq, 100 - page.entries.length)
  assert.equal(page.hasOlder, true)
  assert.equal(page.beforeSeq, page.entries[0].seq)
  assert.equal(page.lastSeq, 99)
})

test('authorization reads snapshots without running the archive pass', async () => {
  const dir = path.join(root, 'no-maintenance')
  await fs.mkdir(dir, { recursive: true })
  const document = statusDocument('bridge-a', ['session-a'])
  document.bridge.pid = 2147483647
  document.bridge.state = 'stopped'
  document.bridge.heartbeatAt = new Date(T - 60_000).toISOString()
  document.bridge.updatedAt = new Date(T - 60_000).toISOString()
  const file = path.join(dir, 'bridge-a.json')
  await fs.writeFile(file, JSON.stringify(document))
  const old = new Date(T - 60_000)
  await fs.utimes(file, old, old)

  const api = handlerFor(dir, async () => ({ events: [user(0, 'still here')] }))
  const response = await api({ method: 'transcript', bridgeInstanceId: 'bridge-a', sessionId: 'session-a' })
  assert.equal(response.status, 200)
  assert.equal(response.body.value.entries[0].text, 'still here')
  await fs.stat(file)
  await assert.rejects(fs.stat(path.join(dir, 'archive', 'bridge-a.json')), (error) => error.code === 'ENOENT')
})

test('the registered POST endpoint dispatches state and transcript', async () => {
  const dir = await createAuthDir('endpoint')
  let registration
  const services = {}
  const ctx = {
    connection: { fetch: { register(entry) { registration = entry } } },
    get(name) { return services[name] },
  }
  apply(ctx, { statusDir: dir })
  assert.equal(registration.path, API_PATH)
  assert.deepEqual(registration.methods, ['POST'])
  assert.equal(registration.requestBody, 'buffered')

  const request = (body, contentType = 'application/json') => registration.fetch(new Request('http://localhost/api/dsh-run-monitor', {
    method: 'POST',
    headers: { 'content-type': contentType },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  }))

  const state = await request({ method: 'state' })
  assert.equal(state.status, 200)
  assert.equal(state.headers.get('cache-control'), 'no-store')
  const stateBody = await state.json()
  assert.equal(stateBody.ok, true)
  assert.equal(stateBody.value.files.length, 1)

  const unavailable = await request({ method: 'transcript', bridgeInstanceId: 'bridge-a', sessionId: 'session-a' })
  assert.equal(unavailable.status, 503)
  assert.equal((await unavailable.json()).error.code, 'unavailable')

  let readSessionId
  services.sessionQuery = {
    async readSession(sessionId) {
      readSessionId = sessionId
      return { events: [user(0, 'from endpoint')] }
    },
  }
  const transcript = await request({
    method: 'transcript',
    bridgeInstanceId: 'bridge-a',
    sessionId: 'session-a',
    beforeSeq: 999,
    limit: 20,
  })
  assert.equal(transcript.status, 200)
  assert.equal(transcript.headers.get('cache-control'), 'no-store')
  const transcriptBody = await transcript.json()
  assert.equal(readSessionId, 'session-a')
  assert.equal(transcriptBody.ok, true)
  assert.equal(transcriptBody.value.readOnly, true)
  assert.equal(transcriptBody.value.entries[0].text, 'from endpoint')
  assert.equal(transcriptBody.value.lastSeq, 0)

  const wrongType = await request({ method: 'state' }, 'text/plain')
  assert.equal(wrongType.status, 415)
  const wrongTypeBody = await wrongType.json()
  assert.equal(wrongTypeBody.ok, false)
  assert.equal(wrongTypeBody.error.message, 'content type must be application/json')

  const brokenJson = await request('{"method":')
  assert.equal(brokenJson.status, 400)
  assert.equal((await brokenJson.json()).error.code, 'invalid-body')

  const arrayBody = await request('[]')
  assert.equal(arrayBody.status, 400)
  assert.equal((await arrayBody.json()).error.code, 'invalid-body')

  const unknownMethod = await request({ method: 'remove', bridgeInstanceId: 'bridge-a', sessionId: 'session-a' })
  assert.equal(unknownMethod.status, 400)
  assert.equal((await unknownMethod.json()).error.code, 'invalid-method')

  const badParams = await request({
    method: 'transcript',
    bridgeInstanceId: 'bridge-a',
    sessionId: 'session-a',
    beforeSeq: -1,
  })
  assert.equal(badParams.status, 400)
  assert.equal((await badParams.json()).error.code, 'invalid-argument')

  const polluted = await request(
    '{"method":"transcript","bridgeInstanceId":"bridge-a","sessionId":"session-a","__proto__":{"polluted":true}}',
  )
  assert.equal(polluted.status, 200)
  assert.equal({}.polluted, undefined)
  assert.equal((await polluted.json()).value.entries[0].text, 'from endpoint')

  const afterFailures = await request({ method: 'state' })
  assert.equal(afterFailures.status, 200)
  assert.equal((await afterFailures.json()).ok, true)
})
