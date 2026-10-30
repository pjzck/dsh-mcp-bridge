import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'

const here = path.dirname(fileURLToPath(import.meta.url))
const server = path.join(here, '..', 'src', 'server.mjs')
const workspace = process.env.DSH_MCP_TEST_CWD || path.join(here, '..', '.smoke-workspace')
await fs.mkdir(workspace, { recursive: true })

const transport = new StdioClientTransport({
  command: process.execPath,
  args: [server],
  cwd: here,
  env: { ...process.env },
  stderr: 'pipe',
})
const client = new Client({ name: 'dsh-mcp-smoke', version: '0.0.0' }, { capabilities: {} })
await client.connect(transport)

function payload(result) {
  const block = result.content?.find((item) => item.type === 'text')
  if (!block) throw new Error(`tool returned no text: ${JSON.stringify(result)}`)
  if (result.isError) throw new Error(block.text)
  return JSON.parse(block.text)
}

try {
  const tools = await client.listTools()
  console.log('tools:', tools.tools.map((tool) => tool.name).join(', '))

  const info = payload(await client.callTool({ name: 'dsh_info', arguments: {} }))
  console.log('dsh:', info.dshCommand, 'key:', info.apiKeyAvailable, 'route:', info.defaultRoute)
  assert.equal(info.permissionMode, process.env.DSH_PERMISSION_MODE?.trim() || 'danger-full-access')
  assert.equal(info.apiKeyAvailable, true, 'DEEPSEEK_API_KEY was not resolvable')

  const run = payload(await client.callTool({
    name: 'dsh_run',
    arguments: {
      task: 'Reply with exactly BRIDGE_OK. Do not use any tools.',
      cwd: workspace,
      timeoutMs: 180_000,
    },
  }))
  console.log('run:', JSON.stringify({ sessionId: run.sessionId, status: run.status, text: run.assistantText }))
  assert.equal(run.status, 'succeeded', `unexpected status: ${run.status}`)
  assert.match(run.assistantText, /BRIDGE_OK/)

  const follow = payload(await client.callTool({
    name: 'dsh_start',
    arguments: {
      task: 'What did I ask you to reply? Answer in one short sentence.',
      cwd: workspace,
      sessionId: run.sessionId,
    },
  }))
  assert.equal(follow.status, 'running')

  let waited = follow
  const deadline = Date.now() + 120_000
  while (waited.status === 'running' && Date.now() < deadline) {
    waited = payload(await client.callTool({
      name: 'dsh_wait',
      arguments: { sessionId: run.sessionId, timeoutMs: 30_000 },
    }))
  }
  console.log('follow:', JSON.stringify({ status: waited.status, text: waited.assistantText }))
  assert.equal(waited.status, 'succeeded', `unexpected follow status: ${waited.status}`)
  assert.match(waited.assistantText, /BRIDGE_OK/i)

  const sessions = payload(await client.callTool({ name: 'dsh_sessions', arguments: {} }))
  assert.ok(sessions.sessions.some((item) => item.sessionId === run.sessionId))

  const toolRun = payload(await client.callTool({
    name: 'dsh_run',
    arguments: {
      task: 'Use the write tool to create a file named ok.txt containing exactly OK, then reply DONE.',
      cwd: workspace,
      timeoutMs: 180_000,
    },
  }))
  console.log('tools-run:', JSON.stringify({ status: toolRun.status, text: toolRun.assistantText, calls: toolRun.toolCalls?.map((item) => item.name) }))
  assert.equal(toolRun.status, 'succeeded', `unexpected tool status: ${toolRun.status}`)
  assert.ok((toolRun.toolCalls?.length ?? 0) > 0, 'expected at least one tool call')
  assert.equal(await fs.readFile(path.join(workspace, 'ok.txt'), 'utf8'), 'OK')

  const shellMarker = 'PWSH_OK_' + Date.now()
  const shellRun = payload(await client.callTool({
    name: 'dsh_run',
    arguments: {
      task: 'Use the pwsh tool to execute this exact command: Set-Content -LiteralPath shell-ok.txt -Value ' + shellMarker + ' -NoNewline\nDo not use write or edit tools. Then reply DONE.',
      cwd: workspace,
      timeoutMs: 180_000,
    },
  }))
  console.log('shell-run:', JSON.stringify({ status: shellRun.status, text: shellRun.assistantText, calls: shellRun.toolCalls?.map((item) => item.name) }))
  assert.equal(shellRun.status, 'succeeded')
  assert.ok(shellRun.toolCalls?.some((item) => item.name === 'pwsh'), 'expected a real pwsh tool call')
  assert.ok(!shellRun.toolCalls?.some((item) => ['write', 'edit'].includes(item.name)), 'shell probe must not use file write tools')
  assert.equal(await fs.readFile(path.join(workspace, 'shell-ok.txt'), 'utf8'), shellMarker)

  console.log('SMOKE OK')
} finally {
  await client.callTool({ name: 'dsh_shutdown', arguments: {} }).catch(() => {})
  await client.close().catch(() => {})
}
