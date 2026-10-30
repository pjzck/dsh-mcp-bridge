/**
 * Live end-to-end check against a NEW bridge process (never the bridge that
 * hosts the current chat):
 * - start a short task that sleeps inside the real `pwsh` tool;
 * - observe `dsh_get` returning a running state plus current tool;
 * - observe the published status file independently;
 * - after completion, require real provider usage, verify the written file,
 *   and prove durationMs stays frozen.
 *
 * Run: npm run test:e2e
 */
import assert from 'node:assert/strict'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const server = path.join(here, '..', 'src', 'server.mjs')
const stamp = `${Date.now()}-${process.pid}`
const workspace = path.join(here, '..', '.smoke-workspace', `e2e-workspace-${stamp}`)
const statusDir = path.join(here, '..', '.smoke-workspace', `e2e-status-${stamp}`)
const marker = `E2E_OK_${stamp}`

await fs.mkdir(workspace, { recursive: true })
await fs.mkdir(statusDir, { recursive: true })

const transport = new StdioClientTransport({
  command: process.execPath,
  args: [server],
  cwd: here,
  env: {
    ...process.env,
    DSH_MCP_STATUS_DIR: statusDir,
    DSH_MCP_STATUS_HEARTBEAT_MS: '1000',
    DSH_MCP_STATUS_STALE_MS: '3000',
    DSH_PERMISSION_MODE: process.env.DSH_PERMISSION_MODE?.trim() || 'danger-full-access',
  },
  stderr: 'pipe',
})
const client = new Client({ name: 'dsh-mcp-e2e', version: '0.0.0' }, { capabilities: {} })
await client.connect(transport)

function payload(result) {
  const block = result.content?.find((item) => item.type === 'text')
  if (!block) throw new Error(`tool returned no text: ${JSON.stringify(result)}`)
  if (result.isError) throw new Error(block.text)
  return JSON.parse(block.text)
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function readPublished() {
  let names
  try {
    names = (await fs.readdir(statusDir)).filter((name) => /^bridge-.*\.json$/.test(name))
  } catch {
    return undefined
  }
  if (names.length === 0) return undefined
  const files = []
  for (const name of names) {
    const parsed = JSON.parse(await fs.readFile(path.join(statusDir, name), 'utf8'))
    parsed.__file = name
    files.push(parsed)
  }
  return files.find((file) => file.runs?.some((run) => run.sessionId === sessionId)) ?? files[0]
}

let sessionId
let final
let runningObservation
let fileRunningObservation
let finishedFile

try {
  const info = payload(await client.callTool({ name: 'dsh_info', arguments: {} }))
  assert.equal(info.permissionMode, process.env.DSH_PERMISSION_MODE?.trim() || 'danger-full-access')
  assert.equal(info.apiKeyAvailable, true, 'real API key is required for the live e2e')
  assert.equal(info.statusPublisher.enabled, true)
  assert.equal(path.resolve(info.statusPublisher.dir).toLowerCase(), path.resolve(statusDir).toLowerCase())

  const started = payload(await client.callTool({
    name: 'dsh_start',
    arguments: {
      task: `Use the pwsh tool to execute this exact command: Start-Sleep -Seconds 8; Set-Content -LiteralPath e2e-ok.txt -Value ${marker} -NoNewline\nDo not use write or edit tools. After it succeeds, reply DONE.`,
      cwd: workspace,
    },
  }))
  assert.equal(started.status, 'running')
  sessionId = started.sessionId
  console.log('started:', JSON.stringify({ sessionId, statusLine: started.statusLine }))

  const deadline = Date.now() + 180_000
  let snapshot = started
  while (snapshot.status === 'running' && Date.now() < deadline) {
    snapshot = payload(await client.callTool({
      name: 'dsh_get',
      arguments: { sessionId },
    }))
    if (snapshot.status === 'running') {
      const tools = snapshot.currentTools?.map((tool) => tool.name) ?? []
      if (runningObservation === undefined && (tools.includes('pwsh') || snapshot.lastEventType === 'tool/call')) {
        runningObservation = {
          at: new Date().toISOString(),
          status: snapshot.status,
          statusLine: snapshot.statusLine,
          currentTools: tools,
          lastEventType: snapshot.lastEventType,
          durationMs: snapshot.durationMs,
        }
      }
      const published = await readPublished()
      const publishedRun = published?.runs?.find((run) => run.sessionId === sessionId)
      if (fileRunningObservation === undefined && published?.bridge?.state === 'running' && publishedRun?.isRunning === true) {
        fileRunningObservation = {
          at: new Date().toISOString(),
          bridgeState: published.bridge.state,
          heartbeatAt: published.bridge.heartbeatAt,
          runStatus: publishedRun.status,
          runStatusLine: publishedRun.statusLine,
          durationMs: publishedRun.durationMs,
          currentTools: publishedRun.currentTools?.map((tool) => tool.name) ?? [],
        }
      }
      if (runningObservation !== undefined && fileRunningObservation !== undefined) break
    }
    await sleep(400)
  }

  snapshot = payload(await client.callTool({ name: 'dsh_get', arguments: { sessionId } }))
  while (snapshot.status === 'running' && Date.now() < deadline) {
    snapshot = payload(await client.callTool({
      name: 'dsh_wait',
      arguments: { sessionId, timeoutMs: 30_000 },
    }))
  }
  final = snapshot
  assert.equal(final.status, 'succeeded', `unexpected final status: ${final.status} ${final.error?.message ?? ''}`)
  assert.ok(runningObservation !== undefined, 'never observed a running pwsh state through dsh_get')
  assert.ok(fileRunningObservation !== undefined, 'never observed a running state in the published status file')
  assert.ok(runningObservation.currentTools.includes('pwsh'), `currentTools did not include pwsh: ${runningObservation.currentTools}`)

  assert.ok(final.usage !== null, `real token usage missing: ${final.usageUnavailableReason}`)
  assert.equal(final.usage.source, 'provider')
  assert.equal(final.usage.scope, 'run')
  assert.equal(final.usage.final, true)
  assert.ok(final.usage.totalTokens > 0, `expected real tokens > 0, got ${final.usage.totalTokens}`)
  assert.ok(final.usage.uncachedInputTokens >= 0)
  assert.ok(final.usage.outputTokens > 0)
  assert.equal(final.usage.resumedHistoryIncluded, false)
  assert.equal(final.usage.includesSubagents, false)

  const written = await fs.readFile(path.join(workspace, 'e2e-ok.txt'), 'utf8')
  assert.equal(written, marker, 'pwsh task did not write the expected file')

  const fileDeadline = Date.now() + 10_000
  while (Date.now() < fileDeadline) {
    finishedFile = await readPublished()
    const run = finishedFile?.runs?.find((item) => item.sessionId === sessionId)
    if (finishedFile?.bridge?.state === 'idle' && run?.isRunning === false) break
    await sleep(250)
  }
  const publishedRun = finishedFile?.runs?.find((item) => item.sessionId === sessionId)
  assert.ok(publishedRun !== undefined, 'finished run missing from the published status file')
  assert.equal(finishedFile.bridge.state, 'idle')
  assert.equal(publishedRun.isRunning, false)
  assert.equal(publishedRun.status, final.status)
  assert.equal(publishedRun.durationMs, final.durationMs)
  assert.equal(publishedRun.usage.totalTokens, final.usage.totalTokens)
  const publishedText = JSON.stringify(finishedFile)
  assert.equal(publishedText.includes(marker), false, 'prompt marker leaked into the status file')
  assert.equal(publishedText.includes('assistantText'), false)
  assert.equal(publishedText.includes('arguments'), false)

  const frozenFinishedAt = final.finishedAt
  const frozenDuration = final.durationMs
  await sleep(2_000)
  const later = payload(await client.callTool({ name: 'dsh_get', arguments: { sessionId } }))
  assert.equal(later.status, 'succeeded')
  assert.equal(later.finishedAt, frozenFinishedAt)
  assert.equal(later.durationMs, frozenDuration)

  console.log('E2E RESULT', JSON.stringify({
    sessionId,
    statusDir,
    workspace,
    runningObservation,
    fileRunningObservation,
    final: {
      status: final.status,
      durationMs: final.durationMs,
      finishedAt: final.finishedAt,
      usage: final.usage,
      statusLine: final.statusLine,
    },
    frozenAfter2s: { durationMs: later.durationMs, finishedAt: later.finishedAt },
    writtenFile: path.join(workspace, 'e2e-ok.txt'),
    statusFile: path.join(statusDir, finishedFile.__file ?? 'bridge-unknown.json'),
  }, null, 2))
  console.log('E2E OK')
} finally {
  await client.callTool({ name: 'dsh_shutdown', arguments: {} }).catch(() => {})
  await client.close().catch(() => {})
}
