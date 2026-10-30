/**
 * Read-only transcript projection for the run monitor endpoint.
 *
 * The host passes a `readSession` callback backed by the optional
 * `ctx.sessionQuery` service. This module never loads a session itself and
 * never returns raw events: it projects public text, paired tool calls, and a
 * small number of turn boundaries into bounded response entries.
 */

export const TRANSCRIPT_DEFAULT_LIMIT = 80
export const TRANSCRIPT_MAX_LIMIT = 200
export const MAX_RESPONSE_BYTES = 512 * 1024
export const MAX_MESSAGE_TEXT = 16 * 1024
export const MAX_TOOL_ARGUMENTS = 8 * 1024
export const MAX_TOOL_RESULT = 24 * 1024

const MAX_ID_LENGTH = 200
const MAX_TOOL_NAME = 200
const MAX_ERROR_TEXT = 2 * 1024
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/

/** Build the endpoint's uniform structured failure. */
export function errorResult(code, message, details = {}) {
  return { ok: false, error: { code, message, details } }
}

/** Clip a string to a UTF-8 byte budget without splitting a code point. */
function clipText(value, limitBytes) {
  if (typeof value !== 'string') return { value: undefined, truncated: false }
  if (Buffer.byteLength(value, 'utf8') <= limitBytes) return { value, truncated: false }
  const bytes = Buffer.from(value, 'utf8')
  let end = limitBytes
  // Back up to the leading byte of the character that crosses the boundary.
  while (end > 0 && (bytes[end] & 0xc0) === 0x80) end -= 1
  return { value: bytes.subarray(0, end).toString('utf8'), truncated: true }
}

function safeId(value, limit = MAX_ID_LENGTH) {
  if (typeof value !== 'string' || value === '' || value.length > limit) return undefined
  return CONTROL_CHARACTERS.test(value) ? undefined : value
}

function eventTime(event) {
  return typeof event.time === 'number' && Number.isFinite(event.time) ? event.time : 0
}

/** Join only public text blocks; reasoning, images and tool-call blocks stay out. */
function publicText(content) {
  if (!Array.isArray(content)) return ''
  const parts = []
  for (const block of content) {
    if (block && block.type === 'text' && typeof block.text === 'string' && block.text !== '') {
      parts.push(block.text)
    }
  }
  return parts.join('\n')
}

function toolResultInfo(event) {
  const data = event.data
  const message = data && typeof data === 'object' ? data.message : undefined
  const blocks = message && Array.isArray(message.content) ? message.content : []
  const parts = []
  let callId
  let isError = message?.isError === true
  callId = safeId(message?.toolCallId) ?? safeId(data?.callId) ?? safeId(data?.toolCallId)
  // Desktop 0.2.x SDK results carry public text directly on the message;
  // newer session logs wrap it in a tool-result block.
  if (callId !== undefined) parts.push(publicText(blocks))
  for (const block of blocks) {
    if (!block || block.type !== 'tool-result') continue
    if (callId === undefined) callId = safeId(block.toolCallId)
    if (block.isError === true) isError = true
    if (Array.isArray(block.content)) {
      for (const inner of block.content) {
        if (inner && inner.type === 'text' && typeof inner.text === 'string' && inner.text !== '') {
          parts.push(inner.text)
        }
      }
    }
  }
  if (callId === undefined && message && message.source) callId = safeId(message.source.callId)
  const error = data && typeof data === 'object' && data.error && typeof data.error === 'object'
    ? data.error
    : undefined
  if (error !== undefined) isError = true
  let text = parts.join('\n')
  if (text === '' && error !== undefined) {
    text = [error.name, error.code]
      .filter((part) => typeof part === 'string' && part !== '')
      .join(': ')
  }
  return { callId, isError, text }
}

function turnEndText(data) {
  const turn = Number.isSafeInteger(data?.turn) ? data.turn : '?'
  const reason = data && typeof data.reason === 'object' ? data.reason : {}
  const label = `第 ${turn} 轮`
  switch (reason.kind) {
    case 'completed':
      return `${label}结束`
    case 'aborted':
      return `${label}已取消`
    case 'blocked':
      return `${label}被阻止`
    case 'max-tokens':
      return `${label}因输出上限结束`
    case 'interrupted':
      return `${label}被中断`
    case 'error': {
      const error = reason.error && typeof reason.error === 'object' ? reason.error : {}
      const detail = clipText(
        [error.code, error.message].filter((part) => typeof part === 'string' && part !== '').join(': '),
        MAX_ERROR_TEXT,
      )
      return detail.value === undefined || detail.value === ''
        ? `${label}失败`
        : `${label}失败：${detail.value}`
    }
    default:
      return `${label}结束`
  }
}

/**
 * Project one raw session log into ordered transcript entries.
 *
 * Only direct human `user/message` events count as user entries. Plugin,
 * goal, and other injected user-role contexts are omitted. Assistant entries
 * carry only `text` blocks. Tool calls and results share one entry keyed by
 * the result's `callId`. `turn/end` is the only lifecycle event projected.
 *
 * @param {unknown} events - raw event array returned by `readSession`.
 * @returns {{entries: object[], lastSeq: number | null}}
 */
export function projectTranscriptEvents(events) {
  if (!Array.isArray(events)) throw new TypeError('session events must be an array')
  const ordered = []
  let lastSeq = null
  for (const event of events) {
    if (!event || typeof event !== 'object') continue
    if (!Number.isSafeInteger(event.seq) || event.seq < 0) continue
    if (lastSeq === null || event.seq > lastSeq) lastSeq = event.seq
    if (typeof event.type !== 'string') continue
    ordered.push(event)
  }
  ordered.sort((left, right) => left.seq - right.seq)

  const entries = []
  const toolEntries = new Map()
  for (const event of ordered) {
    const seq = event.seq
    const time = eventTime(event)
    switch (event.type) {
      case 'user/message': {
        if (event.data?.source?.kind !== 'user') break
        const clipped = clipText(publicText(event.data?.content), MAX_MESSAGE_TEXT)
        if (clipped.value === undefined || clipped.value.trim() === '') break
        const entry = { id: `user:${seq}`, seq, time, kind: 'user', text: clipped.value }
        if (clipped.truncated) entry.truncated = true
        entries.push(entry)
        break
      }
      case 'assistant/message': {
        const message = event.data?.message
        const clipped = clipText(publicText(message?.content), MAX_MESSAGE_TEXT)
        if (clipped.value === undefined || clipped.value.trim() === '') break
        const entry = { id: `assistant:${seq}`, seq, time, kind: 'assistant', text: clipped.value }
        if (clipped.truncated) entry.truncated = true
        entries.push(entry)
        break
      }
      case 'tool/call': {
        const callId = safeId(event.data?.callId)
        if (callId === undefined || toolEntries.has(callId)) break
        const name = clipText(event.data?.name, MAX_TOOL_NAME)
        const args = clipText(event.data?.arguments, MAX_TOOL_ARGUMENTS)
        const entry = { id: callId, seq, time, kind: 'tool', callId, status: 'pending' }
        if (name.value !== undefined && name.value !== '') entry.toolName = name.value
        if (args.value !== undefined) entry.arguments = args.value
        if (name.truncated || args.truncated) entry.truncated = true
        entries.push(entry)
        toolEntries.set(callId, entry)
        break
      }
      case 'tool/result': {
        const result = toolResultInfo(event)
        if (result.callId === undefined) break
        const clipped = clipText(result.text, MAX_TOOL_RESULT)
        const status = result.isError ? 'error' : 'ok'
        const existing = toolEntries.get(result.callId)
        if (existing !== undefined) {
          // The first result wins; duplicated results cannot rewrite the row.
          if (existing.status !== 'pending') break
          existing.status = status
          if (clipped.value !== undefined && clipped.value !== '') existing.result = clipped.value
          if (clipped.truncated) existing.truncated = true
          break
        }
        const entry = { id: result.callId, seq, time, kind: 'tool', callId: result.callId, status }
        if (clipped.value !== undefined && clipped.value !== '') entry.result = clipped.value
        if (clipped.truncated) entry.truncated = true
        entries.push(entry)
        toolEntries.set(result.callId, entry)
        break
      }
      case 'turn/end': {
        const reason = event.data?.reason
        const status = typeof reason?.kind === 'string' ? reason.kind : 'unknown'
        const entry = {
          id: `event:${seq}`,
          seq,
          time,
          kind: 'event',
          text: turnEndText(event.data),
          status,
        }
        entries.push(entry)
        break
      }
      default:
        break
    }
  }
  return { entries, lastSeq }
}

function byteLength(value) {
  return Buffer.byteLength(value, 'utf8')
}

/**
 * Page projected entries without exposing raw events.
 *
 * The page is always a contiguous suffix of the filtered list: the newest
 * entries are preferred, and an older entry is never included after a newer
 * one was dropped for space. `beforeSeq` is the oldest included seq, or null
 * when no older entry exists.
 */
export function selectTranscriptPage(entries, {
  beforeSeq,
  limit = TRANSCRIPT_DEFAULT_LIMIT,
  maxResponseBytes = MAX_RESPONSE_BYTES,
} = {}) {
  const filtered = beforeSeq === undefined
    ? entries
    : entries.filter((entry) => entry.seq < beforeSeq)
  const selected = filtered.length > limit ? filtered.slice(-limit) : filtered.slice()
  const kept = []
  let used = 0
  for (let index = selected.length - 1; index >= 0; index -= 1) {
    const entry = selected[index]
    const size = byteLength(JSON.stringify(entry)) + (kept.length > 0 ? 1 : 0)
    // Always keep the newest entry so a tiny budget cannot produce an empty
    // page while older entries exist; field caps keep one entry well bounded.
    if (kept.length > 0 && used + size > maxResponseBytes) break
    kept.unshift(entry)
    used += size
  }
  const hasOlder = filtered.length > kept.length
  return {
    entries: kept,
    hasOlder,
    beforeSeq: hasOlder && kept.length > 0 ? kept[0].seq : null,
  }
}

function validateId(value, field) {
  const id = safeId(value)
  if (id === undefined) {
    return {
      error: errorResult(
        'invalid-argument',
        `${field} must be a non-empty string of at most ${MAX_ID_LENGTH} characters`,
        { field },
      ).error,
    }
  }
  return { value: id }
}

/**
 * Validate and normalize transcript request parameters.
 * @param {unknown} body - parsed request body.
 * @returns {{ok: true, params: object} | {ok: false, error: object}}
 */
export function validateTranscriptRequest(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return { ok: false, error: errorResult('invalid-body', 'request body must be a JSON object').error }
  }
  if (body.method !== undefined && body.method !== 'transcript') {
    return {
      ok: false,
      error: errorResult('invalid-method', 'body.method must be "transcript"', { method: typeof body.method }).error,
    }
  }
  const bridge = validateId(body.bridgeInstanceId, 'bridgeInstanceId')
  if (bridge.error !== undefined) return { ok: false, error: bridge.error }
  const session = validateId(body.sessionId, 'sessionId')
  if (session.error !== undefined) return { ok: false, error: session.error }

  let beforeSeq
  if (body.beforeSeq !== undefined) {
    if (!Number.isSafeInteger(body.beforeSeq) || body.beforeSeq < 0) {
      return {
        ok: false,
        error: errorResult('invalid-argument', 'beforeSeq must be a non-negative safe integer', { field: 'beforeSeq' }).error,
      }
    }
    beforeSeq = body.beforeSeq
  }

  let limit = TRANSCRIPT_DEFAULT_LIMIT
  if (body.limit !== undefined) {
    if (!Number.isSafeInteger(body.limit) || body.limit < 1) {
      return {
        ok: false,
        error: errorResult('invalid-argument', 'limit must be a positive safe integer', { field: 'limit' }).error,
      }
    }
    limit = Math.min(TRANSCRIPT_MAX_LIMIT, body.limit)
  }

  return {
    ok: true,
    params: {
      bridgeInstanceId: bridge.value,
      sessionId: session.value,
      beforeSeq,
      limit,
    },
  }
}

/**
 * Create the transcript request handler.
 *
 * `authorizeSession` must resolve `true` only after the host matched the
 * bridge instance and session against the current/archived status snapshots.
 * `resolveReadSession` is called after authorization so an absent host service
 * never exposes the read path.
 */
export function createTranscriptHandler({
  authorizeSession,
  readSession,
  resolveReadSession,
  maxResponseBytes = MAX_RESPONSE_BYTES,
} = {}) {
  const resolve = typeof resolveReadSession === 'function'
    ? resolveReadSession
    : () => readSession
  const budget = typeof maxResponseBytes === 'number'
    && Number.isFinite(maxResponseBytes)
    && maxResponseBytes > 0
    ? maxResponseBytes
    : MAX_RESPONSE_BYTES

  return async function handleTranscript(body) {
    const checked = validateTranscriptRequest(body)
    if (checked.ok !== true) return { ok: false, error: checked.error }
    const { bridgeInstanceId, sessionId, beforeSeq, limit } = checked.params

    if (typeof authorizeSession !== 'function') {
      return errorResult('internal', 'session authorization is unavailable')
    }
    let authorized
    try {
      authorized = await authorizeSession({ bridgeInstanceId, sessionId })
    } catch {
      return errorResult('internal', 'failed to check session authorization')
    }
    if (authorized !== true) {
      return errorResult('not-authorized', 'bridge instance and session do not match a known run')
    }

    let read
    try {
      read = resolve()
    } catch {
      read = undefined
    }
    if (typeof read !== 'function') {
      return errorResult('unavailable', 'session query service is unavailable')
    }

    let snapshot
    try {
      snapshot = await read(sessionId)
    } catch {
      return errorResult('session-read-failed', 'failed to read the session transcript')
    }

    let projected
    try {
      projected = projectTranscriptEvents(snapshot?.events)
    } catch {
      return errorResult('session-read-failed', 'session query returned an unsupported event log')
    }

    const page = selectTranscriptPage(projected.entries, { beforeSeq, limit, maxResponseBytes: budget })
    return {
      ok: true,
      value: {
        sessionId,
        bridgeInstanceId,
        readOnly: true,
        entries: page.entries,
        hasOlder: page.hasOlder,
        beforeSeq: page.beforeSeq,
        lastSeq: projected.lastSeq,
      },
    }
  }
}
