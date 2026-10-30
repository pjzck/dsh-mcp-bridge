/** Human-readable one-line run status for MCP clients such as Codex. */

const STATUS_LABELS = {
  queued: '排队中',
  running: '运行中',
  succeeded: '已完成',
  error: '失败',
  interrupted: '已中断',
  stopped: '已停止',
  incomplete: '已结束（无收尾事件）',
}

const numberFormat = new Intl.NumberFormat('en-US')

export function formatDuration(ms) {
  if (typeof ms !== 'number' || !Number.isFinite(ms) || ms < 0) return '未知'
  if (ms < 1_000) return `${Math.round(ms)}ms`
  const totalSeconds = ms / 1_000
  if (totalSeconds < 60) return `${totalSeconds.toFixed(totalSeconds < 10 ? 1 : 0)}s`
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = Math.floor(totalSeconds % 60)
  if (minutes < 60) return `${minutes}m ${String(seconds).padStart(2, '0')}s`
  const hours = Math.floor(minutes / 60)
  return `${hours}h ${String(minutes % 60).padStart(2, '0')}m`
}

function formatAge(ms) {
  if (typeof ms !== 'number' || !Number.isFinite(ms) || ms < 0) return '未知'
  if (ms < 1_000) return '刚刚'
  if (ms < 60_000) return `${Math.floor(ms / 1_000)}s 前`
  if (ms < 3_600_000) return `${Math.floor(ms / 60_000)}m 前`
  return `${Math.floor(ms / 3_600_000)}h 前`
}

function formatTokens(value) {
  return typeof value === 'number' && Number.isFinite(value) ? numberFormat.format(value) : '未知'
}

/**
 * Build the compact status line. It never includes prompts, assistant text,
 * tool arguments or credentials.
 * @param {any} view decorated run view
 */
export function buildStatusLine(view) {
  const parts = [STATUS_LABELS[view.status] ?? String(view.status ?? '未知')]
  parts.push(formatDuration(view.durationMs))
  if (view.currentStep && typeof view.currentStep === 'object') {
    parts.push(`turn ${view.currentStep.turn ?? '?'} / step ${view.currentStep.step ?? '?'}`)
  } else if (view.currentTurn !== undefined && view.currentTurn !== null) {
    parts.push(`turn ${view.currentTurn}`)
  }
  if (Array.isArray(view.currentTools) && view.currentTools.length > 0) {
    const names = view.currentTools.map((tool) => tool?.name).filter((name) => typeof name === 'string' && name !== '')
    if (names.length > 0) parts.push(`工具 ${names.slice(0, 4).join(' + ')}`)
  }
  const usage = view.usage
  if (usage === null || usage === undefined) {
    parts.push('token 未上报')
  } else {
    const cacheRead = usage.cacheReadTokens === null || usage.cacheReadTokens === undefined
      ? '未知'
      : formatTokens(usage.cacheReadTokens)
    const cacheWrite = usage.cacheWriteTokens === null || usage.cacheWriteTokens === undefined
      ? '未知'
      : formatTokens(usage.cacheWriteTokens)
    const prefix = usage.partial === true ? 'token 已上报（部分）' : 'token 已上报'
    parts.push(
      `${prefix} ${formatTokens(usage.totalTokens)}（未缓存输入 ${formatTokens(usage.uncachedInputTokens)}`
      + ` · 缓存读 ${cacheRead} · 缓存写 ${cacheWrite} · 输出 ${formatTokens(usage.outputTokens)}）`,
    )
  }
  if (view.lastEventAgeMs !== null && view.lastEventAgeMs !== undefined) {
    parts.push(`最近活动 ${formatAge(view.lastEventAgeMs)}`)
  } else {
    parts.push('尚无事件')
  }
  if (view.runtimeExited === true) parts.push('SDK runtime 已退出')
  if (view.note !== undefined && view.note !== null) parts.push(String(view.note).slice(0, 200))
  return parts.join(' · ').slice(0, 1_200)
}
