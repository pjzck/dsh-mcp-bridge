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
  console.log('dsh:', info.dshCommand, 'connection:', info.connection, 'key ref:', info.apiKeyEnv, 'route:', info.defaultRoute)
  if (info.apiKeyEnv) assert.equal(info.apiKeyAvailable, true, `Credential was not resolvable: ${info.apiKeyEnv}`)
  assert.equal(info.permissionMode, process.env.DSH_PERMISSION_MODE?.trim() || 'danger-full-access')

  const run = payload(await client.callTool({
    name: 'dsh_run',
    arguments: {
      task: 'Reply with exactly BRIDGE_OK. Do not use any tools.',
      cwd: workspace,
      timeoutMs: 60_000,
    },
  }))
  console.log('run:', JSON.stringify({ sessionId: run.sessionId, status: run.status, text: run.assistantText }))
  assert.equal(run.status, 'succeeded', `unexpected status: ${run.status}`)
  assert.match(run.assistantText, /BRIDGE_OK/)

  if (info.statusPublisher?.enabled) {
    let publishedRun
    const deadline = Date.now() + 3000
    while (Date.now() < deadline) {
      const state = JSON.parse(await fs.readFile(info.statusPublisher.file, 'utf8').catch(() => '{}'))
      publishedRun = state.runs?.find((item) => item.sessionId === run.sessionId)
      if (publishedRun?.status === 'succeeded') break
      await new Promise((resolve) => setTimeout(resolve, 100))
    }
    assert.equal(publishedRun?.status, 'succeeded', 'completed run was not published for the panel')
    assert.equal(publishedRun.assistantText, undefined)
    assert.equal(publishedRun.toolCalls, undefined)
    console.log('panel state:', info.statusPublisher.file)
  }

  console.log('SMOKE OK')
} finally {
  await client.callTool({ name: 'dsh_shutdown', arguments: {} }).catch(() => {})
  await client.close().catch(() => {})
}
