import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'
import { connectionInfo, readApiKey, readDefaultModel, resolveConnection, resolveDshCommand } from '../src/config.mjs'
import { DshManager } from '../src/manager.mjs'

const root = fileURLToPath(new URL('../', import.meta.url))
async function fixture(t, config = {}) {
  const base = path.join(root, '.dsh', 'tmp', 'bridge-1030')
  await fs.mkdir(base, { recursive: true })
  const directory = await fs.mkdtemp(path.join(base, 'config with spaces-'))
  const state = {}
  t.after(async () => {
    await state.cleanup?.()
    await fs.rm(directory, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 })
  })
  const filename = path.join(directory, 'bridge.json')
  await fs.writeFile(filename, JSON.stringify(config))
  return Object.assign(state, { directory, filename, env: { DSH_HOME: directory, DSH_MCP_CONFIG: filename } })
}

test('PATH defaults work without a bridge file or stored API key', async (t) => {
  const f = await fixture(t)
  const env = { DSH_HOME: f.directory }
  assert.equal(resolveDshCommand(env), process.platform === 'win32' ? 'dsh.cmd' : 'dsh')
  const resolved = resolveConnection({}, env)
  assert.equal(resolved.profile, 'sdk')
  assert.equal(resolved.provider, 'deepseek-official')
  assert.equal(resolved.apiKeyAvailable, false)
})

test('named connections expand relative paths and inject only their credential reference', async (t) => {
  const f = await fixture(t, {
    defaultConnection: 'company', cwd: '.',
    connections: {
      company: { home: '${TEST_HOME}', provider: 'deepseek-official', model: 'company-model', baseURL: 'https://company.example/v1', apiKeyEnv: 'COMPANY_KEY', env: { OPTIONAL: null, LABEL: '${LABEL_VALUE}' } },
      personal: { home: '%TEST_HOME%', model: 'personal-model', apiKeyEnv: 'DEEPSEEK_API_KEY' },
    },
  })
  await fs.writeFile(path.join(f.directory, '.credentials.yaml'), 'version: 1\nrefs:\n  COMPANY_KEY: "company: key # literal"\n  DEEPSEEK_API_KEY: personal-secret\n')
  const env = { ...f.env, TEST_HOME: f.directory, OPTIONAL: 'remove-me', LABEL_VALUE: 'expanded' }
  const company = resolveConnection({}, env)
  assert.equal(company.connection, 'company')
  assert.equal(company.cwd, f.directory)
  assert.equal(company.env.DSH_HOME, f.directory)
  assert.equal(company.env.COMPANY_KEY, 'company: key # literal')
  assert.equal(company.env.DEEPSEEK_API_KEY, undefined)
  assert.equal(company.env.OPTIONAL, undefined)
  assert.equal(company.env.LABEL, 'expanded')
  assert.deepEqual(company.providerConfig, { baseURL: 'https://company.example/v1', apiKeyEnv: 'COMPANY_KEY' })
  const personal = resolveConnection({ connection: 'personal' }, env)
  assert.equal(personal.env.DEEPSEEK_API_KEY, 'personal-secret')
  assert.equal(personal.env.COMPANY_KEY, undefined)
  assert.doesNotMatch(JSON.stringify(connectionInfo(company)), /company: key|personal-secret/)
})

test('call route beats environment, which beats selected connection defaults', async (t) => {
  const f = await fixture(t, { defaultConnection: 'a', model: 'root', connections: { a: { model: 'a' }, b: { model: 'b' } } })
  const env = { ...f.env, DSH_MCP_CONNECTION: 'b', DSH_MCP_MODEL: 'env' }
  assert.equal(resolveConnection({}, env).connection, 'b')
  assert.equal(resolveConnection({}, env).model, 'env')
  assert.equal(resolveConnection({ connection: 'a', model: 'call' }, env).model, 'call')
})

test('DSH YAML defaults and credential references support CRLF and quoted values', async (t) => {
  const f = await fixture(t)
  await fs.writeFile(path.join(f.directory, 'settings.yaml'), 'agent-default-model:\r\n  provider: "custom"\r\n  model: "model: one" # comment\r\n  reasoningEffort: high\r\n')
  assert.deepEqual(readDefaultModel(f.directory), { provider: 'custom', model: 'model: one', reasoningEffort: 'high' })
  await fs.writeFile(path.join(f.directory, '.credentials.yaml'), 'refs:\n  KEY: stored\n')
  assert.equal(readApiKey(f.directory, { KEY: 'ambient' }, 'KEY'), 'ambient')
  const resolved = resolveConnection({}, f.env)
  assert.equal(resolved.apiKeyEnv, false)
  assert.equal(resolved.apiKeyAvailable, null)
})

test('explicit errors never silently switch to another connection or print secrets', async (t) => {
  const f = await fixture(t, { defaultConnection: 'missing' })
  assert.throws(() => resolveConnection({}, f.env), /Unknown bridge connection/)
  assert.throws(() => resolveConnection({}, { ...f.env, DSH_MCP_CONFIG: path.join(f.directory, 'missing.json') }), /Cannot read bridge config/)
  await fs.writeFile(f.filename, '{ "apiKeyEnv": "secret with spaces" }')
  assert.throws(() => resolveConnection({}, f.env), (error) => /apiKeyEnv/.test(error.message) && !error.message.includes('secret with spaces'))
  await fs.writeFile(f.filename, JSON.stringify({ cwd: '${MISSING_VARIABLE}' }))
  assert.throws(() => resolveConnection({}, f.env), /MISSING_VARIABLE/)
  await fs.writeFile(f.filename, JSON.stringify({ baseURL: 'https://user:secret@example.com' }))
  assert.throws(() => resolveConnection({}, f.env), (error) => /without embedded credentials/.test(error.message) && !error.message.includes('secret@'))
})

test('custom provider uses selected SDK profile and DSH patch paths without forcing a DeepSeek key', async (t) => {
  const f = await fixture(t)
  await fs.writeFile(path.join(f.directory, 'provider.yml'), '[]')
  await fs.writeFile(f.filename, JSON.stringify({ provider: 'custom', model: 'm', profile: 'custom-sdk', patches: ['./provider.yml'], apiKeyEnv: false }))
  const resolved = resolveConnection({}, f.env)
  assert.equal(resolved.profile, 'custom-sdk')
  assert.equal(resolved.apiKeyEnv, false)
  assert.deepEqual(resolved.patches, [path.join(f.directory, 'provider.yml')])
  assert.equal(resolved.providerConfig, undefined)
})

test('runtime connections remain isolated and resumed sessions retain their original connection', async (t) => {
  const f = await fixture(t)
  const mock = path.join(f.directory, 'fake-sdk.mjs')
  await fs.writeFile(mock, `import readline from 'node:readline';
    let seq=0;
    const send=(m)=>process.stdout.write(JSON.stringify(m)+'\\n');
    const reader=readline.createInterface({input:process.stdin});
    reader.on('line',(line)=>{
      const m=JSON.parse(line);
      if(m.method==='session/prompt') {
        send({jsonrpc:'2.0',id:m.id,result:{messageId:'message'}});
        for(const event of [
          {type:'assistant/message',data:{message:{content:[{type:'text',text:process.env.TEST_KEY}]}}},
          {type:'turn/end',data:{reason:{kind:'completed'}}}
        ]) send({jsonrpc:'2.0',method:'session.event',params:{sessionId:m.params.sessionId,event:{...event,seq:++seq}}});
      } else send({jsonrpc:'2.0',id:m.id,result:{}});
    });`)
  const command = path.join(f.directory, process.platform === 'win32' ? 'fake launcher.cmd' : 'fake launcher')
  await fs.writeFile(command, process.platform === 'win32'
    ? `@echo off\r\n"${process.execPath}" "${mock}" %*\r\n`
    : `#!/bin/sh\nexec "${process.execPath}" "${mock}" "$@"\n`, { mode: 0o700 })
  await fs.writeFile(f.filename, JSON.stringify({ command, cwd: f.directory, defaultConnection: 'a', apiKeyEnv: false, connections: { a: { env: { TEST_KEY: 'connection-a' } }, b: { env: { TEST_KEY: 'connection-b' } } } }))
  const manager = new DshManager({ ...process.env, ...f.env })
  f.cleanup = () => manager.shutdown()
  const first = await manager.run({ task: 'first', timeoutMs: 5000 })
  assert.equal(first.status, 'succeeded')
  assert.equal(first.assistantText, 'connection-a')
  const second = await manager.run({ task: 'second', connection: 'b', timeoutMs: 5000 })
  assert.equal(second.assistantText, 'connection-b')
  assert.equal(manager.runtimes.size, 2)
  await fs.writeFile(f.filename, JSON.stringify({ defaultConnection: 'b', connections: { b: { model: 'changed' } } }))
  const resumed = await manager.run({ task: 'follow', sessionId: first.sessionId, timeoutMs: 5000 })
  assert.equal(resumed.connection, 'a')
  assert.equal(resumed.assistantText, 'connection-a')
  await assert.rejects(manager.start({ task: 'wrong', sessionId: first.sessionId, connection: 'b' }), /original connection/)
})
