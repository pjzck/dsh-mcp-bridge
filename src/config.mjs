import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { parse } from 'yaml'
import { z } from 'zod'

/** Resolve the SDK permission preset; an explicit host setting takes precedence. */
export function resolvePermissionMode(env = process.env) {
  return env.DSH_PERMISSION_MODE?.trim() || 'danger-full-access'
}

const nonempty = z.string().trim().min(1)
const optionsSchema = z.object({
  command: nonempty.optional(),
  home: nonempty.optional(),
  profile: nonempty.optional(),
  cwd: nonempty.optional(),
  patches: z.array(nonempty).optional(),
  provider: nonempty.optional(),
  model: nonempty.optional(),
  reasoningEffort: nonempty.optional(),
  maxTokens: z.number().int().positive().optional(),
  baseURL: z.string().url().optional(),
  apiKeyEnv: z.union([z.string().regex(/^[A-Za-z_][A-Za-z0-9_]*$/), z.literal(false)]).optional(),
  env: z.record(z.union([z.string(), z.null()])).optional(),
}).strict()
const configSchema = optionsSchema.extend({
  defaultConnection: nonempty.optional(),
  connections: z.record(optionsSchema).default({}),
}).strict()

/** Expand home and environment references; fail instead of launching with an unresolved path. */
export function expandVariables(value, env = process.env) {
  return value.replace(/\$\{([^}]+)\}|%([^%]+)%/g, (_, dollar, percent) => {
    const name = dollar ?? percent
    if (env[name] === undefined) throw new Error(`Environment variable is not set: ${name}`)
    return env[name]
  })
}

function absolutePath(value, env, base = process.cwd()) {
  const expanded = expandVariables(value, env).replace(/^~(?=$|[\\/])/, os.homedir())
  return path.resolve(base, expanded)
}

/** @returns {string} DSH home; a bridge override also works without changing the parent environment. */
export function resolveDshHome(env = process.env) {
  return absolutePath(env.DSH_MCP_HOME || env.DSH_HOME || path.join(os.homedir(), '.dsh'), env)
}

/** Prefer an explicit executable, otherwise let PATH locate the installed CLI. */
export function resolveDshCommand(env = process.env) {
  return env.DSH_MCP_DSH_COMMAND?.trim() || (process.platform === 'win32' ? 'dsh.cmd' : 'dsh')
}

/** Read the optional bridge JSON file. Explicit missing files and invalid settings are errors. */
export function readBridgeConfig(env = process.env) {
  const filename = absolutePath(env.DSH_MCP_CONFIG || path.join(resolveDshHome(env), 'mcp-bridge.json'), env)
  let raw
  try {
    raw = fs.readFileSync(filename, 'utf8')
  } catch (error) {
    if (error.code === 'ENOENT' && !env.DSH_MCP_CONFIG) return { filename, ...configSchema.parse({}) }
    throw new Error(`Cannot read bridge config: ${filename} (${error.code ?? 'read error'})`)
  }
  let document
  try {
    document = JSON.parse(raw.replace(/^\uFEFF/, ''))
  } catch {
    throw new Error(`Invalid JSON in bridge config: ${filename}`)
  }
  const result = configSchema.safeParse(document)
  if (!result.success) {
    const fields = result.error.issues.map((issue) => issue.path.join('.') || '(root)').join(', ')
    throw new Error(`Invalid bridge config fields in ${filename}: ${fields}`)
  }
  return { filename, ...result.data }
}

/** Read the legacy DSH default model without depending on YAML indentation or line endings. */
export function readDefaultModel(home = resolveDshHome()) {
  const candidates = ['settings.yaml', 'settings.yaml.imported']
  try {
    candidates.push(...fs.readdirSync(home).filter((name) => name.startsWith('settings.yaml.bak-')).sort().reverse())
  } catch (error) {
    if (error.code !== 'ENOENT') throw error
  }
  for (const name of candidates) {
    let document
    try {
      document = parse(fs.readFileSync(path.join(home, name), 'utf8'))
    } catch (error) {
      if (error.code === 'ENOENT') continue
      throw new Error(`Cannot read DSH model settings: ${path.join(home, name)}`)
    }
    const route = document?.['agent-default-model']
    if (typeof route?.provider === 'string' && typeof route?.model === 'string') {
      return { provider: route.provider, model: route.model, ...(route.reasoningEffort ? { reasoningEffort: route.reasoningEffort } : {}) }
    }
  }
  return { provider: 'deepseek-official', model: 'deepseek-flash' }
}

/** Read only the selected credential reference, from the environment or DSH refs (including legacy files). */
export function readApiKey(home = resolveDshHome(), env = process.env, keyName = 'DEEPSEEK_API_KEY') {
  if (!keyName) return undefined
  if (env[keyName]?.trim()) return env[keyName].trim()
  let document
  try {
    document = parse(fs.readFileSync(path.join(home, '.credentials.yaml'), 'utf8'))
  } catch (error) {
    if (error.code === 'ENOENT') return undefined
    throw new Error(`Cannot read DSH credentials: ${path.join(home, '.credentials.yaml')}`)
  }
  const value = document?.refs?.[keyName] ?? document?.[keyName]
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

/** Resolve one named connection into a complete, isolated SDK launch context. Call arguments beat environment and file defaults. */
export function resolveConnection(input = {}, env = process.env) {
  const config = readBridgeConfig(env)
  const connection = input.connection?.trim() || env.DSH_MCP_CONNECTION?.trim() || config.defaultConnection
  if (connection && !Object.hasOwn(config.connections, connection)) throw new Error(`Unknown bridge connection: ${connection}`)
  const selected = connection ? config.connections[connection] : {}
  const options = { ...config, ...selected, env: { ...config.env, ...selected.env } }
  const childEnv = { ...env }
  for (const [name, value] of Object.entries(options.env)) {
    if (value === null) delete childEnv[name]
    else childEnv[name] = expandVariables(value, env)
  }
  const base = path.dirname(config.filename)
  const home = absolutePath(env.DSH_MCP_HOME || options.home || env.DSH_HOME || resolveDshHome(env), childEnv, base)
  childEnv.DSH_HOME = home
  const stored = readDefaultModel(home)
  const provider = input.provider?.trim() || env.DSH_MCP_PROVIDER?.trim() || options.provider || stored.provider
  const model = input.model?.trim() || env.DSH_MCP_MODEL?.trim() || options.model || stored.model
  const profile = env.DSH_MCP_PROFILE?.trim() || options.profile || 'sdk'
  const rawCommand = env.DSH_MCP_DSH_COMMAND?.trim() || options.command || resolveDshCommand(env)
  const expandedCommand = expandVariables(rawCommand, childEnv)
  const command = /[\\/]/.test(expandedCommand) ? absolutePath(expandedCommand, childEnv, base) : expandedCommand
  const patches = (options.patches ?? []).map((file) => {
    const resolved = absolutePath(file, childEnv, base)
    if (!fs.statSync(resolved).isFile()) throw new Error(`DSH patch is not a file: ${resolved}`)
    return resolved
  })
  const apiKeyEnv = (env.DSH_MCP_API_KEY_ENV?.trim() || options.apiKeyEnv) ?? (provider === 'deepseek-official' ? 'DEEPSEEK_API_KEY' : false)
  const key = readApiKey(home, childEnv, apiKeyEnv)
  if (key) childEnv[apiKeyEnv] = key
  const baseURL = env.DSH_MCP_BASE_URL?.trim() || options.baseURL
  if (baseURL && provider !== 'deepseek-official') throw new Error('baseURL is for deepseek-official; use DSH patches to configure other adapters')
  if (baseURL) {
    const url = new URL(baseURL)
    if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) throw new Error('baseURL must be an HTTP(S) URL without embedded credentials')
  }
  const providerConfig = provider === 'deepseek-official' && (baseURL || options.apiKeyEnv || env.DSH_MCP_API_KEY_ENV)
    ? { ...(baseURL ? { baseURL } : {}), ...(apiKeyEnv ? { apiKeyEnv } : {}) }
    : undefined
  const rawCwd = input.cwd ?? env.DSH_MCP_CWD ?? options.cwd
  return {
    connection: connection ?? null, configFile: config.filename,
    command, home, profile, patches, providerConfig, provider, model,
    reasoningEffort: env.DSH_MCP_REASONING_EFFORT?.trim() || options.reasoningEffort || stored.reasoningEffort,
    maxTokens: options.maxTokens, apiKeyEnv, apiKeyAvailable: apiKeyEnv ? Boolean(key) : null,
    cwd: rawCwd ? absolutePath(rawCwd, childEnv, base) : process.cwd(), env: childEnv,
  }
}

/** Safe connection metadata for MCP diagnostics; never expose the environment or credential values. */
export function connectionInfo(context) {
  return {
    connection: context.connection, configFile: context.configFile,
    dshCommand: context.command, dshHome: context.home, profile: context.profile,
    cwd: context.cwd, patches: context.patches, baseURL: context.providerConfig?.baseURL,
    apiKeyEnv: context.apiKeyEnv, apiKeyAvailable: context.apiKeyAvailable,
    defaultRoute: { provider: context.provider, model: context.model, reasoningEffort: context.reasoningEffort },
  }
}

/** Backward-compatible default route helper. */
export function resolveModel(env = process.env, home = resolveDshHome(env)) {
  const stored = readDefaultModel(home)
  return {
    provider: env.DSH_MCP_PROVIDER?.trim() || stored.provider,
    model: env.DSH_MCP_MODEL?.trim() || stored.model,
    ...(stored.reasoningEffort ? { reasoningEffort: stored.reasoningEffort } : {}),
  }
}
