import assert from 'node:assert/strict'
import test from 'node:test'
import { RunState } from '../src/run-state.mjs'

const usage = (inputTokens, outputTokens, cacheReadTokens = 0, cacheWriteTokens = 0, totalTokens) => ({
  inputTokens,
  outputTokens,
  cacheReadTokens,
  cacheWriteTokens,
  totalTokens: totalTokens ?? inputTokens + outputTokens + cacheReadTokens + cacheWriteTokens,
})

const event = (seq, type, time, data) => ({ seq, type, time, data })

function twoStepRun(baselineSeq = -1, queuedAt = 1_000) {
  const state = new RunState({ sessionId: 'session-test', baselineSeq, queuedAt })
  state.apply(event(1, 'turn/start', 1_100, { turn: 1 }))
  state.apply(event(2, 'step/start', 1_200, { turn: 1, step: 1 }))
  state.apply(event(3, 'assistant/message', 1_300, {
    turn: 1,
    step: 1,
    usage: usage(5_324, 836, 5_760, 0, 11_920),
    message: { content: [{ type: 'text', text: 'first' }] },
  }))
  state.apply(event(4, 'tool/call', 1_400, { turn: 1, step: 1, callId: 'call-1', name: 'pwsh', arguments: 'secret-arg' }))
  state.apply(event(5, 'tool/result', 1_500, { turn: 1, step: 1, message: { toolCallId: 'call-1', isError: false } }))
  state.apply(event(6, 'step/end', 1_600, { turn: 1, step: 1 }))
  state.apply(event(7, 'step/start', 1_700, { turn: 1, step: 2 }))
  state.apply(event(8, 'assistant/message', 1_800, {
    turn: 1,
    step: 2,
    usage: usage(180, 72, 11_776, 0, 12_028),
    message: { content: [{ type: 'text', text: 'final' }] },
  }))
  state.apply(event(9, 'step/end', 1_900, { turn: 1, step: 2 }))
  state.apply(event(10, 'turn/end', 2_500, { turn: 1, reason: { kind: 'completed' } }))
  return state
}

test('multi-step provider usage accumulates across steps', () => {
  const view = twoStepRun().view(3_000)
  assert.equal(view.status, 'succeeded')
  assert.equal(view.durationMs, 1_400)
  assert.equal(view.startedAtMs, 1_100)
  assert.equal(view.finishedAtMs, 2_500)
  assert.equal(view.usage.countedSamples, 2)
  assert.equal(view.usage.steps, 2)
  assert.equal(view.usage.uncachedInputTokens, 5_504)
  assert.equal(view.usage.cacheReadTokens, 17_536)
  assert.equal(view.usage.cacheWriteTokens, 0)
  assert.equal(view.usage.outputTokens, 908)
  assert.equal(view.usage.totalTokens, 23_948)
  assert.equal(view.usage.complete, true)
  assert.equal(view.usage.partial, false)
  assert.equal(view.usage.scope, 'run')
  assert.equal(view.usage.resumedHistoryIncluded, false)
  assert.equal(view.assistantText, 'final')
})

test('same attempt sample replacement does not double count', () => {
  const state = new RunState({ sessionId: 's', queuedAt: 1_000 })
  state.apply(event(1, 'turn/start', 1_000, { turn: 1 }))
  state.apply(event(2, 'step/start', 1_000, { turn: 1, step: 1 }))
  state.apply(event(3, 'assistant/attempt', 1_100, {
    turn: 1,
    step: 1,
    stream: [{ type: 'chunk', chunk: { type: 'usage', usage: usage(100, 10, 50, 0, 160) } }],
  }))
  state.apply(event(4, 'assistant/attempt', 1_200, {
    turn: 1,
    step: 1,
    stream: [{ type: 'chunk', chunk: { type: 'usage', usage: usage(120, 12, 60, 0, 192) } }],
  }))
  state.apply(event(5, 'assistant/message', 1_300, {
    turn: 1,
    step: 1,
    usage: usage(130, 13, 70, 0, 213),
    message: { content: [] },
  }))
  state.apply(event(6, 'turn/end', 1_400, { turn: 1, reason: { kind: 'completed' } }))
  const view = state.view(1_500)
  assert.equal(view.usage.countedSamples, 1)
  assert.equal(view.usage.uncachedInputTokens, 130)
  assert.equal(view.usage.cacheReadTokens, 70)
  assert.equal(view.usage.totalTokens, 213)
})

test('retry closes the replacement slot and adds a second attempt', () => {
  const state = new RunState({ sessionId: 's', queuedAt: 1_000 })
  state.apply(event(1, 'turn/start', 1_000, { turn: 1 }))
  state.apply(event(2, 'step/start', 1_000, { turn: 1, step: 1 }))
  state.apply(event(3, 'assistant/attempt', 1_100, {
    turn: 1,
    step: 1,
    stream: [{ type: 'chunk', chunk: { type: 'usage', usage: usage(100, 10, 50, 0, 160) } }],
  }))
  state.apply(event(4, 'llm/retry-started', 1_200, { turn: 1, step: 1 }))
  state.apply(event(5, 'assistant/attempt', 1_300, {
    turn: 1,
    step: 1,
    stream: [{ type: 'chunk', chunk: { type: 'usage', usage: usage(200, 20, 80, 0, 300) } }],
  }))
  state.apply(event(6, 'turn/end', 1_400, { turn: 1, reason: { kind: 'completed' } }))
  const view = state.view(1_500)
  assert.equal(view.usage.countedSamples, 2)
  assert.equal(view.usage.attempts, 2)
  assert.equal(view.usage.steps, 1)
  assert.equal(view.usage.uncachedInputTokens, 300)
  assert.equal(view.usage.totalTokens, 460)
})

test('missing and invalid usage stay explicit instead of becoming zero', () => {
  const empty = new RunState({ sessionId: 's', queuedAt: 1_000 })
  empty.apply(event(1, 'turn/start', 1_000, { turn: 1 }))
  empty.apply(event(2, 'assistant/message', 1_100, { turn: 1, step: 1, message: { content: [] } }))
  assert.equal(empty.view(1_200).usage, null)
  assert.match(empty.view(1_200).usageUnavailableReason, /no provider-reported usage/)

  const invalid = new RunState({ sessionId: 's', queuedAt: 1_000 })
  invalid.apply(event(1, 'turn/start', 1_000, { turn: 1 }))
  invalid.apply(event(2, 'assistant/message', 1_100, {
    turn: 1,
    step: 1,
    usage: { inputTokens: -1, outputTokens: 5 },
  }))
  invalid.apply(event(3, 'turn/end', 1_200, { turn: 1, reason: { kind: 'completed' } }))
  const view = invalid.view(1_300)
  assert.equal(view.usage, null)
  assert.match(view.usageUnavailableReason, /could not be normalized/)

  const partial = new RunState({ sessionId: 's', queuedAt: 1_000 })
  partial.apply(event(1, 'turn/start', 1_000, { turn: 1 }))
  partial.apply(event(2, 'assistant/message', 1_100, {
    turn: 1,
    step: 1,
    usage: { inputTokens: 10, outputTokens: 2, totalTokens: 12 },
  }))
  partial.apply(event(3, 'turn/end', 1_200, { turn: 1, reason: { kind: 'completed' } }))
  const partialView = partial.view(1_300)
  assert.notEqual(partialView.usage, null)
  assert.equal(partialView.usage.partial, true)
  assert.deepEqual(partialView.usage.missingBuckets, ['cacheReadTokens', 'cacheWriteTokens'])
  assert.equal(partialView.usage.cacheReadTokens, null)
  assert.equal(partialView.usage.totalTokens, 12)
})

test('duplicate events are ignored and do not inflate totals', () => {
  const state = new RunState({ sessionId: 's', queuedAt: 1_000 })
  const sample = event(1, 'assistant/message', 1_000, { turn: 1, step: 1, usage: usage(10, 2, 0, 0, 12) })
  state.apply(sample)
  state.apply(sample)
  const view = state.view(1_100)
  assert.equal(view.usage.countedSamples, 1)
  assert.equal(view.usage.totalTokens, 12)
  assert.equal(view.ignoredDuplicateEvents, 1)
})

test('a resume run counts only events after its baseline', () => {
  const state = new RunState({ sessionId: 's', baselineSeq: 10, queuedAt: 2_000 })
  state.apply(event(5, 'assistant/message', 500, { turn: 1, step: 1, usage: usage(999, 99, 0, 0, 1_098) }))
  state.apply(event(11, 'turn/start', 2_100, { turn: 2 }))
  state.apply(event(12, 'assistant/message', 2_200, {
    turn: 2,
    step: 1,
    usage: usage(10, 2, 0, 0, 12),
    message: { content: [{ type: 'text', text: 'resumed' }] },
  }))
  const view = state.view(2_300)
  assert.equal(view.usage.totalTokens, 12)
  assert.equal(view.usage.scope, 'run')
  assert.equal(view.usage.resumedHistoryIncluded, false)
})

test('tool result pairing uses message.toolCallId/isError and supports concurrent tools', () => {
  const state = new RunState({ sessionId: 's', queuedAt: 1_000 })
  state.apply(event(1, 'turn/start', 1_000, { turn: 1 }))
  state.apply(event(2, 'step/start', 1_000, { turn: 1, step: 1 }))
  state.apply(event(3, 'tool/call', 1_100, { turn: 1, step: 1, callId: 'a', name: 'read' }))
  state.apply(event(4, 'tool/call', 1_200, { turn: 1, step: 1, callId: 'b', name: 'pwsh' }))
  let view = state.view(1_250)
  assert.deepEqual(view.currentTools.map((tool) => tool.name).sort(), ['pwsh', 'read'])

  state.apply(event(5, 'tool/result', 1_300, { turn: 1, step: 1, message: { toolCallId: 'a', isError: false } }))
  view = state.view(1_350)
  assert.deepEqual(view.currentTools.map((tool) => tool.name), ['pwsh'])
  const read = view.toolCalls.find((tool) => tool.callId === 'a')
  assert.equal(read.status, 'completed')

  state.apply(event(6, 'tool/result', 1_400, { turn: 1, step: 1, message: { toolCallId: 'b', isError: true } }))
  state.apply(event(7, 'step/end', 1_500, { turn: 1, step: 1 }))
  view = state.view(1_600)
  const pwsh = view.toolCalls.find((tool) => tool.callId === 'b')
  assert.equal(pwsh.status, 'error')
  assert.equal(pwsh.error, 'tool reported an error')
  assert.deepEqual(view.currentTools, [])
})

test('a step with no provider usage prevents a complete claim', () => {
  const state = new RunState({ sessionId: 's', queuedAt: 1_000 })
  state.apply(event(1, 'turn/start', 1_000, { turn: 1 }))
  state.apply(event(2, 'step/start', 1_100, { turn: 1, step: 1 }))
  state.apply(event(3, 'assistant/message', 1_200, {
    turn: 1,
    step: 1,
    usage: usage(10, 2, 0, 0, 12),
    message: { content: [{ type: 'text', text: 'first' }] },
  }))
  state.apply(event(4, 'step/end', 1_300, { turn: 1, step: 1 }))
  state.apply(event(5, 'step/start', 1_400, { turn: 1, step: 2 }))
  state.apply(event(6, 'assistant/message', 1_500, {
    turn: 1,
    step: 2,
    message: { content: [{ type: 'text', text: 'second without usage' }] },
  }))
  state.apply(event(7, 'step/end', 1_600, { turn: 1, step: 2 }))
  state.apply(event(8, 'turn/end', 1_700, { turn: 1, reason: { kind: 'completed' } }))
  const view = state.view(1_800)
  assert.equal(view.usage.totalTokens, 12)
  assert.equal(view.usage.complete, false)
  assert.equal(view.usage.partial, true)
  assert.equal(view.usage.expectedSteps, 2)
  assert.equal(view.usage.stepsWithUsage, 1)
  assert.deepEqual(view.usage.missingUsageSteps.map((item) => item.step), [2])
  assert.match(view.usage.note, /without usage/)
})

test('turn errors and interruption map to terminal statuses', () => {
  const errored = new RunState({ sessionId: 's', queuedAt: 1_000 })
  errored.apply(event(1, 'turn/start', 1_000, { turn: 1 }))
  errored.apply(event(2, 'turn/end', 1_100, { turn: 1, reason: { kind: 'error', error: { code: 'x', message: 'boom' } } }))
  assert.equal(errored.view(1_200).status, 'error')

  const interrupted = new RunState({ sessionId: 's', queuedAt: 1_000 })
  interrupted.apply(event(1, 'turn/start', 1_000, { turn: 1 }))
  interrupted.apply(event(2, 'turn/end', 1_100, { turn: 1, reason: { kind: 'interrupted' } }))
  assert.equal(interrupted.view(1_200).status, 'interrupted')
})

test('request/context replaces the window and clears it when the route omits one', () => {
  const state = new RunState({ sessionId: 's', queuedAt: 1_000 })
  assert.equal(state.view(1_000).contextWindow, null)

  state.apply(event(1, 'turn/start', 1_000, { turn: 1 }))
  state.apply(event(2, 'request/context', 1_100, { provider: 'p', model: 'm', contextWindow: 128_000 }))
  assert.equal(state.view(1_200).contextWindow, 128_000)
  // The window survives unrelated events and turns.
  state.apply(event(3, 'turn/start', 1_300, { turn: 2 }))
  assert.equal(state.view(1_400).contextWindow, 128_000)

  // A model switch with its own declared capacity updates the window.
  state.apply(event(4, 'request/context', 1_500, { provider: 'p', model: 'm2', contextWindow: 64_000 }))
  assert.equal(state.view(1_600).contextWindow, 64_000)

  // The official record omits contextWindow when the new route has no
  // declared capacity; the previous window must not survive that switch.
  state.apply(event(5, 'request/context', 1_700, { provider: 'p', model: 'm3' }))
  assert.equal(state.view(1_800).contextWindow, null)

  // Malformed capacities are unknown, not carried over from the last request.
  state.apply(event(6, 'request/context', 1_900, { provider: 'p', model: 'm3', contextWindow: 32_000 }))
  assert.equal(state.view(2_000).contextWindow, 32_000)
  state.apply(event(7, 'request/context', 2_100, { provider: 'p', model: 'm4', contextWindow: 0 }))
  assert.equal(state.view(2_200).contextWindow, null)
  state.apply(event(8, 'request/context', 2_300, { provider: 'p', model: 'm5', contextWindow: 1.5 }))
  assert.equal(state.view(2_400).contextWindow, null)
})

test('currentTurn is exposed only as a non-negative safe integer', () => {
  const state = new RunState({ sessionId: 's', queuedAt: 1_000 })
  assert.equal(state.view(1_000).currentTurn, null)
  state.apply(event(1, 'turn/start', 1_100, { turn: 3 }))
  assert.equal(state.view(1_200).currentTurn, 3)
  state.apply(event(2, 'turn/start', 1_300, { turn: -1 }))
  assert.equal(state.view(1_400).currentTurn, null)
  state.apply(event(3, 'turn/start', 1_500, { turn: 1.25 }))
  assert.equal(state.view(1_600).currentTurn, null)
  state.apply(event(4, 'turn/start', 1_700, { turn: '9' }))
  assert.equal(state.view(1_800).currentTurn, null)
})

test('progress counts only real step ends and tool statuses', () => {
  const state = new RunState({ sessionId: 's', queuedAt: 1_000 })
  state.apply(event(1, 'turn/start', 1_000, { turn: 1 }))
  state.apply(event(2, 'step/start', 1_100, { turn: 1, step: 1 }))
  state.apply(event(3, 'tool/call', 1_200, { turn: 1, step: 1, callId: 'a', name: 'read' }))
  state.apply(event(4, 'tool/result', 1_300, { turn: 1, step: 1, message: { toolCallId: 'a', isError: false } }))
  state.apply(event(5, 'tool/call', 1_400, { turn: 1, step: 1, callId: 'b', name: 'pwsh' }))
  state.apply(event(6, 'tool/result', 1_500, { turn: 1, step: 1, message: { toolCallId: 'b', isError: true } }))

  // The first step is still running, so no step counts as completed yet.
  assert.deepEqual(state.view(1_550).progress, { completedSteps: 0, toolCalls: 2, completedToolCalls: 1 })

  state.apply(event(7, 'step/end', 1_600, { turn: 1, step: 1 }))
  state.apply(event(8, 'step/start', 1_700, { turn: 1, step: 2 }))
  state.apply(event(9, 'tool/call', 1_800, { turn: 1, step: 2, callId: 'c', name: 'edit' }))
  state.apply(event(10, 'step/end', 1_900, { turn: 1, step: 2 }))
  // The tool without a result became unknown when its step ended.
  assert.deepEqual(state.view(1_950).progress, { completedSteps: 2, toolCalls: 3, completedToolCalls: 1 })

  state.apply(event(11, 'step/start', 2_000, { turn: 1, step: 3 }))
  state.apply(event(12, 'turn/end', 2_100, { turn: 1, reason: { kind: 'interrupted' } }))
  // turn/end closes the open step for duration bookkeeping, but no step/end
  // arrived, so it is not reported as a completed step.
  assert.deepEqual(state.view(2_200).progress, { completedSteps: 2, toolCalls: 3, completedToolCalls: 1 })
})
