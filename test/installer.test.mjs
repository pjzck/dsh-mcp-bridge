import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import fs from 'node:fs/promises'
import path from 'node:path'
import test, { after } from 'node:test'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const repo = path.join(here, '..')
const installer = path.join(repo, 'scripts', 'install-run-monitor.mjs')
const root = path.join(repo, '.smoke-workspace', `install-test-${process.pid}-${Date.now()}`)

const WEB_PATCH = [
  '# user patch layer',
  '- insert:',
  '    - id: existing-panel',
  '      name: other-panel',
  '- id: some-config',
  '  config:',
  '    foo: bar',
  '',
].join('\n')

const DESKTOP_PATCH = [
  '- insert:',
  "    - id: ds-info-panel",
  "      name: '@deepseek-ai/dsh-ds-info-panel'",
  '',
].join('\n')

after(async () => {
  await fs.rm(root, { recursive: true, force: true })
})

function runInstaller(args) {
  const result = spawnSync(process.execPath, [installer, ...args], {
    cwd: repo,
    encoding: 'utf8',
    windowsHide: true,
  })
  let json
  try {
    json = JSON.parse(result.stdout)
  } catch {
    json = undefined
  }
  return { status: result.status, stdout: result.stdout, stderr: result.stderr, json }
}

async function makeHome(name) {
  const home = path.join(root, name)
  await fs.mkdir(path.join(home, 'profiles', 'web'), { recursive: true })
  await fs.mkdir(path.join(home, 'profiles', 'desktop'), { recursive: true })
  await fs.mkdir(path.join(home, 'profiles', 'node_modules', 'other-plugin'), { recursive: true })
  await fs.writeFile(path.join(home, 'profiles', 'node_modules', 'other-plugin', 'package.json'), '{"name":"other-plugin"}\n')
  await fs.writeFile(path.join(home, 'profiles', 'web', 'cordis.patch.yml'), WEB_PATCH)
  await fs.writeFile(path.join(home, 'profiles', 'desktop', 'cordis.patch.yml'), DESKTOP_PATCH)
  return home
}

async function backupsIn(profileDir) {
  const names = await fs.readdir(profileDir)
  return names.filter((name) => name.includes('.bak-dsh-run-monitor-')).sort()
}

async function countOwnedEntries(file) {
  const text = await fs.readFile(file, 'utf8')
  return (text.match(/-\s+id:\s*dsh-run-monitor/g) ?? []).length
}

test('junction install is idempotent, backs up once and uninstall preserves other plugins', async () => {
  const home = await makeHome('junction')
  const first = runInstaller(['--dsh-home', home])
  assert.equal(first.status, 0, first.stderr || first.stdout)
  assert.equal(first.json.ok, true)
  assert.equal(first.json.action, 'install')
  assert.equal(first.json.link.action, 'linked')
  assert.equal(first.json.profiles.every((profile) => profile.changed), true)
  assert.equal(first.json.restartRequired, true)

  const link = path.join(home, 'profiles', 'node_modules', 'dsh-run-monitor')
  const stat = await fs.lstat(link)
  assert.equal(stat.isSymbolicLink(), true)
  assert.equal((await fs.readlink(link)).toLowerCase().includes(path.join('plugins', 'dsh-run-monitor').toLowerCase()), true)

  const webPatch = path.join(home, 'profiles', 'web', 'cordis.patch.yml')
  const desktopPatch = path.join(home, 'profiles', 'desktop', 'cordis.patch.yml')
  assert.equal(await countOwnedEntries(webPatch), 1)
  assert.equal(await countOwnedEntries(desktopPatch), 1)
  assert.equal((await fs.readFile(webPatch, 'utf8')).startsWith(WEB_PATCH), true)
  assert.equal((await fs.readFile(desktopPatch, 'utf8')).startsWith(DESKTOP_PATCH), true)
  const webBackups = await backupsIn(path.dirname(webPatch))
  const desktopBackups = await backupsIn(path.dirname(desktopPatch))
  assert.equal(webBackups.length, 1)
  assert.equal(desktopBackups.length, 1)
  assert.equal(await fs.readFile(path.join(path.dirname(webPatch), webBackups[0]), 'utf8'), WEB_PATCH)

  const second = runInstaller(['--dsh-home', home])
  assert.equal(second.status, 0, second.stderr || second.stdout)
  assert.equal(second.json.link.action, 'already-installed')
  assert.equal(second.json.profiles.every((profile) => profile.changed === false), true)
  assert.equal(await countOwnedEntries(webPatch), 1)
  assert.equal(await countOwnedEntries(desktopPatch), 1)
  assert.equal((await backupsIn(path.dirname(webPatch))).length, 1, 'idempotent run must not add a backup')
  assert.equal((await backupsIn(path.dirname(desktopPatch))).length, 1, 'idempotent run must not add a backup')

  const removed = runInstaller(['--dsh-home', home, '--uninstall'])
  assert.equal(removed.status, 0, removed.stderr || removed.stdout)
  assert.equal(removed.json.ok, true)
  assert.equal(removed.json.link.action, 'unlinked')
  assert.equal(await countOwnedEntries(webPatch), 0)
  assert.equal(await countOwnedEntries(desktopPatch), 0)
  assert.equal((await fs.readFile(webPatch, 'utf8')).trimEnd(), WEB_PATCH.trimEnd())
  assert.equal((await fs.readFile(desktopPatch, 'utf8')).trimEnd(), DESKTOP_PATCH.trimEnd())
  await assert.rejects(fs.lstat(link))
  assert.equal((await fs.stat(path.join(home, 'profiles', 'node_modules', 'other-plugin'))).isDirectory(), true)

  const again = runInstaller(['--dsh-home', home, '--uninstall'])
  assert.equal(again.status, 0)
  assert.equal(again.json.link.action, 'none')
  assert.equal(again.json.profiles.every((profile) => profile.changed === false), true)
})

test('copy install and uninstall remove only the owned copy', async () => {
  const home = await makeHome('copy')
  const first = runInstaller(['--dsh-home', home, '--copy', '--profile', 'web'])
  assert.equal(first.status, 0, first.stderr || first.stdout)
  assert.equal(first.json.link.action, 'copied')
  const target = path.join(home, 'profiles', 'node_modules', 'dsh-run-monitor')
  assert.equal((await fs.stat(target)).isDirectory(), true)
  assert.equal((await fs.lstat(target)).isSymbolicLink(), false)
  const marker = JSON.parse(await fs.readFile(path.join(target, '.dsh-run-monitor-copy.json'), 'utf8'))
  assert.match(marker.source, /plugins[\\/]dsh-run-monitor$/)
  assert.equal(await countOwnedEntries(path.join(home, 'profiles', 'desktop', 'cordis.patch.yml')), 0, 'only the requested profile is patched')

  const second = runInstaller(['--dsh-home', home, '--copy', '--profile', 'web'])
  assert.equal(second.status, 0)
  assert.equal(second.json.link.action, 'already-installed')

  const removed = runInstaller(['--dsh-home', home, '--copy', '--profile', 'web', '--uninstall'])
  assert.equal(removed.status, 0)
  assert.equal(removed.json.link.action, 'removed-copy')
  await assert.rejects(fs.stat(target))
  assert.equal((await fs.stat(path.join(home, 'profiles', 'node_modules', 'other-plugin'))).isDirectory(), true)
})

test('uninstall removes only our item when it shares an insert list with other plugins', async () => {
  const home = await makeHome('shared-insert')
  const patch = path.join(home, 'profiles', 'web', 'cordis.patch.yml')
  const shared = [
    '- insert:',
    '    - id: existing-panel',
    '      name: other-panel',
    '    - id: dsh-run-monitor',
    '      name: dsh-run-monitor',
    '',
  ].join('\n')
  await fs.writeFile(patch, shared)
  const install = runInstaller(['--dsh-home', home, '--profile', 'web'])
  assert.equal(install.status, 0, install.stderr || install.stdout)
  assert.equal(install.json.profiles[0].action, 'already-present')
  assert.equal(await countOwnedEntries(patch), 1)

  const removed = runInstaller(['--dsh-home', home, '--profile', 'web', '--uninstall'])
  assert.equal(removed.status, 0, removed.stderr || removed.stdout)
  const text = await fs.readFile(patch, 'utf8')
  assert.equal(await countOwnedEntries(patch), 0)
  assert.match(text, /- id: existing-panel/)
  assert.match(text, /name: other-panel/)
  assert.doesNotMatch(text, /dsh-run-monitor/)
})

test('an id owned by a different package is refused without changes', async () => {
  const home = await makeHome('conflict')
  const patch = path.join(home, 'profiles', 'web', 'cordis.patch.yml')
  const conflict = '- insert:\n    - id: dsh-run-monitor\n      name: someone-else\n'
  await fs.writeFile(patch, conflict)
  const result = runInstaller(['--dsh-home', home, '--profile', 'web'])
  assert.equal(result.status, 1)
  assert.match(result.json.error, /different package name/)
  assert.equal(await fs.readFile(patch, 'utf8'), conflict)
  await assert.rejects(fs.lstat(path.join(home, 'profiles', 'node_modules', 'dsh-run-monitor')))
})

test('a valid empty-array patch is supported and restored to [] on uninstall', async () => {
  const home = await makeHome('empty-array')
  const patch = path.join(home, 'profiles', 'web', 'cordis.patch.yml')
  await fs.writeFile(patch, '[]\n')
  const install = runInstaller(['--dsh-home', home, '--profile', 'web'])
  assert.equal(install.status, 0, install.stderr || install.stdout)
  const installed = await fs.readFile(patch, 'utf8')
  assert.equal(installed.includes('[]'), false)
  assert.equal(await countOwnedEntries(patch), 1)
  const second = runInstaller(['--dsh-home', home, '--profile', 'web'])
  assert.equal(second.status, 0)
  assert.equal(await countOwnedEntries(patch), 1)
  const removed = runInstaller(['--dsh-home', home, '--profile', 'web', '--uninstall'])
  assert.equal(removed.status, 0)
  assert.equal((await fs.readFile(patch, 'utf8')).trim(), '[]')
})

test('id and name must belong to the same YAML entry', async () => {
  const home = await makeHome('cross-entry')
  const patch = path.join(home, 'profiles', 'web', 'cordis.patch.yml')
  await fs.writeFile(patch, [
    '- insert:',
    '    - id: dsh-run-monitor',
    '      name: someone-else',
    '- insert:',
    '    - id: other-panel',
    '      name: dsh-run-monitor',
    '',
  ].join('\n'))
  const result = runInstaller(['--dsh-home', home, '--profile', 'web'])
  assert.equal(result.status, 1)
  assert.match(result.json.error, /different package name/)
  await assert.rejects(fs.lstat(path.join(home, 'profiles', 'node_modules', 'dsh-run-monitor')))
})

test('uninstall preserves trailing top-level config and comments', async () => {
  const home = await makeHome('trailing')
  const patch = path.join(home, 'profiles', 'web', 'cordis.patch.yml')
  const install = runInstaller(['--dsh-home', home, '--profile', 'web'])
  assert.equal(install.status, 0)
  const trailing = '# trailing comment immediately after our block\n- id: trailing-config\n  config:\n    keep: true\n# trailing comment\n'
  await fs.appendFile(patch, trailing)
  const removed = runInstaller(['--dsh-home', home, '--profile', 'web', '--uninstall'])
  assert.equal(removed.status, 0, removed.stderr || removed.stdout)
  const text = await fs.readFile(patch, 'utf8')
  assert.match(text, /- id: trailing-config/)
  assert.match(text, /keep: true/)
  assert.match(text, /# trailing comment/)
  assert.doesNotMatch(text, /dsh-run-monitor/)
})

test('profile names cannot escape the profiles directory', async () => {
  const home = await makeHome('traversal')
  const before = await fs.readFile(path.join(home, 'profiles', 'web', 'cordis.patch.yml'), 'utf8')
  for (const profile of ['../escape', 'web/../../outside', '..\\escape', 'C:\\Windows']) {
    const result = runInstaller(['--dsh-home', home, '--profile', profile])
    assert.equal(result.status, 1, `profile ${profile} should be rejected`)
    assert.match(result.json.error, /invalid profile name|escapes the DSH profiles directory/)
  }
  assert.equal(await fs.readFile(path.join(home, 'profiles', 'web', 'cordis.patch.yml'), 'utf8'), before)
  await assert.rejects(fs.lstat(path.join(home, 'profiles', 'node_modules', 'dsh-run-monitor')))
})

test('install rolls back earlier patches and the link when a later profile fails', async () => {
  const home = await makeHome('rollback-install')
  const webPatch = path.join(home, 'profiles', 'web', 'cordis.patch.yml')
  const desktopPatch = path.join(home, 'profiles', 'desktop', 'cordis.patch.yml')
  const webBefore = await fs.readFile(webPatch, 'utf8')
  const desktopBefore = await fs.readFile(desktopPatch, 'utf8')
  await fs.chmod(desktopPatch, 0o444)
  try {
    const result = runInstaller(['--dsh-home', home])
    assert.equal(result.status, 1)
    assert.equal(await fs.readFile(webPatch, 'utf8'), webBefore, 'web patch must be restored')
    assert.equal(await fs.readFile(desktopPatch, 'utf8'), desktopBefore)
    await assert.rejects(fs.lstat(path.join(home, 'profiles', 'node_modules', 'dsh-run-monitor')))
    assert.equal((await backupsIn(path.dirname(webPatch))).length, 0, 'rollback removes its backup')
  } finally {
    await fs.chmod(desktopPatch, 0o666).catch(() => {})
  }
})

test('uninstall restores patches and keeps the link when a later profile fails', async () => {
  const home = await makeHome('rollback-uninstall')
  const install = runInstaller(['--dsh-home', home])
  assert.equal(install.status, 0, install.stderr || install.stdout)
  const webPatch = path.join(home, 'profiles', 'web', 'cordis.patch.yml')
  const desktopPatch = path.join(home, 'profiles', 'desktop', 'cordis.patch.yml')
  const webInstalled = await fs.readFile(webPatch, 'utf8')
  await fs.chmod(desktopPatch, 0o444)
  try {
    const result = runInstaller(['--dsh-home', home, '--uninstall'])
    assert.equal(result.status, 1)
    assert.equal(await fs.readFile(webPatch, 'utf8'), webInstalled, 'web patch must be restored')
    assert.equal(await countOwnedEntries(desktopPatch), 1)
    assert.equal((await fs.lstat(path.join(home, 'profiles', 'node_modules', 'dsh-run-monitor'))).isSymbolicLink(), true)
  } finally {
    await fs.chmod(desktopPatch, 0o666).catch(() => {})
  }
})

test('--dsh-home is required and dry-run does not write', async () => {
  const missing = runInstaller([])
  assert.equal(missing.status, 1)
  assert.match(missing.json.error, /--dsh-home is required/)

  const home = await makeHome('dry')
  const result = runInstaller(['--dsh-home', home, '--dry-run'])
  assert.equal(result.status, 0)
  assert.equal(result.json.dryRun, true)
  assert.equal(result.json.link.changed, true)
  assert.equal(await countOwnedEntries(path.join(home, 'profiles', 'web', 'cordis.patch.yml')), 0)
  await assert.rejects(fs.lstat(path.join(home, 'profiles', 'node_modules', 'dsh-run-monitor')))
})
