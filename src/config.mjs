import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

/** @returns {string} The DSH home used for settings, credentials and sessions. */
export function resolveDshHome(env = process.env) {
  return env.DSH_HOME || path.join(os.homedir(), '.dsh')
}

/**
 * Resolve the `dsh` launcher. Prefer an explicit override, then the launcher
 * installed by DSH Desktop on this machine, then PATH.
 * @param {NodeJS.ProcessEnv} env
 * @returns {string}
 */
export function resolveDshCommand(env = process.env) {
  const explicit = env.DSH_MCP_DSH_COMMAND?.trim()
  if (explicit) return explicit
  const desktop = 'H:\\DeepseekHarness\\resources\\runtime\\cli\\bin\\dsh.cmd'
  if (fs.existsSync(desktop)) return desktop
  return process.platform === 'win32' ? 'dsh.cmd' : 'dsh'
}

/**
 * Read the model route the desktop wrote into a settings document. The live
 * file wins; the imported/bak files are fallbacks for a fresh CLI profile.
 * @param {string} home
 * @returns {{ provider?: string, model?: string, reasoningEffort?: string }}
 */
export function readDefaultModel(home = resolveDshHome()) {
  const candidates = [
    path.join(home, 'settings.yaml'),
    path.join(home, 'settings.yaml.imported'),
  ]
  try {
    const baks = fs
      .readdirSync(home)
      .filter((name) => name.startsWith('settings.yaml.bak-'))
      .sort()
      .reverse()
    for (const bak of baks) candidates.push(path.join(home, bak))
  } catch {
    // No DSH home yet; the built-in defaults below still apply.
  }
  for (const candidate of candidates) {
    try {
      const text = fs.readFileSync(candidate, 'utf8')
      const block = text.match(/^agent-default-model:\s*\n((?:[ \t]+.*\n?)*)/m)
      if (!block) continue
      const provider = block[1].match(/^\s+provider:\s*['"]?([^'"\s#]+)['"]?\s*$/m)
      const model = block[1].match(/^\s+model:\s*['"]?([^'"\s#]+)['"]?\s*$/m)
      const effort = block[1].match(/^\s+reasoningEffort:\s*['"]?([^'"\s#]+)['"]?\s*$/m)
      if (provider && model) {
        return {
          provider: provider[1],
          model: model[1],
          ...(effort ? { reasoningEffort: effort[1] } : {}),
        }
      }
    } catch {
      // Try the next document.
    }
  }
  return { provider: 'deepseek-official', model: 'deepseek-flash' }
}

/**
 * The SDK profile runs outside the desktop profile and therefore cannot use
 * the desktop account session. It needs an API key. Prefer the process
 * environment, then the managed credential document the Models page writes.
 * @param {string} home
 * @param {NodeJS.ProcessEnv} env
 * @returns {string | undefined}
 */
export function readApiKey(home = resolveDshHome(), env = process.env) {
  const fromEnv = env.DEEPSEEK_API_KEY?.trim()
  if (fromEnv) return fromEnv
  try {
    const text = fs.readFileSync(path.join(home, '.credentials.yaml'), 'utf8')
    const match = text.match(/^\s+DEEPSEEK_API_KEY:\s*(.+?)\s*$/m)
    if (!match) return undefined
    const value = match[1].trim().replace(/^['"]|['"]$/g, '')
    return value === '' ? undefined : value
  } catch {
    return undefined
  }
}

/** @returns {{ provider: string, model: string, reasoningEffort?: string }} */
export function resolveModel(env = process.env, home = resolveDshHome()) {
  const stored = readDefaultModel(home)
  return {
    provider: env.DSH_MCP_PROVIDER?.trim() || stored.provider || 'deepseek-official',
    model: env.DSH_MCP_MODEL?.trim() || stored.model || 'deepseek-flash',
    ...(stored.reasoningEffort ? { reasoningEffort: stored.reasoningEffort } : {}),
  }
}
