/**
 * Incremental, replay-free view of one DSH run.
 *
 * The SDK delivers every session event exactly once over `session.event`, but
 * the bridge may receive duplicates after a reconnect and the raw event list is
 * capped at 2000 entries. Aggregates therefore live here, updated event by
 * event, and never depend on the retained event array.
 *
 * Usage semantics mirror `@deepseek-ai/dsh-token-meter` (stateVersion 2):
 * - one sample belongs to a `(turn, step)` attempt;
 * - a later sample for the same attempt replaces the earlier one;
 * - `llm/retry-started` closes the replacement slot, so the retried attempt is
 *   counted separately;
 * - usage may arrive on `assistant/message` (`data.usage`) or on
 *   `assistant/message` / `assistant/attempt` (`data.stream` last usage chunk).
 */

const MAX_RECENT_EVENTS = 80
const MAX_TOOL_CALLS = 200
const MAX_ASSISTANT_TEXT = 50_000

function isCount(value) {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
}

/** Add token counts only while the exact integer result stays representable. */
function safeAdd(...values) {
  let total = 0
  for (const value of values) {
    if (!isCount(value)) return undefined
    total += value
    if (!Number.isSafeInteger(total)) return undefined
  }
  return total
}

function finiteTime(value) {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : undefined
}

function lastStreamUsage(stream) {
  if (!Array.isArray(stream)) return undefined
  for (let index = stream.length - 1; index >= 0; index -= 1) {
    const record = stream[index]
    if (record?.type === 'chunk' && record.chunk?.type === 'usage') return record.chunk.usage
  }
  return undefined
}

/**
 * Normalize one provider usage sample. Returns `{ ok: false, reason }` instead
 * of inventing zeroes when a required field is missing or contradictory.
 */
export function normalizeProviderUsage(raw) {
  if (raw === null || typeof raw !== 'object') {
    return { ok: false, reason: 'provider usage is missing' }
  }
  const { inputTokens, outputTokens, cacheReadTokens, cacheWriteTokens, totalTokens } = raw
  if (!isCount(inputTokens) || !isCount(outputTokens)) {
    return { ok: false, reason: 'provider usage lacks non-negative inputTokens/outputTokens' }
  }
  if (cacheReadTokens !== undefined && !isCount(cacheReadTokens)) {
    return { ok: false, reason: 'cacheReadTokens is not a non-negative integer' }
  }
  if (cacheWriteTokens !== undefined && !isCount(cacheWriteTokens)) {
    return { ok: false, reason: 'cacheWriteTokens is not a non-negative integer' }
  }
  const knownPrompt = safeAdd(inputTokens, cacheReadTokens ?? 0, cacheWriteTokens ?? 0)
  if (knownPrompt === undefined) {
    return { ok: false, reason: 'usage buckets exceed the safe integer range' }
  }
  let exactTotal
  if (totalTokens !== undefined) {
    if (!isCount(totalTokens)) return { ok: false, reason: 'totalTokens is not a non-negative integer' }
    const exactPrompt = totalTokens - outputTokens
    if (!Number.isSafeInteger(exactPrompt) || exactPrompt < 0 || exactPrompt < knownPrompt) {
      return { ok: false, reason: 'totalTokens contradicts the reported buckets or is not a safe integer' }
    }
    if (cacheReadTokens !== undefined && cacheWriteTokens !== undefined && exactPrompt !== knownPrompt) {
      return { ok: false, reason: 'totalTokens does not equal input + cache buckets + output' }
    }
    exactTotal = totalTokens
  } else {
    if (cacheReadTokens === undefined || cacheWriteTokens === undefined) {
      return { ok: false, reason: 'usage has neither totalTokens nor both cache buckets' }
    }
    exactTotal = safeAdd(knownPrompt, outputTokens)
    if (exactTotal === undefined) {
      return { ok: false, reason: 'derived total tokens exceed the safe integer range' }
    }
  }
  return {
    ok: true,
    usage: {
      uncachedInputTokens: inputTokens,
      outputTokens,
      cacheReadTokens,
      cacheWriteTokens,
      totalTokens: exactTotal,
    },
  }
}

function usageOfEvent(event) {
  if (event.type === 'assistant/message' && event.data?.usage !== undefined) {
    return event.data.usage
  }
  if (event.type !== 'assistant/message' && event.type !== 'assistant/attempt') return undefined
  return lastStreamUsage(event.data?.stream)
}

function bucketsEqual(left, right) {
  return left.uncachedInputTokens === right.uncachedInputTokens
    && left.outputTokens === right.outputTokens
    && left.cacheReadTokens === right.cacheReadTokens
    && left.cacheWriteTokens === right.cacheWriteTokens
    && left.totalTokens === right.totalTokens
}

function turnEndStatus(reason) {
  const kind = reason?.kind
  if (kind === 'completed') return 'succeeded'
  if (kind === 'interrupted') return 'interrupted'
  if (kind === 'error') return 'error'
  return 'error'
}

function toolStatusFromResult(data) {
  if (data?.message?.isError === true || data?.error !== undefined || data?.isError === true) return 'error'
  return 'completed'
}

function toolErrorText(data) {
  if (typeof data?.error === 'string') return data.error.slice(0, 300)
  if (data?.error?.message !== undefined) return String(data.error.message).slice(0, 300)
  if (data?.message?.isError === true) return 'tool reported an error'
  return undefined
}

export class RunState {
  /**
   * @param {object} options
   * @param {string} options.sessionId
   * @param {number} [options.baselineSeq]
   * @param {number} [options.queuedAt]
   */
  constructor({ sessionId, baselineSeq = -1, queuedAt = Date.now() }) {
    this.sessionId = sessionId
    this.baselineSeq = baselineSeq
    this.queuedAt = queuedAt
    this.lastAppliedSeq = baselineSeq
    this.eventsSeen = 0
    this.ignoredEvents = 0
    this.recentEvents = []
    this.lastEvent = undefined
    this.assistantText = ''
    this.turnStartedAt = undefined
    this.turnEndedAt = undefined
    this.currentTurn = undefined
    this.currentStep = undefined
    this.turnEnd = undefined
    /** @type {Map<string, any>} */
    this.toolCalls = new Map()
    /** @type {Map<string, any>} */
    this.currentTools = new Map()
    /** @type {Array<{turn:number, step:number, buckets:any, at:number, seq:number}>} */
    this.usageSamples = []
    this.lastUsageSample = undefined
    this.usageUpdatedAt = undefined
    this.usageLastSeq = undefined
    this.invalidUsageSamples = 0
    this.invalidUsageReasons = []
    this.contextWindow = undefined
    this.statusOverride = undefined
    /**
     * Lifecycle evidence per `(turn, step)`. A step without any normalized
     * provider sample is not a complete usage source, even if its
     * `assistant/message` arrived without `data.usage`. Each retry creates a
     * separate attempt so a later attempt cannot hide behind an earlier one.
     * @type {Map<string, {turn:number, step:number, startedAt:number, endedAt?:number, sawSettlement:boolean, sawUsage:boolean, boundaryMissing:boolean, attempts:Array<{index:number, startedAt:number, sawSettlement:boolean, sawUsage:boolean}>}>}
     */
    this.stepStates = new Map()
    this.turnBoundaryMissing = false
  }

  get terminal() {
    return this.turnEndedAt !== undefined || this.statusOverride === 'stopped' || this.statusOverride === 'error'
  }

  get status() {
    if (this.statusOverride === 'stopped') return 'stopped'
    if (this.turnEndedAt !== undefined) return turnEndStatus(this.turnEnd)
    if (this.statusOverride === 'error') return 'error'
    if (this.turnStartedAt !== undefined || this.eventsSeen > 0) return 'running'
    return 'queued'
  }

  markStopped(at = Date.now()) {
    if (this.turnEndedAt === undefined) {
      this.statusOverride = 'stopped'
      this.queuedAt = this.queuedAt ?? at
    }
    for (const tool of this.currentTools.values()) {
      tool.status = 'unknown'
      tool.finishedAt = at
    }
    this.currentTools.clear()
    this.currentStep = undefined
    this.stoppedAt = at
  }

  markError(message, at = Date.now()) {
    if (this.turnEndedAt !== undefined) return
    this.statusOverride = 'error'
    this.error = { message: String(message ?? 'DSH runtime failed'), time: at }
    for (const tool of this.currentTools.values()) {
      tool.status = 'unknown'
      tool.finishedAt = at
    }
    this.currentTools.clear()
    this.currentStep = undefined
  }

  #ensureStep(turn, step, at) {
    if (!isCount(turn) || !isCount(step)) return undefined
    const key = `${turn}:${step}`
    let state = this.stepStates.get(key)
    if (state === undefined) {
      state = {
        turn,
        step,
        startedAt: at,
        endedAt: undefined,
        sawSettlement: false,
        sawUsage: false,
        // A settlement/step boundary without a matching step/start cannot
        // prove the attempt lifecycle.
        boundaryMissing: true,
        attempts: [{ index: 0, startedAt: at, sawSettlement: false, sawUsage: false }],
      }
      this.stepStates.set(key, state)
    }
    return state
  }

  #attemptFor(stepState, at) {
    if (stepState.attempts.length === 0) {
      stepState.attempts.push({ index: 0, startedAt: at, sawSettlement: false, sawUsage: false })
    }
    return stepState.attempts[stepState.attempts.length - 1]
  }

  #startRetryAttempt(stepState, at) {
    const index = stepState.attempts.length
    const attempt = { index, startedAt: at, sawSettlement: false, sawUsage: false }
    stepState.attempts.push(attempt)
    return attempt
  }

  #closeCurrentStep(turn, step, at) {
    const state = this.#ensureStep(turn, step, at)
    if (state === undefined) return
    if (state.endedAt === undefined) state.endedAt = at
  }

  #finalizeTurn(at) {
    const turn = this.currentTurn
    let sawStepForTurn = false
    for (const step of this.stepStates.values()) {
      if (turn !== undefined && step.turn !== turn) continue
      sawStepForTurn = true
      if (step.endedAt === undefined) {
        step.endedAt = at
        step.boundaryMissing = true
      }
    }
    if (turn !== undefined && !sawStepForTurn) this.turnBoundaryMissing = true
    if (this.turnStartedAt === undefined) this.turnBoundaryMissing = true
  }

  #completeness() {
    const missingUsageSteps = []
    const missingUsageAttempts = []
    const missingBoundaries = []
    for (const step of this.stepStates.values()) {
      if (step.endedAt !== undefined && step.sawUsage !== true) {
        missingUsageSteps.push({
          turn: step.turn,
          step: step.step,
          reason: step.sawSettlement ? 'settlement carried no usable provider usage' : 'step ended without a provider usage sample',
        })
      }
      if (step.endedAt !== undefined) {
        for (const attempt of step.attempts) {
          if (attempt.sawUsage !== true) {
            missingUsageAttempts.push({
              turn: step.turn,
              step: step.step,
              attempt: attempt.index,
              reason: attempt.sawSettlement
                ? 'attempt settlement carried no usable provider usage'
                : 'attempt ended without a provider usage sample',
            })
          }
        }
      }
      if (step.boundaryMissing) {
        missingBoundaries.push({ turn: step.turn, step: step.step, reason: 'missing step/start or step/end boundary' })
      }
    }
    for (const sample of this.usageSamples) {
      const key = `${sample.turn}:${sample.step}`
      if (!this.stepStates.has(key)) {
        missingBoundaries.push({ turn: sample.turn, step: sample.step, reason: 'usage sample has no step lifecycle' })
      }
    }
    if (this.turnBoundaryMissing) {
      missingBoundaries.push({ turn: this.currentTurn ?? null, step: null, reason: 'missing turn/start or step lifecycle' })
    }
    return { missingUsageSteps, missingUsageAttempts, missingBoundaries }
  }

  /**
   * Apply one durable session event. Returns true when the view may have changed.
   * @param {any} event
   */
  apply(event) {
    if (!event || typeof event !== 'object' || typeof event.type !== 'string') return false
    const seq = Number.isFinite(event.seq) ? event.seq : undefined
    if (seq !== undefined) {
      if (seq <= this.lastAppliedSeq) {
        this.ignoredEvents += 1
        return false
      }
      this.lastAppliedSeq = seq
    }
    const at = finiteTime(event.time) ?? Date.now()
    this.eventsSeen += 1
    this.lastEvent = { seq, type: event.type, time: at }
    this.recentEvents.push({ seq, type: event.type, time: at })
    if (this.recentEvents.length > MAX_RECENT_EVENTS) {
      this.recentEvents.splice(0, this.recentEvents.length - MAX_RECENT_EVENTS)
    }

    const data = event.data ?? {}
    switch (event.type) {
      case 'turn/start':
        this.currentTurn = data.turn
        this.turnStartedAt = at
        this.turnEndedAt = undefined
        this.turnEnd = undefined
        this.statusOverride = undefined
        break
      case 'turn/end':
        this.turnEnd = data.reason
        this.turnEndedAt = at
        this.currentTurn = data.turn ?? this.currentTurn
        this.currentStep = undefined
        this.#finalizeTurn(at)
        this.closeOpenTools(at)
        break
      case 'step/start': {
        this.currentStep = {
          turn: data.turn,
          step: data.step,
          startedAt: at,
        }
        const stepState = this.#ensureStep(data.turn, data.step, at)
        if (stepState !== undefined) {
          stepState.startedAt = at
          stepState.boundaryMissing = false
        }
        break
      }
      case 'step/end': {
        if (this.currentStep !== undefined
          && (data.turn === undefined || (data.turn === this.currentStep.turn && data.step === this.currentStep.step))) {
          this.currentStep = undefined
        }
        this.#closeCurrentStep(data.turn, data.step, at)
        // A tool without a result by the end of its step is no longer running;
        // keep the call in history but stop advertising it as current.
        for (const [key, tool] of this.currentTools) {
          if (tool.turn === data.turn && tool.step === data.step) {
            tool.status = 'unknown'
            tool.finishedAt = at
            this.currentTools.delete(key)
          }
        }
        break
      }
      case 'tool/call': {
        const callId = typeof data.callId === 'string' && data.callId !== ''
          ? data.callId
          : `seq:${seq ?? this.eventsSeen}`
        const tool = {
          callId,
          name: typeof data.name === 'string' && data.name !== '' ? data.name : 'unknown',
          turn: data.turn,
          step: data.step,
          status: 'called',
          startedAt: at,
          arguments: typeof data.arguments === 'string' && data.arguments.length > 500
            ? `${data.arguments.slice(0, 500)}…`
            : data.arguments,
        }
        this.toolCalls.set(callId, tool)
        this.currentTools.set(callId, tool)
        if (this.toolCalls.size > MAX_TOOL_CALLS) {
          const first = this.toolCalls.keys().next().value
          if (first !== undefined) this.toolCalls.delete(first)
        }
        break
      }
      case 'tool/result': {
        const callId = data.message?.toolCallId ?? data.callId ?? data.toolCallId
        if (typeof callId !== 'string') break
        const tool = this.toolCalls.get(callId)
        if (tool === undefined) break
        tool.status = toolStatusFromResult(data)
        tool.finishedAt = at
        const error = toolErrorText(data)
        if (error !== undefined) tool.error = error
        this.currentTools.delete(callId)
        break
      }
      case 'assistant/message': {
        const content = data.message?.content
        if (Array.isArray(content)) {
          const text = content
            .filter((block) => block?.type === 'text' && typeof block.text === 'string')
            .map((block) => block.text)
            .join('')
          if (text !== '') this.assistantText = text.slice(0, MAX_ASSISTANT_TEXT)
        }
        const stepState = this.#ensureStep(data.turn, data.step, at)
        if (stepState !== undefined) {
          stepState.sawSettlement = true
          this.#attemptFor(stepState, at).sawSettlement = true
        }
        if (this.#recordUsage(event, at, seq) && stepState !== undefined) {
          stepState.sawUsage = true
          this.#attemptFor(stepState, at).sawUsage = true
        }
        break
      }
      case 'assistant/attempt': {
        const stepState = this.#ensureStep(data.turn, data.step, at)
        if (stepState !== undefined) {
          stepState.sawSettlement = true
          this.#attemptFor(stepState, at).sawSettlement = true
        }
        if (this.#recordUsage(event, at, seq) && stepState !== undefined) {
          stepState.sawUsage = true
          this.#attemptFor(stepState, at).sawUsage = true
        }
        break
      }
      case 'llm/retry-started': {
        if (this.lastUsageSample !== undefined
          && this.lastUsageSample.turn === data.turn
          && this.lastUsageSample.step === data.step) {
          this.lastUsageSample = undefined
        }
        const stepState = this.#ensureStep(data.turn, data.step, at)
        if (stepState !== undefined) this.#startRetryAttempt(stepState, at)
        break
      }
      case 'request/context':
        if (isCount(data.contextWindow) && data.contextWindow > 0) this.contextWindow = data.contextWindow
        break
      default:
        break
    }
    return true
  }

  #recordUsage(event, at, seq) {
    const raw = usageOfEvent(event)
    if (raw === undefined) return false
    const data = event.data ?? {}
    const turn = data.turn
    const step = data.step
    if (!isCount(turn) || !isCount(step)) {
      this.invalidUsageSamples += 1
      if (this.invalidUsageReasons.length < 10) this.invalidUsageReasons.push('usage event has no valid turn/step')
      return false
    }
    const normalized = normalizeProviderUsage(raw)
    if (!normalized.ok) {
      this.invalidUsageSamples += 1
      if (this.invalidUsageReasons.length < 10) this.invalidUsageReasons.push(normalized.reason)
      return false
    }
    const buckets = normalized.usage
    const previousIndex = this.lastUsageSample !== undefined
      && this.lastUsageSample.turn === turn
      && this.lastUsageSample.step === step
      ? this.usageSamples.length - 1
      : -1
    if (previousIndex >= 0 && bucketsEqual(this.usageSamples[previousIndex].buckets, buckets)) {
      this.usageSamples[previousIndex].at = at
      this.usageSamples[previousIndex].seq = seq
      this.usageUpdatedAt = at
      this.usageLastSeq = seq
      return true
    }
    const sample = { turn, step, buckets, at, seq }
    if (previousIndex >= 0) this.usageSamples[previousIndex] = sample
    else this.usageSamples.push(sample)
    this.lastUsageSample = sample
    this.usageUpdatedAt = at
    this.usageLastSeq = seq
    return true
  }

  #recentToolCalls(now) {
    return [...this.toolCalls.values()].map((tool) => ({
      callId: tool.callId,
      name: tool.name,
      status: tool.status,
      turn: tool.turn,
      step: tool.step,
      startedAt: iso(tool.startedAt),
      finishedAt: tool.finishedAt === undefined ? null : iso(tool.finishedAt),
      durationMs: tool.startedAt === undefined ? null : Math.max(0, (tool.finishedAt ?? now) - tool.startedAt),
      ...(tool.error === undefined ? {} : { error: tool.error }),
      ...(tool.arguments === undefined ? {} : { arguments: tool.arguments }),
    }))
  }

  #usageView() {
    const { missingUsageSteps, missingUsageAttempts, missingBoundaries } = this.#completeness()
    const final = this.turnEndedAt !== undefined
    if (this.usageSamples.length === 0) {
      let reason
      if (this.invalidUsageSamples > 0) {
        reason = `provider usage was reported but could not be normalized (${this.invalidUsageReasons.slice(0, 3).join('; ')})`
      } else if (missingUsageSteps.length > 0) {
        reason = `no usable provider usage for ${missingUsageSteps.length} completed step(s): `
          + missingUsageSteps.slice(0, 3).map((item) => `turn ${item.turn}/step ${item.step}`).join(', ')
      } else {
        reason = 'no provider-reported usage for this run yet'
      }
      return { usage: null, reason }
    }

    const totals = {
      uncachedInputTokens: 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
    }
    let cacheReadKnown = true
    let cacheWriteKnown = true
    for (const sample of this.usageSamples) {
      const uncached = safeAdd(totals.uncachedInputTokens, sample.buckets.uncachedInputTokens)
      const output = safeAdd(totals.outputTokens, sample.buckets.outputTokens)
      const total = safeAdd(totals.totalTokens, sample.buckets.totalTokens)
      if (uncached === undefined || output === undefined || total === undefined) {
        return {
          usage: null,
          reason: 'accumulated token totals exceed the safe integer range; refusing to publish an inexact number',
        }
      }
      totals.uncachedInputTokens = uncached
      totals.outputTokens = output
      totals.totalTokens = total
      if (sample.buckets.cacheReadTokens === undefined) {
        cacheReadKnown = false
      } else {
        const cacheRead = safeAdd(totals.cacheReadTokens, sample.buckets.cacheReadTokens)
        if (cacheRead === undefined) {
          return {
            usage: null,
            reason: 'accumulated cache-read tokens exceed the safe integer range; refusing to publish an inexact number',
          }
        }
        totals.cacheReadTokens = cacheRead
      }
      if (sample.buckets.cacheWriteTokens === undefined) {
        cacheWriteKnown = false
      } else {
        const cacheWrite = safeAdd(totals.cacheWriteTokens, sample.buckets.cacheWriteTokens)
        if (cacheWrite === undefined) {
          return {
            usage: null,
            reason: 'accumulated cache-write tokens exceed the safe integer range; refusing to publish an inexact number',
          }
        }
        totals.cacheWriteTokens = cacheWrite
      }
    }
    const missingBuckets = []
    if (!cacheReadKnown) missingBuckets.push('cacheReadTokens')
    if (!cacheWriteKnown) missingBuckets.push('cacheWriteTokens')
    const complete = final
      && this.invalidUsageSamples === 0
      && missingBuckets.length === 0
      && missingUsageSteps.length === 0
      && missingUsageAttempts.length === 0
      && missingBoundaries.length === 0
    const stems = new Set(this.usageSamples.map((sample) => `${sample.turn}:${sample.step}`))
    const stepsWithUsage = [...this.stepStates.values()].filter((state) => state.sawUsage === true).length
    const allAttempts = [...this.stepStates.values()].flatMap((state) => state.attempts)
    const attemptsWithUsage = allAttempts.filter((attempt) => attempt.sawUsage === true).length
    const last = this.usageSamples[this.usageSamples.length - 1]
    const missingParts = []
    if (missingUsageSteps.length > 0) missingParts.push(`${missingUsageSteps.length} step(s) without usage`)
    if (missingUsageAttempts.length > 0) missingParts.push(`${missingUsageAttempts.length} attempt(s) without usage`)
    if (missingBoundaries.length > 0) missingParts.push(`${missingBoundaries.length} missing lifecycle boundary`)
    if (missingBuckets.length > 0) missingParts.push(`missing ${missingBuckets.join('/')}`)
    if (this.invalidUsageSamples > 0) missingParts.push(`${this.invalidUsageSamples} invalid sample(s)`)
    return {
      usage: {
        scope: 'run',
        source: 'provider',
        session: this.sessionId,
        includesSubagents: false,
        resumedHistoryIncluded: false,
        final,
        complete,
        partial: !complete,
        countedSamples: this.usageSamples.length,
        attempts: this.usageSamples.length,
        steps: stems.size,
        expectedSteps: this.stepStates.size,
        stepsWithUsage,
        expectedAttempts: allAttempts.length,
        attemptsWithUsage,
        invalidSamples: this.invalidUsageSamples,
        missingBuckets,
        missingUsageSteps: missingUsageSteps.slice(0, 20),
        missingUsageAttempts: missingUsageAttempts.slice(0, 20),
        missingBoundaries: missingBoundaries.slice(0, 20),
        uncachedInputTokens: totals.uncachedInputTokens,
        cacheReadTokens: cacheReadKnown ? totals.cacheReadTokens : null,
        cacheWriteTokens: cacheWriteKnown ? totals.cacheWriteTokens : null,
        outputTokens: totals.outputTokens,
        totalTokens: totals.totalTokens,
        lastSample: {
          turn: last.turn,
          step: last.step,
          totalTokens: last.buckets.totalTokens,
          at: iso(last.at),
          seq: last.seq ?? null,
        },
        updatedAt: iso(this.usageUpdatedAt),
        lastEventSeq: this.usageLastSeq ?? null,
        note: complete
          ? 'provider-reported total for this finished run'
          : final
            ? `finished run, but provider usage is incomplete (${missingParts.join('; ') || 'unknown reason'})`
            : 'running; this is only the total of provider samples reported so far',
      },
      reason: null,
    }
  }

  closeOpenTools(at = Date.now()) {
    for (const [key, tool] of this.currentTools) {
      if (tool.status === 'called') {
        tool.status = 'unknown'
        tool.finishedAt = at
      }
      this.currentTools.delete(key)
    }
    this.currentStep = undefined
  }

  /** Build a presentation snapshot. `now` is injected so tests can freeze time. */
  view(now = Date.now()) {
    const startedAt = this.turnStartedAt ?? this.queuedAt
    const finishedAt = this.turnEndedAt ?? (this.terminal ? this.stoppedAt ?? this.error?.time ?? now : undefined)
    const usage = this.#usageView()
    const lastEvent = this.lastEvent === undefined
      ? null
      : { ...this.lastEvent, ageMs: Math.max(0, now - this.lastEvent.time) }
    const currentTools = [...this.currentTools.values()].map((tool) => ({
      callId: tool.callId,
      name: tool.name,
      turn: tool.turn,
      step: tool.step,
      startedAt: iso(tool.startedAt),
      elapsedMs: Math.max(0, now - tool.startedAt),
    }))
    return {
      sessionId: this.sessionId,
      status: this.status,
      isRunning: !this.terminal,
      queuedAtMs: this.queuedAt,
      turnStartedAtMs: this.turnStartedAt ?? null,
      startedAtMs: startedAt,
      finishedAtMs: finishedAt,
      durationMs: startedAt === undefined ? null : Math.max(0, (finishedAt ?? now) - startedAt),
      currentTurn: this.currentTurn ?? null,
      currentStep: this.currentStep === undefined ? null : {
        turn: this.currentStep.turn,
        step: this.currentStep.step,
        startedAt: iso(this.currentStep.startedAt),
        elapsedMs: Math.max(0, now - this.currentStep.startedAt),
      },
      currentTool: currentTools[0] ?? null,
      currentTools,
      toolCalls: this.#recentToolCalls(now),
      assistantText: this.assistantText,
      lastEvent,
      lastEventType: this.lastEvent?.type ?? null,
      lastEventAgeMs: lastEvent?.ageMs ?? null,
      silentForMs: lastEvent?.ageMs ?? null,
      recentEvents: this.recentEvents.map((event) => ({
        ...event,
        ageMs: Math.max(0, now - event.time),
      })),
      events: this.recentEvents.map((event) => ({ seq: event.seq, type: event.type, time: event.time })),
      turnEnd: this.turnEnd,
      contextWindow: this.contextWindow ?? null,
      usage: usage.usage,
      usageUnavailableReason: usage.usage === null ? usage.reason : null,
      eventsSeen: this.eventsSeen,
      ignoredDuplicateEvents: this.ignoredEvents,
      ...(this.error === undefined ? {} : { error: this.error }),
    }
  }
}

export function iso(ms) {
  return typeof ms === 'number' && Number.isFinite(ms) ? new Date(ms).toISOString() : null
}
