import assert from 'node:assert/strict'
import test from 'node:test'
import { RunState, normalizeProviderUsage } from '../src/run-state.mjs'

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

test('duration is frozen after turn/end and clamped non-negative', () => {
  const state = twoStepRun()
  const first = state.view(3_000)
  const later = state.view(30_000)
  assert.equal(first.durationMs, 1_400)
  assert.equal(later.durationMs, 1_400)
  assert.equal(later.finishedAtMs, 2_500)

  const backwards = new RunState({ sessionId: 's', queuedAt: 5_000 })
  backwards.apply(event(1, 'turn/start', 5_000, { turn: 1 }))
  backwards.apply(event(2, 'turn/end', 4_000, { turn: 1, reason: { kind: 'completed' } }))
  assert.equal(backwards.view(6_000).durationMs, 0)
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

test('normalizeProviderUsage rejects contradictory totals and missing cache', () => {
  assert.equal(normalizeProviderUsage({ inputTokens: 10, outputTokens: 2, totalTokens: 12 }).ok, true)
  assert.equal(normalizeProviderUsage({ inputTokens: 10, outputTokens: 2 }).ok, false)
  assert.equal(normalizeProviderUsage({ inputTokens: 10, outputTokens: 2, cacheReadTokens: 3, cacheWriteTokens: 0, totalTokens: 20 }).ok, false)
  assert.equal(normalizeProviderUsage({ inputTokens: 10, outputTokens: 2, cacheReadTokens: 3, cacheWriteTokens: 0, totalTokens: 16 }).ok, false)
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

test('usage survives more than 2000 events and recent events stay capped', () => {
  const state = new RunState({ sessionId: 's', queuedAt: 1_000 })
  let seq = 1
  state.apply(event(seq++, 'turn/start', 1_000, { turn: 1 }))
  for (let index = 0; index < 700; index += 1) {
    state.apply(event(seq++, 'tool/call', 1_000 + index, { turn: 1, step: 1, callId: `c${index}`, name: 'read' }))
    state.apply(event(seq++, 'tool/result', 1_000 + index, { turn: 1, step: 1, message: { toolCallId: `c${index}`, isError: false } }))
    state.apply(event(seq++, 'step/start', 1_000 + index, { turn: 1, step: 1 }))
  }
  state.apply(event(seq++, 'assistant/message', 5_000, { turn: 1, step: 1, usage: usage(10, 2, 0, 0, 12) }))
  state.apply(event(seq++, 'turn/end', 5_100, { turn: 1, reason: { kind: 'completed' } }))
  const view = state.view(6_000)
  assert.ok(view.eventsSeen > 2_000)
  assert.equal(view.recentEvents.length, 80)
  assert.equal(view.usage.totalTokens, 12)
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

test('step end does not leave an unpaired tool advertised as current', () => {
  const state = new RunState({ sessionId: 's', queuedAt: 1_000 })
  state.apply(event(1, 'turn/start', 1_000, { turn: 1 }))
  state.apply(event(2, 'step/start', 1_000, { turn: 1, step: 1 }))
  state.apply(event(3, 'tool/call', 1_100, { turn: 1, step: 1, callId: 'a', name: 'read' }))
  state.apply(event(4, 'step/end', 1_200, { turn: 1, step: 1 }))
  const view = state.view(1_300)
  assert.deepEqual(view.currentTools, [])
  assert.equal(view.toolCalls[0].status, 'unknown')
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

test('a step that ended without any settlement is also incomplete', () => {
  const state = new RunState({ sessionId: 's', queuedAt: 1_000 })
  state.apply(event(1, 'turn/start', 1_000, { turn: 1 }))
  state.apply(event(2, 'step/start', 1_100, { turn: 1, step: 1 }))
  state.apply(event(3, 'step/end', 1_200, { turn: 1, step: 1 }))
  state.apply(event(4, 'turn/end', 1_300, { turn: 1, reason: { kind: 'completed' } }))
  const view = state.view(1_400)
  assert.equal(view.usage, null)
  assert.match(view.usageUnavailableReason, /no usable provider usage/)
  assert.equal(view.usage === null, true)
})

test('missing step/start or step/end boundaries are not silently complete', () => {
  const missingStart = new RunState({ sessionId: 's', queuedAt: 1_000 })
  missingStart.apply(event(1, 'turn/start', 1_000, { turn: 1 }))
  missingStart.apply(event(2, 'assistant/message', 1_100, {
    turn: 1,
    step: 1,
    usage: usage(10, 2, 0, 0, 12),
  }))
  missingStart.apply(event(3, 'turn/end', 1_200, { turn: 1, reason: { kind: 'completed' } }))
  const noStart = missingStart.view(1_300)
  assert.equal(noStart.usage.complete, false)
  assert.ok(noStart.usage.missingBoundaries.some((item) => item.step === 1))

  const missingEnd = new RunState({ sessionId: 's', queuedAt: 1_000 })
  missingEnd.apply(event(1, 'turn/start', 1_000, { turn: 1 }))
  missingEnd.apply(event(2, 'step/start', 1_100, { turn: 1, step: 1 }))
  missingEnd.apply(event(3, 'assistant/message', 1_200, {
    turn: 1,
    step: 1,
    usage: usage(10, 2, 0, 0, 12),
  }))
  missingEnd.apply(event(4, 'turn/end', 1_300, { turn: 1, reason: { kind: 'completed' } }))
  const noEnd = missingEnd.view(1_400)
  assert.equal(noEnd.usage.complete, false)
  assert.ok(noEnd.usage.missingBoundaries.some((item) => item.step === 1))
})

test('unsafe single samples and unsafe aggregate totals are rejected', () => {
  assert.equal(normalizeProviderUsage({
    inputTokens: Number.MAX_SAFE_INTEGER,
    outputTokens: 1,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
  }).ok, false)
  assert.equal(normalizeProviderUsage({
    inputTokens: Number.MAX_SAFE_INTEGER,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    totalTokens: Number.MAX_SAFE_INTEGER,
  }).ok, true)

  const state = new RunState({ sessionId: 's', queuedAt: 1_000 })
  state.apply(event(1, 'turn/start', 1_000, { turn: 1 }))
  for (const step of [1, 2]) {
    state.apply(event(step * 2, 'step/start', 1_000 + step, { turn: 1, step }))
    state.apply(event(step * 2 + 1, 'assistant/message', 1_000 + step * 10, {
      turn: 1,
      step,
      usage: {
        inputTokens: Number.MAX_SAFE_INTEGER,
        outputTokens: 0,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        totalTokens: Number.MAX_SAFE_INTEGER,
      },
    }))
    state.apply(event(step * 2 + 2, 'step/end', 1_000 + step * 20, { turn: 1, step }))
  }
  state.apply(event(9, 'turn/end', 1_500, { turn: 1, reason: { kind: 'completed' } }))
  const view = state.view(1_600)
  assert.equal(view.usage, null)
  assert.match(view.usageUnavailableReason, /safe integer/)
})

test('invalid usage samples cap their stored reasons', () => {
  const state = new RunState({ sessionId: 's', queuedAt: 1_000 })
  state.apply(event(1, 'turn/start', 1_000, { turn: 1 }))
  for (let step = 1; step <= 15; step += 1) {
    state.apply(event(step * 2, 'assistant/message', 1_000 + step, {
      turn: 1,
      step,
      usage: { inputTokens: -1, outputTokens: 1 },
    }))
  }
  state.apply(event(99, 'turn/end', 2_000, { turn: 1, reason: { kind: 'completed' } }))
  const view = state.view(2_100)
  assert.equal(view.usage, null)
  assert.equal(view.usageUnavailableReason.length < 2_000, true)
})

test('a retry attempt without usage cannot hide behind an earlier attempt', () => {
  const state = new RunState({ sessionId: 's', queuedAt: 1_000 })
  state.apply(event(1, 'turn/start', 1_000, { turn: 1 }))
  state.apply(event(2, 'step/start', 1_100, { turn: 1, step: 1 }))
  state.apply(event(3, 'assistant/attempt', 1_200, {
    turn: 1,
    step: 1,
    stream: [{ type: 'chunk', chunk: { type: 'usage', usage: usage(10, 5, 0, 0, 15) } }],
  }))
  state.apply(event(4, 'llm/retry', 1_300, { turn: 1, step: 1 }))
  state.apply(event(5, 'llm/retry-started', 1_400, { turn: 1, step: 1 }))
  state.apply(event(6, 'assistant/message', 1_500, { turn: 1, step: 1, message: { content: [] } }))
  state.apply(event(7, 'step/end', 1_600, { turn: 1, step: 1 }))
  state.apply(event(8, 'turn/end', 1_700, { turn: 1, reason: { kind: 'completed' } }))
  const view = state.view(1_800)
  assert.equal(view.usage.totalTokens, 15)
  assert.equal(view.usage.complete, false)
  assert.equal(view.usage.partial, true)
  assert.equal(view.usage.expectedAttempts, 2)
  assert.equal(view.usage.attemptsWithUsage, 1)
  assert.deepEqual(view.usage.missingUsageAttempts.map((item) => item.attempt), [1])
})

test('a retry attempt with its own usage is complete', () => {
  const state = new RunState({ sessionId: 's', queuedAt: 1_000 })
  state.apply(event(1, 'turn/start', 1_000, { turn: 1 }))
  state.apply(event(2, 'step/start', 1_100, { turn: 1, step: 1 }))
  state.apply(event(3, 'assistant/attempt', 1_200, {
    turn: 1,
    step: 1,
    stream: [{ type: 'chunk', chunk: { type: 'usage', usage: usage(10, 5, 0, 0, 15) } }],
  }))
  state.apply(event(4, 'llm/retry-started', 1_300, { turn: 1, step: 1 }))
  state.apply(event(5, 'assistant/attempt', 1_400, {
    turn: 1,
    step: 1,
    stream: [{ type: 'chunk', chunk: { type: 'usage', usage: usage(20, 6, 0, 0, 26) } }],
  }))
  state.apply(event(6, 'step/end', 1_500, { turn: 1, step: 1 }))
  state.apply(event(7, 'turn/end', 1_600, { turn: 1, reason: { kind: 'completed' } }))
  const view = state.view(1_700)
  assert.equal(view.usage.totalTokens, 41)
  assert.equal(view.usage.complete, true)
  assert.equal(view.usage.expectedAttempts, 2)
  assert.equal(view.usage.attemptsWithUsage, 2)
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
