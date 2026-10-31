import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import vm from 'node:vm'
import test from 'node:test'

const source = await readFile(new URL('../lib/client.js', import.meta.url), 'utf8')

// Exercise the registered view through its public controls without a browser
// dependency. Effects, fetch and timers stay controllable for outage scenarios.
async function mount(files, props = {}, extra = {}, controls = {}) {
  const state=[],refs=[],effects=[],timers=new Map()
  let si=0,ri=0,ei=0,nextTimer=0,fail=false,component,plugin
  const requests=[]
  const React={
    createElement:(type,props,...children)=>({type,props:props||{},children:children.flat(Infinity).filter(x=>x!==null&&x!==undefined&&x!==false)}),
    useState(initial){const i=si++;if(!(i in state))state[i]=initial;return[state[i],value=>{state[i]=typeof value==='function'?value(state[i]):value}]},
    useRef(initial){const i=ri++;return refs[i]||={current:initial}},
    useEffect(effect,deps){const i=ei++;const previous=effects[i];if(!previous||!deps||deps.some((d,j)=>!Object.is(d,previous.deps?.[j]))){effects[i]={deps,effect,pending:true,cleanup:previous?.cleanup}}},
  }
  const document={hidden:false,querySelector:()=>({}),addEventListener(){},removeEventListener(){}}
  vm.runInNewContext(source,{
    window:{__ModuleLoader__:{load({factory}){plugin=factory(name=>name==='@deepseek-ai/dsh-client-ui-primitives'?(controls.primitives||{}):React)}}},document,
    fetch:async(_,init)=>{const body=JSON.parse(init.body);requests.push(body);if(controls.fetch)return controls.fetch(body,init);return{ok:!fail,status:fail?503:200,json:async()=>body.method==='transcript'?{ok:true,value:{entries:[],hasOlder:false,beforeSeq:null,lastSeq:null,...controls.transcript}}:{ok:true,value:{files,...extra}}}},
    AbortController,setTimeout(fn,ms){const id=++nextTimer;timers.set(id,{fn,ms});return id},clearTimeout:id=>timers.delete(id),
  })
  plugin.apply({get:()=>({inject:(_,setup)=>setup(),register(options,view){assert.equal(options.name,'conversation.view');component=view}})})
  const render=()=>{si=0;ri=0;ei=0;const tree=component(props);for(const e of effects){if(e.pending){e.pending=false;e.cleanup?.();e.cleanup=e.effect()}}return tree}
  render();await new Promise(resolve=>setImmediate(resolve))
  return{render,timers,document,requests,fail:()=>{fail=true},flush:()=>new Promise(resolve=>setImmediate(resolve)),cleanup:()=>{for(const e of effects)e.cleanup?.()}}
}
function nodes(node) { return !node || typeof node !== 'object' ? [] : [node, ...node.children.flatMap(nodes)] }
function text(node) { return typeof node === 'string' || typeof node === 'number' ? String(node) : node?.children?.map(text).join(' ') || '' }
function find(tree, predicate) { const node = nodes(tree).find(predicate); assert.ok(node, 'expected UI control'); return node }
function cards(tree) { return nodes(tree).filter(n => n.props.className === 'drm-card') }
function clickText(tree, label) { find(tree, n => n.type === 'button' && text(n).startsWith(label)).props.onClick() }
const run = (sessionId, overrides = {}) => ({ sessionId, cwd: 'D:/work/frontend', provider: 'deepseek-official', model: 'flash', status: 'running', isRunning: true, startedAt: '2026-10-30T06:00:00Z', durationMs: 12345, currentTools: [{ name: 'pwsh' }], currentStep: { turn: 1, step: 3 }, contextWindow: 1000000, usage: { totalTokens: 1200, partial: true }, ...overrides })
const file = (id, runs, overrides = {}) => ({ file: id + '.json', bridge: { instanceId: id, state: 'running', stale: false, ...overrides }, runs })

test('overview hides idle bridges and history; cards expose real progress and window, without invented occupancy', async () => {
  const app = await mount([file('a', [run('session-live')]), file('idle', [], { state: 'idle' }), file('old', [run('session-done', { status: 'succeeded', isRunning: false, cwd: 'D:/old/archived' })], { state: 'stopped' })])
  const tree = app.render()
  assert.equal(cards(tree).length, 1)
  assert.match(text(cards(tree)[0]), /Step 3/)
  assert.match(text(cards(tree)[0]), /占用量未上报/)
  assert.doesNotMatch(text(tree), /archived/)
  assert.ok([...app.timers.values()].some(t => t.ms === 3000))
  clickText(tree, '已结束')
  assert.equal(cards(app.render()).length, 1)
  assert.match(text(cards(app.render())[0]), /archived/)
  app.cleanup()
  assert.equal(app.timers.size, 0)
})

test('search and model controls filter cards and displayed usage together', async () => {
  const app = await mount([file('a', [run('session-a'), run('session-b', { model: 'pro', cwd: 'D:/work/backend', usage: { totalTokens: 5000, final: true, complete: true } })])])
  let tree = app.render()
  find(tree, n => n.props['aria-label'] === '搜索任务').props.onChange({ target: { value: 'BACKEND' } })
  tree = app.render()
  assert.equal(cards(tree).length, 1)
  assert.match(text(find(tree, n => n.props['aria-label'] === '任务统计')), /5\.0k/)
  find(tree, n => n.props['aria-label'] === '筛选模型').props.onChange({ target: { value: 'flash' } })
  assert.equal(cards(app.render()).length, 0)
  clickText(app.render(), '清除筛选')
  assert.equal(cards(app.render()).length, 2)
  app.cleanup()
})

test('same session id opens the correct full-page transcript and blocks input until returning', async () => {
  let blocked=0,released=0
  const app=await mount([file('one',[run('session-same')]),file('two',[run('session-same',{cwd:'D:/work/backend'})])],{blockComposer:()=>{blocked++;return()=>released++}})
  cards(app.render())[1].props.onClick()
  let tree=app.render()
  assert.equal(cards(tree).length,0)
  assert.equal(blocked,1)
  await app.flush()
  assert.equal(app.requests.find(r=>r.method==='transcript').bridgeInstanceId,'two')
  clickText(app.render(),'运行信息')
  tree=app.render()
  assert.match(text(find(tree,n=>n.props['aria-label']==='任务会话详情')),/two/)
  assert.equal(nodes(tree).some(n=>['input','textarea'].includes(n.type)),false)
  find(tree,n=>n.props['aria-label']==='返回任务概览').props.onClick()
  tree=app.render()
  assert.equal(released,1)
  assert.equal(cards(tree).length,2)
  app.cleanup()
})
test('outage removes cached tasks from live count and suppresses old current-tool claims', async () => {
  const app = await mount([file('a', [run('session-a')])])
  app.fail()
  find(app.render(), n => n.props['aria-label'] === '刷新任务状态').props.onClick()
  await app.flush()
  assert.equal(cards(app.render()).length, 0)
  assert.match(text(app.render()), /读取失败/)
  clickText(app.render(), '异常任务')
  assert.equal(cards(app.render()).length, 1)
  assert.doesNotMatch(text(cards(app.render())[0]), /pwsh/)
  assert.match(text(cards(app.render())[0]), /缓存快照/)
  assert.ok([...app.timers.values()].some(t => t.ms === 15000))
  app.cleanup()
})

test('queued, stale, corrupt and unknown-usage states remain inspectable without becoming live work', async () => {
  const app = await mount([file('a', [run('session-q', { status: 'queued', usage: null })]), file('b', [run('session-stale')], { stale: true }), { file: 'broken.json', error: 'invalid JSON' }])
  const tree = app.render()
  assert.equal(cards(tree).length, 1)
  assert.match(text(cards(tree)[0]), /排队中/)
  assert.match(text(cards(tree)[0]), /未上报/)
  assert.match(text(tree), /1 个桥状态文件读取失败/)
  clickText(tree, '异常任务')
  assert.equal(cards(app.render()).length, 1)
  assert.match(text(cards(app.render())[0]), /连接中断/)
  app.cleanup()
})

test('large history loads in batches and changing filters closes the previous detail', async () => {
  const app = await mount([file('a', Array.from({ length: 65 }, (_, i) => run('session-' + i, { status: 'succeeded', isRunning: false })))])
  clickText(app.render(), '已结束')
  assert.equal(cards(app.render()).length, 30)
  clickText(app.render(), '加载更多')
  assert.equal(cards(app.render()).length, 60)
  cards(app.render())[0].props.onClick()
  assert.equal(nodes(app.render()).some(n => n.props['aria-label'] === '任务会话详情'), true)
  find(app.render(), n => n.props['aria-label'] === '返回任务概览').props.onClick()
  find(app.render(), n => n.props['aria-label'] === '搜索任务').props.onChange({ target: { value: 'session-64' } })
  assert.equal(cards(app.render()).length, 1)
  assert.equal(nodes(app.render()).some(n => n.props['aria-label'] === '任务会话详情'), false)
  app.cleanup()
})

test('plain labels separate running, abnormal and ended work; empty connections stay collapsed', async () => {
  const app = await mount([file('busy', [run('session-now')]), ...Array.from({ length: 40 }, (_, i) => file('idle-' + i, [], { state: 'idle' }))])
  const tree = app.render()
  const views = find(tree, n => n.props['aria-label'] === '任务视图')
  assert.match(text(views), /进行中/)
  assert.match(text(views), /异常任务/)
  assert.match(text(views), /已结束/)
  assert.doesNotMatch(text(views), /活跃|需关注/)
  assert.equal(nodes(tree).some(n => n.props['aria-label'] === '桥连接信息'), false)
  find(tree, n => n.props['aria-label'] === '打开连接管理').props.onClick()
  const connections = find(app.render(), n => n.props['aria-label'] === '桥连接信息')
  assert.equal(cards(app.render()).length, 0, 'connection management is a separate page')
  const toggle = find(connections, n => n.props['aria-label'] === '查看空闲连接')
  assert.equal(toggle.props['aria-expanded'], false)
  assert.match(text(toggle), /40/)
  assert.equal(nodes(connections).some(n => n.props['aria-label'] === '空闲桥'), false)
  assert.equal(cards(tree).length, 1)
  find(app.render(), n => n.props['aria-label'] === '返回任务概览').props.onClick()
  assert.equal(cards(app.render()).length, 1)
  app.cleanup()
})

test('archived tasks remain in ended work without inflating abnormal counts or current connections', async () => {
  const archive = { ...file('archive-old', [run('session-old', { status: 'stale', isRunning: false })]), archived: true }
  const app = await mount([file('current', [run('session-now')])], {}, { archivedFiles: [archive], archiveSummary: { files: 63, runs: 1 } })
  let tree = app.render()
  assert.equal(cards(tree).length, 1)
  find(tree, n => n.props['aria-label'] === '打开连接管理').props.onClick()
  tree = app.render()
  assert.doesNotMatch(text(find(tree, n => n.props['aria-label'] === '桥连接信息')), /archive-old/)
  assert.match(text(find(tree, n => n.props['aria-label'] === '桥连接信息')), /已归档 63/)
  find(tree, n => n.props['aria-label'] === '返回任务概览').props.onClick()
  clickText(app.render(), '异常任务')
  assert.equal(cards(app.render()).length, 0)
  clickText(app.render(), '已结束')
  tree = app.render()
  assert.equal(cards(tree).length, 1)
  assert.match(text(cards(tree)[0]), /已归档/)
  cards(tree)[0].props.onClick()
  clickText(app.render(), '运行信息')
  assert.match(text(find(app.render(), n => n.props['aria-label'] === '任务会话详情')), /session-old/)
  app.cleanup()
})

test('connection page navigation preserves the task filter and selected task', async () => {
  const app = await mount([file('a', [run('session-a'), run('session-b', { cwd: 'D:/work/backend' })])])
  find(app.render(), n => n.props['aria-label'] === '搜索任务').props.onChange({ target: { value: 'backend' } })
  cards(app.render())[0].props.onClick()
  find(app.render(), n => n.props['aria-label'] === '返回任务概览').props.onClick()
  find(app.render(), n => n.props['aria-label'] === '打开连接管理').props.onClick()
  assert.equal(nodes(app.render()).some(n => n.props['aria-label'] === '搜索任务'), false)
  assert.equal(nodes(app.render()).some(n => n.props['aria-label'] === '任务会话详情'), false)
  find(app.render(), n => n.props['aria-label'] === '返回任务概览').props.onClick()
  assert.equal(find(app.render(), n => n.props['aria-label'] === '搜索任务').props.value, 'backend')
  assert.equal(cards(app.render()).length, 1)
  assert.equal(cards(app.render())[0].props['aria-pressed'], true)
  app.cleanup()
})

test('transcript pagination and refresh preserve older records and update the same tool entry', async () => {
  let refreshed=false
  const files=[file('a',[run('session-a',{title:'实现只读会话详情页'})])]
  const app=await mount(files,{}, {},{fetch:async body=>({ok:true,status:200,json:async()=>body.method==='state'?{ok:true,value:{files}}:{ok:true,value:body.beforeSeq!==undefined?{entries:[{id:'u',seq:1,time:100,kind:'user',text:'检查功能'}],hasOlder:false,beforeSeq:null,lastSeq:5}:{entries:[{id:'t',seq:3,time:200,kind:'tool',toolName:'pwsh',status:refreshed?'ok':'pending',result:refreshed?'61 passed':undefined},{id:'a',seq:5,time:300,kind:'assistant',text:'**检查完成**'}],hasOlder:true,beforeSeq:3,lastSeq:5}}})})
  assert.match(text(cards(app.render())[0]),/实现只读会话详情页/)
  cards(app.render())[0].props.onClick();app.render();await app.flush()
  clickText(app.render(),'加载更早的记录');await app.flush()
  assert.match(text(app.render()),/检查功能/)
  refreshed=true;find(app.render(),n=>n.props['aria-label']==='刷新会话记录').props.onClick();await app.flush()
  const tree=app.render()
  assert.match(text(tree),/61 passed/)
  assert.match(text(tree),/检查功能/)
  assert.equal(nodes(tree).filter(n=>n.props.className==='drm-tool-entry').length,1)
  assert.equal(nodes(tree).some(n=>['input','textarea'].includes(n.type)),false)
  app.cleanup()
})

test('a late transcript response cannot replace the newly opened session', async () => {
  let finishFirst
  const files=[file('a',[run('session-a'),run('session-b',{cwd:'D:/work/backend'})])]
  const app=await mount(files,{}, {},{fetch:async body=>{
    if(body.method==='state')return{ok:true,json:async()=>({ok:true,value:{files}})}
    if(body.sessionId==='session-a')return new Promise(resolve=>{finishFirst=()=>resolve({ok:true,json:async()=>({ok:true,value:{entries:[{id:'old',seq:1,kind:'assistant',text:'OLD_SESSION'}]}})})})
    return{ok:true,json:async()=>({ok:true,value:{entries:[{id:'new',seq:1,kind:'assistant',text:'NEW_SESSION'}],hasOlder:false}})}
  }})
  cards(app.render())[0].props.onClick();app.render();await app.flush()
  find(app.render(),n=>n.props['aria-label']==='返回任务概览').props.onClick();app.render()
  cards(app.render())[1].props.onClick();app.render();await app.flush()
  finishFirst();await app.flush()
  assert.match(text(app.render()),/NEW_SESSION/)
  assert.doesNotMatch(text(app.render()),/OLD_SESSION/)
  app.cleanup()
})

test('native Markdown receives the labels required by Desktop 0.2 for code fences and footnotes', async () => {
  const MarkdownText=()=>null
  const message='```js\nconsole.log(1)\n```\n\n说明[^1]\n\n[^1]: 参考'
  const app=await mount([file('a',[run('session-history',{status:'succeeded',isRunning:false})])],{}, {},{
    primitives:{MarkdownText}, transcript:{entries:[{id:'answer',seq:1,kind:'assistant',text:message}]}
  })
  clickText(app.render(),'已结束')
  cards(app.render())[0].props.onClick();app.render();await app.flush()
  const native=find(app.render(),node=>node.type===MarkdownText)
  assert.equal(native.props.text,message)
  const labels=native.props.labels
  assert.equal(typeof labels.code.copyLabel,'string')
  assert.equal(typeof labels.code.copiedLabel,'string')
  for(const key of ['codeLabel','wrapLabel','unwrapLabel'])assert.equal(typeof labels.code.toolbarLabels[key],'string')
  assert.equal(typeof labels.footnotes,'string')
  assert.equal(native.props.codeLabels,labels.code)
  app.cleanup()
})

test('native composer blocking preserves blocks owned by other plugins', () => {
  let plugin,registration,current
  const blocks={storeFor:()=>({getSnapshot:()=>current}),set:(_,value)=>{current=value}}
  vm.runInNewContext(source,{window:{__ModuleLoader__:{load({factory}){plugin=factory(()=>({createElement(){}}))}}},document:{querySelector:()=>({})}})
  const slots={inject:(_,fn)=>fn(),register:(options)=>{registration=options}}
  plugin.apply({get:name=>name==='slots'?slots:{blocks}})
  const api=registration.inject('outer-session')
  const clear=api.blockComposer()
  assert.match(current.reason,/只读/)
  const another={reason:'another plugin'};current=another
  clear()
  assert.equal(current,another)
  assert.equal(api.blockComposer(),undefined)
  current=undefined
  const release=api.blockComposer();release()
  assert.equal(current,undefined)
})
