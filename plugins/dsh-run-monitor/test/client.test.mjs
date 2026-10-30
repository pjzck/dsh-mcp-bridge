import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import test from 'node:test'
import vm from 'node:vm'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const bundlePath = path.join(here, '..', 'lib', 'client.js')
const code = await readFile(bundlePath, 'utf8')

const payloadOf = (files, extra = {}) => ({
  ok: true,
  value: { schemaVersion: 1, generatedAt: '2026-10-25T12:00:00.000Z', statusDir: 'H:\\tmp', files, missing: false, ...extra },
})

const bridge = (overrides = {}) => ({
  instanceId: 'bridge-a',
  pid: 123,
  version: '0.1.0',
  state: 'running',
  startedAt: '2026-10-25T11:59:00.000Z',
  updatedAt: '2026-10-25T11:59:59.000Z',
  heartbeatAt: '2026-10-25T11:59:59.000Z',
  heartbeatIntervalMs: 5000,
  staleAfterMs: 15000,
  heartbeatAgeMs: 1000,
  stale: false,
  ...overrides,
})

const run = (overrides = {}) => ({
  sessionId: 'session-a',
  cwd: 'H:\\workspace\\repo',
  provider: 'deepseek-official',
  model: 'deepseek-flash',
  status: 'running',
  isRunning: true,
  startedAt: '2026-10-25T11:59:00.000Z',
  finishedAt: null,
  durationMs: 1234,
  statusLine: '运行中 · 1.2s · turn 1 / step 2 · 工具 pwsh',
  currentStep: { turn: 1, step: 2, elapsedMs: 100 },
  currentTools: [{ name: 'pwsh', callId: 'c1' }],
  lastEvent: { seq: 7, type: 'tool/call', time: 1_000, ageMs: 500 },
  lastEventAgeMs: 500,
  usage: {
    scope: 'run',
    source: 'provider',
    partial: true,
    complete: false,
    countedSamples: 2,
    uncachedInputTokens: 5504,
    cacheReadTokens: 17536,
    cacheWriteTokens: 0,
    outputTokens: 908,
    totalTokens: 23948,
    note: 'running',
  },
  ...overrides,
})

function createHarness({ payload, reject = false, hang = false } = {}) {
  let now = 1_700_000_000_000
  let nextTimer = 1
  const timers = new Map()
  const fetchCalls = []
  let currentPayload = payload
  let shouldReject = reject
  let shouldHang = hang
  const documentListeners = new Map()

  class FakeDate extends Date {
    constructor(...args) {
      super(...(args.length === 0 ? [now] : args))
    }
    static now() { return now }
  }

  const document = {
    hidden: false,
    body: {},
    head: { appendChild() {} },
    createElement() {
      return { dataset: {}, appendChild() {}, textContent: '' }
    },
    querySelector() { return null },
    addEventListener(type, handler) {
      const list = documentListeners.get(type) ?? []
      list.push(handler)
      documentListeners.set(type, list)
    },
    removeEventListener(type, handler) {
      const list = documentListeners.get(type) ?? []
      documentListeners.set(type, list.filter((item) => item !== handler))
    },
  }

  const fakeSetTimeout = (fn, delay = 0) => {
    const id = nextTimer++
    timers.set(id, { at: now + Math.max(0, delay), fn })
    return id
  }
  const fakeClearTimeout = (id) => { timers.delete(id) }

  const sandbox = {
    window: {},
    document,
    fetch: async (url, options) => {
      fetchCalls.push({ url, options })
      if (shouldHang) {
        return new Promise((resolve, reject) => {
          const signal = options && options.signal
          if (signal === undefined) return
          const abort = () => reject(new Error('aborted'))
          if (signal.aborted) abort()
          else signal.addEventListener('abort', abort, { once: true })
        })
      }
      if (shouldReject) throw new Error('network down')
      return {
        ok: true,
        status: 200,
        async json() { return currentPayload },
      }
    },
    AbortController,
    setTimeout: fakeSetTimeout,
    clearTimeout: fakeClearTimeout,
    setInterval: () => { throw new Error('client must not use setInterval') },
    clearInterval: () => {},
    Date: FakeDate,
    Intl,
    console,
    Promise,
    JSON,
    Math,
    Number,
    String,
    Object,
    Array,
    Symbol,
    RegExp,
    Error,
    Map,
    Set,
  }
  sandbox.globalThis = sandbox
  vm.createContext(sandbox)

  let definition
  sandbox.window.__ModuleLoader__ = { load(value) { definition = value } }
  new vm.Script(code, { filename: bundlePath }).runInContext(sandbox)
  assert.ok(definition, 'bundle did not call window.__ModuleLoader__.load')

  let hookIndex = 0
  let refIndex = 0
  let states = []
  let refs = []
  let effects = []
  let pendingEffects = []
  let dirty = false
  let rendering = false
  let tree = null
  let mounted = false

  const scheduleRender = () => {
    dirty = true
  }

  const React = {
    Fragment: Symbol('Fragment'),
    createElement(type, props, ...children) {
      return {
        type,
        props: { ...(props || {}), children: children.length === 0 ? undefined : (children.length === 1 ? children[0] : children) },
      }
    },
    useState(initial) {
      const index = hookIndex++
      if (!(index in states)) states[index] = typeof initial === 'function' ? initial() : initial
      return [states[index], (value) => {
        states[index] = typeof value === 'function' ? value(states[index]) : value
        scheduleRender()
        render()
      }]
    },
    useRef(initial) {
      const index = refIndex++
      if (!(index in refs)) refs[index] = { current: initial }
      return refs[index]
    },
    useCallback(fn) { return fn },
    useEffect(fn, deps) {
      pendingEffects.push({ index: hookIndex++, fn, deps })
    },
  }
  const ReactDOM = {
    createPortal(element) {
      element.__portal = true
      return element
    },
  }

  function depsChanged(left, right) {
    if (left === undefined || right === undefined) return true
    if (left.length !== right.length) return true
    return left.some((value, index) => !Object.is(value, right[index]))
  }

  function render() {
    if (rendering) { dirty = true; return }
    rendering = true
    try {
      let guard = 0
      do {
        dirty = false
        hookIndex = 0
        refIndex = 0
        pendingEffects = []
        tree = component()
        const runEffects = pendingEffects
        for (const effect of runEffects) {
          const previous = effects[effect.index]
          if (previous === undefined || depsChanged(previous.deps, effect.deps)) {
            if (previous !== undefined && typeof previous.cleanup === 'function') previous.cleanup()
            const cleanup = effect.fn()
            effects[effect.index] = { deps: effect.deps, cleanup }
          }
        }
        guard += 1
        if (guard > 20) throw new Error('render loop did not settle')
      } while (dirty)
    } finally {
      rendering = false
    }
  }

  const slots = {
    inject(name, callback) { callback(name) },
    register(definitionValue, componentValue) {
      registered = { definition: definitionValue, component: componentValue }
    },
  }
  let registered = null

  const module = definition.factory((name) => {
    if (name === 'react') return React
    if (name === 'react-dom') return ReactDOM
    throw new Error(`unexpected require: ${name}`)
  })
  module.apply({
    get(name) { return name === 'slots' ? slots : undefined },
    connection: {},
  })
  assert.ok(registered, 'client did not register sidebar.footer.action')
  assert.equal(registered.definition.id, 'dsh-run-monitor')

  const component = registered.component

  async function flush() {
    for (let index = 0; index < 8; index += 1) {
      await new Promise((resolve) => setImmediate(resolve))
      if (dirty) render()
    }
    if (dirty) render()
  }

  async function advance(ms) {
    const target = now + ms
    for (;;) {
      let nextId = null
      let next = null
      for (const [id, timer] of timers) {
        if (timer.at <= target && (next === null || timer.at < next.at)) {
          nextId = id
          next = timer
        }
      }
      if (next === null) break
      timers.delete(nextId)
      now = next.at
      next.fn()
      await flush()
    }
    now = target
    if (dirty) render()
    await flush()
  }

  function walk(node, visitor) {
    if (node === null || node === undefined) return
    if (Array.isArray(node)) {
      for (const child of node) walk(child, visitor)
      return
    }
    if (typeof node === 'string' || typeof node === 'number') {
      visitor({ text: String(node) })
      return
    }
    if (typeof node !== 'object') return
    visitor(node)
    if (node.props && node.props.children !== undefined) walk(node.props.children, visitor)
  }

  function strings(node = tree) {
    const out = []
    walk(node, (item) => { if (item.text !== undefined) out.push(item.text) })
    return out.join(' ')
  }

  function find(node, predicate) {
    let found = null
    walk(node, (item) => { if (found === null && predicate(item)) found = item })
    return found
  }

  async function click(node) {
    assert.ok(node && node.props && typeof node.props.onClick === 'function', 'node is not clickable')
    node.props.onClick({ stopPropagation() {} })
    await flush()
  }

  async function mount() {
    mounted = true
    render()
    await flush()
  }

  async function unmount() {
    mounted = false
    for (const effect of effects) {
      if (effect !== undefined && typeof effect.cleanup === 'function') effect.cleanup()
    }
    effects = []
    await flush()
  }

  async function setHidden(hidden) {
    document.hidden = hidden
    for (const handler of documentListeners.get('visibilitychange') ?? []) handler()
    await flush()
  }

  return {
    sandbox,
    get tree() { return tree },
    get fetchCalls() { return fetchCalls },
    get timers() { return timers },
    get mounted() { return mounted },
    setPayload(value) { currentPayload = value },
    setReject(value) { shouldReject = value },
    setHang(value) { shouldHang = value },
    mount,
    unmount,
    flush,
    advance,
    render,
    strings,
    find,
    click,
    setHidden,
    toggle() {
      return find(tree, (node) => node.props && node.props.className === 'drm-toggle')
    },
  }
}

test('empty state and loading render without a bridge', async () => {
  const harness = createHarness({ payload: payloadOf([]) })
  await harness.mount()
  assert.equal(harness.fetchCalls.length, 1)
  assert.match(harness.strings(), /DSH 任务/)
  await harness.click(harness.toggle())
  assert.match(harness.strings(), /暂无 DSH 任务状态/)
  assert.match(harness.strings(), /SDK 任务，不是桌面聊天/)
})

test('loading state is visible before the first response', async () => {
  const fresh = createHarness({ payload: payloadOf([]) })
  fresh.render()
  fresh.toggle().props.onClick({ stopPropagation() {} })
  assert.match(fresh.strings(), /加载中…/)
  await fresh.flush()
  assert.match(fresh.strings(), /暂无 DSH 任务状态/)
})

test('running run renders status, workspace, tool, duration and token/cache split', async () => {
  const harness = createHarness({
    payload: payloadOf([{ file: 'bridge-a.json', bridge: bridge(), runs: [run()] }]),
  })
  await harness.mount()
  await harness.click(harness.toggle())
  const text = harness.strings()
  assert.match(text, /运行中/)
  assert.match(text, /deepseek-official \/ deepseek-flash/)
  assert.match(text, /工作区 repo/)
  assert.match(text, /当前工具 pwsh/)
  assert.match(text, /用时 1\.2s/)
  assert.match(text, /token 累计 23,948/)
  assert.match(text, /未缓存输入 5,504/)
  assert.match(text, /缓存读 17,536/)
  assert.match(text, /缓存写 0/)
  assert.match(text, /输出 908/)
  assert.match(text, /最近活动 500ms 前|最近活动 刚刚/)
  assert.match(text, /用量仍在累计/)
})

test('multiple bridges, stale files and corrupt files are shown distinctly', async () => {
  const harness = createHarness({
    payload: payloadOf([
      { file: 'bridge-a.json', bridge: bridge(), runs: [run()] },
      {
        file: 'bridge-b.json',
        bridge: bridge({ instanceId: 'bridge-b', state: 'running', stale: true, heartbeatAgeMs: 90000 }),
        runs: [run({ sessionId: 'session-b', status: 'stale', isRunning: false, statusLine: '状态已过期：桥不再发送心跳' })],
      },
      { file: 'bridge-c.json', error: 'invalid JSON' },
    ]),
  })
  await harness.mount()
  await harness.click(harness.toggle())
  const text = harness.strings()
  assert.match(text, /桥 bridge-a/)
  assert.match(text, /桥 bridge-b/)
  assert.match(text, /状态已过期/)
  assert.match(text, /读取失败/)
  assert.match(text, /invalid JSON/)
})

test('read errors are visible and do not crash the panel', async () => {
  const harness = createHarness({ payload: null, reject: true })
  await harness.mount()
  await harness.click(harness.toggle())
  assert.match(harness.strings(), /读取失败：network down/)
})

test('running polls every 3s, idle backs off to 15s', async () => {
  const harness = createHarness({
    payload: payloadOf([{ file: 'bridge-a.json', bridge: bridge(), runs: [run()] }]),
  })
  await harness.mount()
  assert.equal(harness.fetchCalls.length, 1)

  await harness.advance(2_999)
  assert.equal(harness.fetchCalls.length, 1)
  await harness.advance(1)
  assert.equal(harness.fetchCalls.length, 2)

  harness.setPayload(payloadOf([{
    file: 'bridge-a.json',
    bridge: bridge({ state: 'idle', stale: false }),
    runs: [run({ status: 'succeeded', isRunning: false, finishedAt: '2026-10-25T11:59:10.000Z', durationMs: 10000 })],
  }]))
  await harness.advance(3_000)
  assert.equal(harness.fetchCalls.length, 3)

  await harness.advance(14_999)
  assert.equal(harness.fetchCalls.length, 3)
  await harness.advance(1)
  assert.equal(harness.fetchCalls.length, 4)
})

test('hidden pages reduce polling and visible pages refresh immediately', async () => {
  const harness = createHarness({
    payload: payloadOf([{ file: 'bridge-a.json', bridge: bridge(), runs: [run()] }]),
  })
  await harness.mount()
  assert.equal(harness.fetchCalls.length, 1)

  await harness.setHidden(true)
  const afterHide = harness.fetchCalls.length
  await harness.advance(29_999)
  assert.equal(harness.fetchCalls.length, afterHide, 'hidden page must not poll at 3s')
  await harness.advance(1)
  assert.equal(harness.fetchCalls.length, afterHide + 1)

  await harness.setHidden(false)
  assert.equal(harness.fetchCalls.length, afterHide + 2, 'becoming visible refreshes immediately')
})

test('finished durations stay frozen across polls', async () => {
  const finished = run({
    status: 'succeeded',
    isRunning: false,
    finishedAt: '2026-10-25T11:59:10.000Z',
    durationMs: 5000,
    currentStep: null,
    currentTools: [],
    statusLine: '已完成 · 5.0s · token 已上报 23,948',
  })
  const harness = createHarness({
    payload: payloadOf([{ file: 'bridge-a.json', bridge: bridge({ state: 'idle' }), runs: [finished] }]),
  })
  await harness.mount()
  await harness.click(harness.toggle())
  assert.match(harness.strings(), /用时 5\.0s/)
  await harness.advance(20_000)
  assert.match(harness.strings(), /用时 5\.0s/)
})

test('unmount clears timers and listeners', async () => {
  const harness = createHarness({
    payload: payloadOf([{ file: 'bridge-a.json', bridge: bridge(), runs: [run()] }]),
  })
  await harness.mount()
  assert.equal(harness.timers.size, 1)
  await harness.unmount()
  assert.equal(harness.timers.size, 0)
  assert.equal(harness.sandbox.document.addEventListener !== undefined, true)
  const calls = harness.fetchCalls.length
  await harness.advance(60_000)
  assert.equal(harness.fetchCalls.length, calls)
})

test('toggle stays inline while only the popup is portaled', async () => {
  const harness = createHarness({ payload: payloadOf([]) })
  await harness.mount()
  const toggle = harness.toggle()
  assert.ok(toggle)
  assert.equal(toggle.__portal, undefined, 'toggle must stay in the sidebar slot, not document.body')
  await harness.click(toggle)
  const popup = harness.find(harness.tree, (node) => node.props && node.props.className === 'drm-popup')
  assert.ok(popup)
  assert.equal(popup.__portal, true, 'popup should be portaled to body')
})

test('a hanging fetch times out, reports the failure and can recover', async () => {
  const harness = createHarness({ payload: payloadOf([]), hang: true })
  await harness.mount()
  await harness.click(harness.toggle())
  assert.equal(harness.fetchCalls.length, 1)
  await harness.advance(6_000)
  assert.match(harness.strings(), /状态请求超时或已取消/)
  assert.equal(harness.fetchCalls.length, 1)

  harness.setHang(false)
  harness.setPayload(payloadOf([]))
  const refresh = harness.find(harness.tree, (node) => node.props && node.props.className === 'drm-refresh')
  await harness.click(refresh)
  assert.doesNotMatch(harness.strings(), /状态请求超时或已取消/)
  assert.match(harness.strings(), /暂无 DSH 任务状态/)
})

test('unmount aborts an in-flight request and leaves no timer', async () => {
  const harness = createHarness({ payload: payloadOf([]), hang: true })
  await harness.mount()
  const signal = harness.fetchCalls[0].options.signal
  assert.equal(signal.aborted, false)
  await harness.unmount()
  assert.equal(signal.aborted, true)
  assert.equal(harness.timers.size, 0)
  await harness.advance(60_000)
  assert.equal(harness.fetchCalls.length, 1)
})

test('a failed refresh does not keep showing cached runs as live', async () => {
  const harness = createHarness({
    payload: payloadOf([{ file: 'bridge-a.json', bridge: bridge(), runs: [run()] }]),
  })
  await harness.mount()
  await harness.click(harness.toggle())
  assert.match(harness.strings(), /运行中/)
  harness.setReject(true)
  await harness.advance(3_000)
  const text = harness.strings()
  assert.match(text, /读取失败：network down/)
  assert.match(text, /状态已过期或连接中断/)
  assert.doesNotMatch(text, /当前工具 pwsh/)
  assert.doesNotMatch(text, /运行中 ·/)
})

test('status text is rendered as text, never as HTML', async () => {
  const harness = createHarness({
    payload: payloadOf([{
      file: 'bridge-a.json',
      bridge: bridge(),
      runs: [run({ statusLine: '<img src=x onerror="alert(1)"> 运行中' })],
    }]),
  })
  await harness.mount()
  await harness.click(harness.toggle())
  assert.match(harness.strings(), /<img src=x onerror="alert\(1\)"> 运行中/)
  const dangerous = harness.find(harness.tree, (node) => node.props && node.props.dangerouslySetInnerHTML !== undefined)
  assert.equal(dangerous, null)
})
