#!/usr/bin/env node
import { readFileSync } from 'node:fs'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { z } from 'zod'
import { DshManager } from './manager.mjs'

const packageJson = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
const manager = new DshManager(process.env, { bridgeVersion: packageJson.version })
const server = new McpServer({
  name: 'dsh-mcp-bridge',
  version: packageJson.version,
})

const sessionId = z.string().min(1).describe('DSH session id, e.g. session-… returned by a previous call.')
const workspace = z.string().optional().describe('Absolute working directory for the DSH agent. Defaults to the MCP server process cwd.')
const route = {
  provider: z.string().optional().describe('Model provider route; defaults to DSH settings (deepseek-official).'),
  model: z.string().optional().describe('Model id; defaults to DSH settings (deepseek-flash).'),
}

/** @param {unknown} value */
function text(value) {
  return { content: [{ type: 'text', text: JSON.stringify(value, null, 2) }] }
}

/** @param {unknown} error */
function failure(error) {
  const message = error instanceof Error ? error.message : String(error)
  return { isError: true, content: [{ type: 'text', text: message }] }
}

server.registerTool(
  'dsh_info',
  {
    title: 'DeepSeek Harness bridge info',
    description: 'Report the DSH launcher, model route, API-key availability, live SDK runtimes, and tracked runs. Call this first when a DSH call fails.',
    inputSchema: {},
  },
  async () => {
    try {
      return text({
        server: { name: 'dsh-mcp-bridge', version: packageJson.version, node: process.version, platform: process.platform },
        ...manager.info(),
        hint: 'Sessions are DSH sessions in this SDK runtime, not the desktop app UI. dsh_run waits; dsh_start + dsh_wait is better for long tasks. durationMs freezes at turn/end; usage.scope is "run" and never claims resumed history.',
      })
    } catch (error) {
      return failure(error)
    }
  },
)

server.registerTool(
  'dsh_start',
  {
    title: 'Start a DSH task',
    description: 'Queue one task for the DSH coding agent and return immediately with a sessionId. Omit sessionId to create a new session; pass a previous sessionId to continue that session. Follow with dsh_wait / dsh_get.',
    inputSchema: {
      task: z.string().min(1).max(100_000).describe('The task text for the DSH agent.'),
      cwd: workspace,
      sessionId: sessionId.optional(),
      ...route,
    },
  },
  async ({ task, cwd, sessionId: requested, provider, model }) => {
    try {
      return text(await manager.start({ task, cwd, sessionId: requested, provider, model }))
    } catch (error) {
      return failure(error)
    }
  },
)

server.registerTool(
  'dsh_wait',
  {
    title: 'Wait for a DSH task',
    description: 'Wait up to 30 seconds for the current turn of a DSH session to finish. Returns status "running" with partial output when the budget elapses; call again with the same sessionId.',
    inputSchema: {
      sessionId,
      timeoutMs: z.number().int().min(1).max(30_000).optional().describe('Wait budget in milliseconds; capped at 30 seconds.'),
    },
  },
  async ({ sessionId: requested, timeoutMs }) => {
    try {
      return text(await manager.wait(requested, timeoutMs ?? 30_000))
    } catch (error) {
      return failure(error)
    }
  },
)

server.registerTool(
  'dsh_run',
  {
    title: 'Run a DSH task to completion',
    description: 'Queue a task and wait for the turn to settle. Convenient for short tasks; long tasks should use dsh_start + dsh_wait so the MCP call does not block. Timeout leaves the turn running and returns timedOut:true.',
    inputSchema: {
      task: z.string().min(1).max(100_000).describe('The task text for the DSH agent.'),
      cwd: workspace,
      sessionId: sessionId.optional(),
      ...route,
      timeoutMs: z.number().int().min(1_000).max(3_600_000).optional().describe('Overall budget in milliseconds; default 15 minutes.'),
    },
  },
  async ({ task, cwd, sessionId: requested, provider, model, timeoutMs }) => {
    try {
      return text(await manager.run({ task, cwd, sessionId: requested, provider, model, timeoutMs }))
    } catch (error) {
      return failure(error)
    }
  },
)

server.registerTool(
  'dsh_get',
  {
    title: 'Read a DSH task',
    description: 'Read the current state and last assistant output of a DSH session without waiting.',
    inputSchema: { sessionId },
  },
  async ({ sessionId: requested }) => {
    try {
      return text(manager.get(requested))
    } catch (error) {
      return failure(error)
    }
  },
)

server.registerTool(
  'dsh_sessions',
  {
    title: 'List DSH sessions',
    description: 'List the runs this MCP bridge process has started, with their status and latest assistant text.',
    inputSchema: {},
  },
  async () => text({ sessions: manager.list() }),
)

server.registerTool(
  'dsh_shutdown',
  {
    title: 'Stop DSH SDK runtimes',
    description: 'Stop every SDK runtime this bridge started. Active turns are abandoned (the SDK protocol has no per-turn cancel); the next dsh_start spawns a fresh runtime.',
    inputSchema: {},
  },
  async () => {
    await manager.shutdown()
    return text({ ok: true, stopped: true })
  },
)

const transport = new StdioServerTransport()
await server.connect(transport)
await manager.publish().catch(() => {})
console.error('[dsh-mcp] ready (stdio)')

let stopping = false
async function stop() {
  if (stopping) return
  stopping = true
  await manager.shutdown().catch(() => {})
  process.exit(0)
}
process.on('SIGINT', stop)
process.on('SIGTERM', stop)
process.on('SIGBREAK', stop)
process.stdin.on('end', stop)
