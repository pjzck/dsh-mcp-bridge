#!/usr/bin/env node
/**
 * Install or remove the standalone dsh-run-monitor plugin in a DSH home.
 *
 * Safety contract:
 * - the DSH home must be passed explicitly (`--dsh-home`);
 * - only the `dsh-run-monitor` package link and its own patch entry are touched;
 * - an existing patch file is backed up before the first real change;
 * - running the same command twice does not duplicate the entry or create a
 *   second backup;
 * - no DSH process is killed and no service is restarted.
 *
 * Usage:
 *   node scripts/install-run-monitor.mjs --dsh-home <path> [--profile web,desktop]
 *   node scripts/install-run-monitor.mjs --dsh-home <path> --uninstall
 *   ... [--plugin-dir <path>] [--copy] [--dry-run]
 */

import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(here, '..')
const PACKAGE_NAME = 'dsh-run-monitor'
const MANAGED_COMMENT = '# dsh-run-monitor: managed by scripts/install-run-monitor.mjs'
const COPY_MARKER = '.dsh-run-monitor-copy.json'

function usage() {
  return [
    'usage: node scripts/install-run-monitor.mjs --dsh-home <path> [options]',
    '  --profile <a,b>     profiles to patch (default: web,desktop)',
    '  --plugin-dir <path> plugin package (default: <repo>/plugins/dsh-run-monitor)',
    '  --copy              copy the package instead of a junction/symlink',
    '  --uninstall         remove only this plugin link and patch entry',
    '  --dry-run           report actions without writing',
  ].join(os.EOL)
}

function parseArgs(argv) {
  const out = { profiles: ['web', 'desktop'], copy: false, uninstall: false, dryRun: false }
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    const next = () => {
      const value = argv[index + 1]
      if (value === undefined || value.startsWith('--')) throw new Error(`${arg} requires a value`)
      index += 1
      return value
    }
    if (arg === '--dsh-home') out.dshHome = next()
    else if (arg === '--profile') out.profiles = next().split(',').map((item) => item.trim()).filter(Boolean)
    else if (arg === '--plugin-dir') out.pluginDir = next()
    else if (arg === '--copy') out.copy = true
    else if (arg === '--uninstall') out.uninstall = true
    else if (arg === '--dry-run') out.dryRun = true
    else if (arg === '--help' || arg === '-h') out.help = true
    else throw new Error(`unknown argument: ${arg}`)
  }
  return out
}

async function exists(target) {
  try {
    await fs.lstat(target)
    return true
  } catch {
    return false
  }
}

function normalizeLinkTarget(value) {
  let raw = String(value)
  if (raw.startsWith('\\\\?\\')) raw = raw.slice(4)
  if (raw.startsWith('\\\\?\\UNC\\')) raw = `\\\\${raw.slice(8)}`
  return path.resolve(raw).toLowerCase()
}

/** Resolve a profile directory under <dshHome>/profiles and reject traversal. */
function profileDirFor(dshHome, profile) {
  if (typeof profile !== 'string' || profile === '' || profile === '.' || profile === '..'
    || !/^[A-Za-z0-9._-]+$/.test(profile)) {
    throw new Error(`invalid profile name: ${String(profile)}`)
  }
  const base = path.resolve(dshHome, 'profiles')
  const dir = path.resolve(base, profile)
  const relative = path.relative(base, dir)
  if (relative !== profile || relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error(`profile escapes the DSH profiles directory: ${String(profile)}`)
  }
  return dir
}

/**
 * Parse `- id:` entries and associate the nearest nested `name:` line with the
 * same item. Matching id and name anywhere in the document is not enough: two
 * unrelated entries must not impersonate an installed plugin.
 */
function entryItems(text) {
  const lines = text.split('\n')
  const items = []
  for (let index = 0; index < lines.length; index += 1) {
    const match = lines[index].match(/^(\s*)-\s+id:\s*['"]?([^'"\s#]+)['"]?\s*$/)
    if (!match) continue
    const indent = match[1].length
    const id = match[2]
    let name
    for (let next = index + 1; next < lines.length; next += 1) {
      const line = lines[next]
      if (line.trim() === '') continue
      const nextIndent = line.match(/^\s*/)[0].length
      if (nextIndent <= indent && /^\s*-\s/.test(line)) break
      if (nextIndent <= indent) break
      const nameMatch = line.match(/^\s*name:\s*['"]?([^'"\s#]+)['"]?\s*$/)
      if (nameMatch) {
        name = nameMatch[1]
        break
      }
    }
    items.push({ id, name, line: index, indent })
  }
  return items
}

function hasOwnedEntry(text) {
  return entryItems(text).some((item) => item.id === PACKAGE_NAME && item.name === PACKAGE_NAME)
}

function hasForeignId(text) {
  return entryItems(text).some((item) => item.id === PACKAGE_NAME && item.name !== PACKAGE_NAME)
}

function isEmptyArrayLine(line) {
  return /^\s*\[\s*\]\s*(#.*)?$/.test(line)
}

function patchIsOnlyEmptyArray(text) {
  let sawEmptyArray = false
  for (const line of text.split('\n')) {
    const trimmed = line.trim()
    if (trimmed === '' || trimmed.startsWith('#')) continue
    if (isEmptyArrayLine(line) && !sawEmptyArray) {
      sawEmptyArray = true
      continue
    }
    return false
  }
  return sawEmptyArray
}

function stripEmptyArray(text) {
  return text.split('\n').filter((line) => !isEmptyArrayLine(line)).join('\n')
}

function appendOwnedBlock(text) {
  let next = patchIsOnlyEmptyArray(text) ? stripEmptyArray(text) : text
  if (next !== '' && !next.endsWith('\n')) next += '\n'
  if (next !== '' && !next.endsWith('\n\n')) next += '\n'
  next += `${MANAGED_COMMENT}\n- insert:\n    - id: dsh-run-monitor\n      name: dsh-run-monitor\n`
  return next
}

/** Keep a patch valid when our removal leaves no entries at all. */
function ensureValidEmptyPatch(text) {
  const significant = text.split('\n').filter((line) => {
    const trimmed = line.trim()
    return trimmed !== '' && !trimmed.startsWith('#') && !isEmptyArrayLine(line)
  })
  if (significant.length > 0) return text
  const comments = text.split('\n').filter((line) => {
    const trimmed = line.trim()
    return trimmed !== '' && !isEmptyArrayLine(line)
  })
  return comments.length === 0 ? '[]\n' : `${comments.join('\n')}\n[]\n`
}

/** Remove top-level YAML blocks that contain our id+name pair. */
function removeOwnedBlocks(input) {
  const trailingNewline = input.endsWith('\n')
  const lines = input.split('\n')
  if (trailingNewline) lines.pop()
  let removed = 0
  let changed = true
  while (changed) {
    changed = false
    const starts = []
    for (let i = 0; i < lines.length; i += 1) {
      if (/^-\s/.test(lines[i])) starts.push(i)
    }
    for (let index = 0; index < starts.length; index += 1) {
      const start = starts[index]
      const end = index + 1 < starts.length ? starts[index + 1] : lines.length
      const block = lines.slice(start, end).join('\n')
      if (!hasOwnedEntry(block)) continue
      if (!/^-\s+(insert:|id:\s*['"]?dsh-run-monitor)/.test(lines[start])) {
        throw new Error(`refusing to remove dsh-run-monitor entry nested in an unexpected block at line ${start + 1}`)
      }

      const blockLines = lines.slice(start, end)
      const item = entryItems(block).find((candidate) => candidate.id === PACKAGE_NAME && candidate.name === PACKAGE_NAME)
      if (item === undefined) continue

      if (/^-\s+id:/.test(lines[start])) {
        // A top-level override for this id belongs to us. Preserve trailing
        // comments/blank lines that follow the item.
        let removeEnd = blockLines.length
        while (removeEnd > item.line + 1 && /^\s*(#|$)/.test(blockLines[removeEnd - 1])) removeEnd -= 1
        let removeStart = start
        if (removeStart > 0 && lines[removeStart - 1].trim() === MANAGED_COMMENT) removeStart -= 1
        lines.splice(removeStart, start + removeEnd - removeStart, ...blockLines.slice(removeEnd))
      } else {
        // Our entry may share a user's insert list; remove only this list item.
        const itemIndex = item.line
        const itemIndent = item.indent
        let itemEnd = itemIndex + 1
        while (itemEnd < blockLines.length) {
          const line = blockLines[itemEnd]
          const indent = line.match(/^\s*/)[0].length
          if (line.trim() !== '' && indent <= itemIndent && /^\s*-\s/.test(line)) break
          itemEnd += 1
        }
        // Comments/blank lines immediately after the item are not ours.
        while (itemEnd > itemIndex + 1 && /^\s*(#|$)/.test(blockLines[itemEnd - 1])) itemEnd -= 1
        const remainingItems = blockLines.filter((line, i) => i < itemIndex || i >= itemEnd).filter((line) => /^\s*-\s+id:/.test(line)).length
        if (remainingItems === 0) {
          // Drop the insert header and our item, but keep any trailing comments
          // and the user's surrounding content.
          const kept = blockLines.filter((line, i) => i !== 0 && (i < itemIndex || i >= itemEnd))
          let removeStart = start
          if (removeStart > 0 && lines[removeStart - 1].trim() === MANAGED_COMMENT) removeStart -= 1
          lines.splice(removeStart, end - removeStart, ...kept)
        } else {
          blockLines.splice(itemIndex, itemEnd - itemIndex)
          lines.splice(start, end - start, ...blockLines)
        }
      }
      removed += 1
      changed = true
      break
    }
  }
  const result = lines.join('\n') + (trailingNewline ? '\n' : '')
  return { text: removed > 0 ? result : input, removed }
}

async function linkPlugin({ dshHome, pluginDir, copy, dryRun }) {
  const modules = path.join(dshHome, 'profiles', 'node_modules')
  const target = path.join(modules, PACKAGE_NAME)
  const summary = { path: target, type: copy ? 'copy' : 'link', changed: false, action: 'none' }
  if (copy) {
    if (await exists(target)) {
      const stat = await fs.lstat(target)
      if (stat.isSymbolicLink()) throw new Error(`refusing to replace a link at ${target} with a copy; uninstall first`)
      const marker = path.join(target, COPY_MARKER)
      let owned = false
      try {
        const parsed = JSON.parse(await fs.readFile(marker, 'utf8'))
        owned = normalizeLinkTarget(parsed.source) === normalizeLinkTarget(pluginDir)
      } catch {
        const pkg = JSON.parse(await fs.readFile(path.join(target, 'package.json'), 'utf8').catch(() => '{}'))
        owned = pkg.name === PACKAGE_NAME
      }
      if (!owned) throw new Error(`refusing to overwrite a directory this installer does not own: ${target}`)
      summary.action = 'already-installed'
      return summary
    }
    if (!dryRun) {
      await fs.mkdir(modules, { recursive: true })
      await fs.cp(pluginDir, target, {
        recursive: true,
        filter: (source) => !source.includes(`${path.sep}test`) && !source.includes(`${path.sep}.tmp`),
      })
      await fs.writeFile(path.join(target, COPY_MARKER), `${JSON.stringify({
        source: path.resolve(pluginDir),
        installedAt: new Date().toISOString(),
      }, null, 2)}\n`, 'utf8')
    }
    summary.changed = true
    summary.action = 'copied'
    return summary
  }

  if (await exists(target)) {
    const stat = await fs.lstat(target)
    if (!stat.isSymbolicLink()) {
      throw new Error(`refusing to replace a non-link path: ${target}`)
    }
    const current = await fs.readlink(target)
    if (normalizeLinkTarget(current) !== normalizeLinkTarget(pluginDir)) {
      throw new Error(`refusing to replace a link to another package: ${target} -> ${current}`)
    }
    summary.action = 'already-installed'
    return summary
  }
  if (!dryRun) {
    await fs.mkdir(modules, { recursive: true })
    const type = process.platform === 'win32' ? 'junction' : 'dir'
    await fs.symlink(path.resolve(pluginDir), target, type)
  }
  summary.changed = true
  summary.action = 'linked'
  return summary
}

async function removePlugin({ dshHome, pluginDir, dryRun }) {
  const target = path.join(dshHome, 'profiles', 'node_modules', PACKAGE_NAME)
  const summary = { path: target, changed: false, action: 'none' }
  if (!(await exists(target))) return summary
  const stat = await fs.lstat(target)
  if (stat.isSymbolicLink()) {
    const current = await fs.readlink(target)
    if (normalizeLinkTarget(current) !== normalizeLinkTarget(pluginDir)) {
      throw new Error(`refusing to remove a link to another package: ${target} -> ${current}`)
    }
    if (!dryRun) await fs.unlink(target)
    summary.changed = true
    summary.action = 'unlinked'
    return summary
  }
  if (!stat.isDirectory()) throw new Error(`refusing to remove a non-directory path: ${target}`)
  const marker = path.join(target, COPY_MARKER)
  let owned = false
  try {
    const parsed = JSON.parse(await fs.readFile(marker, 'utf8'))
    owned = normalizeLinkTarget(parsed.source) === normalizeLinkTarget(pluginDir)
  } catch {
    owned = false
  }
  if (!owned) throw new Error(`refusing to remove a copied directory without this installer's marker: ${target}`)
  if (!dryRun) await fs.rm(target, { recursive: true, force: true })
  summary.changed = true
  summary.action = 'removed-copy'
  return summary
}

async function patchProfile({ dshHome, profile, dryRun, uninstall }) {
  const profileDir = profileDirFor(dshHome, profile)
  const patchPath = path.join(profileDir, 'cordis.patch.yml')
  const stat = await fs.stat(profileDir).catch(() => undefined)
  if (stat === undefined || !stat.isDirectory()) throw new Error(`profile directory not found: ${profileDir}`)
  const original = await fs.readFile(patchPath, 'utf8').catch((error) => {
    if (error?.code === 'ENOENT') return ''
    throw error
  })
  const summary = { profile, patch: patchPath, changed: false, backup: null, action: 'none' }

  if (uninstall) {
    const removed = removeOwnedBlocks(original)
    if (removed.removed === 0) return summary
    const next = ensureValidEmptyPatch(removed.text)
    if (!dryRun) {
      summary.backup = await backupFile(patchPath, original)
      await writeAtomic(patchPath, next)
    }
    summary.changed = true
    summary.action = 'patch-entry-removed'
    return summary
  }

  if (hasForeignId(original)) {
    throw new Error(`dsh-run-monitor id already exists with a different name in ${patchPath}`)
  }
  if (hasOwnedEntry(original)) {
    summary.action = 'already-present'
    return summary
  }
  const next = appendOwnedBlock(original)
  if (!dryRun) {
    summary.backup = await backupFile(patchPath, original)
    await writeAtomic(patchPath, next)
  }
  summary.changed = true
  summary.action = 'patch-entry-added'
  return summary
}

async function backupFile(target, contents) {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  const backup = `${target}.bak-dsh-run-monitor-${stamp}`
  await fs.writeFile(backup, contents, 'utf8')
  return backup
}

async function writeAtomic(target, contents) {
  const tmp = `${target}.tmp-dsh-run-monitor-${process.pid}-${Date.now()}`
  try {
    await fs.writeFile(tmp, contents, 'utf8')
    await fs.rename(tmp, target)
  } catch (error) {
    await fs.unlink(tmp).catch(() => {})
    throw error
  }
}

async function readProfileStates(dshHome, profiles) {
  const states = []
  for (const profile of profiles) {
    const profileDir = profileDirFor(dshHome, profile)
    const stat = await fs.stat(profileDir).catch(() => undefined)
    if (stat === undefined || !stat.isDirectory()) throw new Error(`profile directory not found: ${profileDir}`)
    const patchPath = path.join(profileDir, 'cordis.patch.yml')
    const original = await fs.readFile(patchPath, 'utf8').catch((error) => {
      if (error?.code === 'ENOENT') return ''
      throw error
    })
    states.push({ profile, patchPath, original })
  }
  return states
}

async function restorePatches(changed) {
  for (const entry of [...changed].reverse()) {
    if (!entry.dryRun) {
      await writeAtomic(entry.state.patchPath, entry.state.original)
      if (entry.summary.backup) await fs.unlink(entry.summary.backup).catch(() => {})
    }
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  if (args.help) {
    console.log(usage())
    return
  }
  if (!args.dshHome) throw new Error(`--dsh-home is required\n${usage()}`)
  const dshHome = path.resolve(args.dshHome)
  const pluginDir = path.resolve(args.pluginDir ?? path.join(repoRoot, 'plugins', PACKAGE_NAME))
  const pkg = JSON.parse(await fs.readFile(path.join(pluginDir, 'package.json'), 'utf8'))
  if (pkg.name !== PACKAGE_NAME) throw new Error(`plugin package name must be ${PACKAGE_NAME}: ${pkg.name}`)
  const homeStat = await fs.stat(dshHome).catch(() => undefined)
  if (homeStat === undefined || !homeStat.isDirectory()) throw new Error(`DSH home not found: ${dshHome}`)
  if (args.profiles.length === 0) throw new Error('at least one profile is required')

  const result = {
    ok: true,
    action: args.uninstall ? 'uninstall' : 'install',
    dshHome,
    pluginDir,
    dryRun: args.dryRun,
    profiles: [],
    restartRequired: !args.uninstall,
    note: args.uninstall
      ? 'Only this plugin link and its own patch entries were removed. Other plugins and settings are untouched.'
      : 'Restart or reload the DSH host for the plugin to load; this script never kills or restarts a process.',
  }

  const states = await readProfileStates(dshHome, args.profiles)
  if (!args.uninstall) {
    for (const state of states) {
      if (hasForeignId(state.original)) {
        throw new Error(`dsh-run-monitor id already exists with a different package name in ${state.patchPath}`)
      }
    }
  }

  const changed = []
  if (args.uninstall) {
    try {
      for (const state of states) {
        const summary = await patchProfile({ dshHome, profile: state.profile, dryRun: args.dryRun, uninstall: true })
        result.profiles.push(summary)
        if (summary.changed) changed.push({ state, summary, dryRun: args.dryRun })
      }
      result.link = await removePlugin({ dshHome, pluginDir, dryRun: args.dryRun })
    } catch (error) {
      await restorePatches(changed)
      throw error
    }
  } else {
    result.link = await linkPlugin({ dshHome, pluginDir, copy: args.copy, dryRun: args.dryRun })
    try {
      for (const state of states) {
        const summary = await patchProfile({ dshHome, profile: state.profile, dryRun: args.dryRun, uninstall: false })
        result.profiles.push(summary)
        if (summary.changed) changed.push({ state, summary, dryRun: args.dryRun })
      }
    } catch (error) {
      await restorePatches(changed)
      if (result.link.changed && !args.dryRun) {
        await removePlugin({ dshHome, pluginDir, dryRun: false }).catch(() => {})
      }
      throw error
    }
  }
  console.log(JSON.stringify(result, null, 2))
}

main().catch((error) => {
  console.log(JSON.stringify({ ok: false, error: error instanceof Error ? error.message : String(error) }, null, 2))
  process.exitCode = 1
})
