import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const SOURCE=readFileSync(new URL('../lib/client.js',import.meta.url),'utf8');
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};};
const version=(id='snap-1')=>({id,capturedAt:'2026-11-14T00:00:00Z',hash:'abc',entries:2});
const link=(id='link-1',snapshotId='snap-1')=>({id,source:{sessionId:'codex:source',kind:'codex',title:'Source project',cwd:'/other/workspace'},snapshot:version(snapshotId),versions:[version(snapshotId),version('old-1')]});
const listing=(links=[link()])=>({ok:true,bound:!!links.length,available:true,links});
const page=(id='snap-1',start=0,nextStart=null)=>({ok:true,page:{id,items:[{index:start,type:'user/message',text:`Evidence ${id} ${start}`}],total:2,nextStart}});
const text=n=>typeof n==='string'?n:typeof n==='number'?String(n):Array.isArray(n)?n.map(text).join(''):n&&typeof n==='object'?(n.children||[]).map(text).join(''):'';
const find=(n,p,out=[])=>{if(Array.isArray(n))n.forEach(c=>find(c,p,out));else if(n&&typeof n==='object'){if(p(n))out.push(n);(n.children||[]).forEach(c=>find(c,p,out));}return out;};
function load(lang='zh'){
  let module;globalThis.window={__ModuleLoader__:{load:value=>{module=value;}}};
  // Interface preference mounting is unrelated to this tab and stays off.
  globalThis.fetch=async()=>({ok:true,status:200,json:async()=>({settings:{}})});
  new Function(SOURCE)();
  let states=[],refs=[],effects=[],memos=[],si=0,ri=0,ei=0,mi=0,pending=[];
  const React={createElement:(type,props,...children)=>({type,props:props||{},children}),Fragment:'Fragment',useCallback:fn=>fn,
    useState:init=>{const i=si++;if(!(i in states))states[i]=typeof init==='function'?init():init;return [states[i],value=>{states[i]=typeof value==='function'?value(states[i]):value;}];},
    useRef:value=>refs[ri++]??={current:value},
    useMemo:(fn,deps)=>{const i=mi++,old=memos[i];if(!old||deps.some((x,j)=>x!==old.deps[j]))memos[i]={deps,value:fn()};return memos[i].value;},
    useEffect:(fn,deps)=>{const i=ei++,old=effects[i];if(!old||!deps||deps.some((x,j)=>x!==old.deps[j]))pending.push(()=>{old?.cleanup?.();effects[i]={deps,cleanup:fn()};});},
  };
  const api=module.factory(name=>{assert.equal(name,'react');return React;});
  const tables={},registrations=[],bindings=new Map([['session-a',{id:'session-a'}],['session-b',{id:'session-b'}]]);
  let activeLang=lang;
  const t=key=>tables[activeLang]?.[key]??key;
  api.apply({locale:{bind:()=>t,register:(_ns,locale,table)=>{tables[locale]=table;return()=>{};},subscribe:()=>()=>{}},effect:fn=>fn(),
    get:name=>name==='sessions'?{binding:id=>bindings.get(id)}:undefined,
    slots:{inject:(_name,fn)=>fn(),register:(options,component)=>{registrations.push({options,component});return()=>{};}},
  });
  const workbench=registrations.find(row=>row.options.name==='focusing.panel.body').component;
  const entry=registrations.find(row=>row.options.name==='conversation.view');
  const render=(sessionId='session-a',binding=bindings.get(sessionId))=>{si=0;ri=0;ei=0;mi=0;pending=[];const tree=workbench.linkedSnapshots.Panel({sessionId,binding,t,subscribeLocale:undefined});for(const run of pending)run();return tree;};
  const unmount=()=>effects.forEach(effect=>effect?.cleanup?.());
  return {entry,registrations,t,render,unmount,bindings,create:workbench.linkedSnapshots.createController,setLocale:value=>{activeLang=value;}};
}
const tick=()=>new Promise(resolve=>setImmediate(resolve));

test('adds a native session-scoped view without replacing the header; label follows zh/en',()=>{
  const env=load();
  assert.equal(env.entry.options.name,'conversation.view');assert.equal(env.entry.options.id,'focusing-linked-snapshots');assert.equal(env.entry.options.order,20);
  assert.equal(env.entry.options.label(),'链接快照');env.setLocale('en');assert.equal(env.entry.options.label(),'Linked snapshots');
  const a=env.entry.options.inject('session-a'),b=env.entry.options.inject('session-b');
  assert.equal(a.sessionId,'session-a');assert.equal(a.binding,env.bindings.get('session-a'));assert.notEqual(a.binding,b.binding);
  assert.equal(env.registrations.some(row=>['conversation.header','conversation.session.header'].includes(row.options.name)),false);
  const node=env.entry.component(a);assert.equal(node.props.key,'session-a');
});

test('all operations carry the owning session, mutations carry concurrency ids, and no composer is used',async()=>{
  const env=load(),calls=[];
  const controller=env.create('session-a',env.t,async(action,sessionId,args)=>{calls.push({action,sessionId,args});return action==='sources'?{ok:true,items:[]}:action==='preview'?page(args.snapshotId):listing();});
  await controller.load();await controller.openSources();await controller.add('claude:other');await controller.update(link());await controller.preview('link-1','old-1');
  assert.deepEqual(calls.map(x=>x.action),['list','sources','add','update','preview']);assert.ok(calls.every(x=>x.sessionId==='session-a'));
  assert.deepEqual(calls[2].args,{sourceSessionId:'claude:other'});assert.deepEqual(calls[3].args,{linkId:'link-1',expectedSnapshotId:'snap-1'});
  assert.deepEqual(calls[4].args,{linkId:'link-1',snapshotId:'old-1',start:0,limit:6});controller.dispose();
});

test('duplicate add/update clicks are synchronously guarded while a mutation is pending',async()=>{
  const env=load(),wait=deferred(),calls=[];
  const c=env.create('session-a',env.t,async(action)=>{calls.push(action);return action==='list'?listing():wait.promise;});await c.load();
  const first=c.add('other');await c.add('other');await c.update(link());await c.load();assert.deepEqual(calls,['list','add']);assert.equal(c.getSnapshot().pending,'add');
  wait.resolve(listing([link('new')]));await first;assert.equal(c.getSnapshot().pending,null);assert.equal(c.getSnapshot().links[0].id,'new');c.dispose();
});

test('conflict reloads latest version with an in-place notice and keeps mutation guard during reload',async()=>{
  const env=load(),reload=deferred();let reads=0;const calls=[];
  const c=env.create('s',env.t,async(action)=>{calls.push(action);if(action==='list')return ++reads===1?listing():reload.promise;throw Object.assign(new Error('changed'),{status:409,reason:'snapshot-conflict'});});
  await c.load();const updating=c.update(link());await tick();assert.match(c.getSnapshot().notice,/重新加载/);assert.equal(c.getSnapshot().pending,'link-1');await c.add('other');
  reload.resolve(listing([link('link-1','snap-2')]));await updating;assert.deepEqual(calls,['list','update','list']);assert.equal(c.getSnapshot().links[0].snapshot.id,'snap-2');assert.equal(c.getSnapshot().pending,null);c.dispose();
});

test('errors stay in list, source picker, row, and preview locations and can be retried',async()=>{
  const env=load();let failing=true;
  const c=env.create('s',env.t,async(action,_session,args)=>{if(failing)throw new Error(`${action} unavailable`);return action==='sources'?{ok:true,items:[]}:action==='preview'?page(args.snapshotId):listing();});
  await c.load();assert.match(c.getSnapshot().error,/list unavailable/);failing=false;await c.load();assert.equal(c.getSnapshot().error,'');
  failing=true;await c.openSources();assert.match(c.getSnapshot().sourceError,/sources unavailable/);await c.add('x');assert.match(c.getSnapshot().sourceError,/add unavailable/);
  await c.update(link());assert.match(c.getSnapshot().rowErrors['link-1'],/update unavailable/);assert.equal(c.getSnapshot().links.length,1);
  await c.preview('link-1','snap-1');assert.match(c.getSnapshot().preview.error,/preview unavailable/);assert.equal(c.getSnapshot().pending,null);c.dispose();
});

test('late session A results cannot affect a disposed view or session B, even when fetch ignores abort',async()=>{
  const env=load(),aWait=deferred(),signals=[];let aChanges=0;
  const a=env.create('a',env.t,async(_action,_id,_args,signal)=>{signals.push(signal);return aWait.promise;});a.subscribe(()=>aChanges++);
  const aRead=a.load();a.dispose();const changes=aChanges;
  const b=env.create('b',env.t,async()=>listing([link('b-link')]));await b.load();aWait.resolve(listing([link('a-link')]));await aRead;
  assert.equal(signals[0].aborted,true);assert.equal(aChanges,changes);assert.deepEqual(a.getSnapshot().links,[]);assert.equal(b.getSnapshot().links[0].id,'b-link');b.dispose();
});

test('late mutations and sources are ignored after unmount',async()=>{
  const env=load();
  for(const action of ['add','sources']){
    const wait=deferred();const c=env.create('s',env.t,async(type)=>type==='list'?listing():wait.promise);await c.load();
    const operation=action==='add'?c.add('other'):c.openSources();c.dispose();const before=c.getSnapshot();wait.resolve(action==='add'?listing([link('late')]):{ok:true,items:[{id:'late'}]});await operation;assert.equal(c.getSnapshot(),before);
  }
});

test('a newer list response wins over a delayed older one',async()=>{
  const env=load(),first=deferred();let reads=0;
  const c=env.create('s',env.t,async()=>++reads===1?first.promise:listing([link('new')]));const old=c.load();await c.load();first.resolve(listing([link('old')]));await old;assert.equal(c.getSnapshot().links[0].id,'new');c.dispose();
});

test('version changes discard old preview responses; pagination is pinned and duplicate loads are guarded',async()=>{
  const env=load(),old=deferred(),more=deferred(),calls=[];
  const c=env.create('s',env.t,async(action,_id,args)=>{calls.push({action,...args});if(args.snapshotId==='old-1')return old.promise;if(args.start)return more.promise;return page('snap-1',0,1);});
  const obsolete=c.preview('link-1','old-1');await c.preview('link-1','snap-1');old.resolve(page('old-1'));await obsolete;
  assert.equal(c.getSnapshot().preview.snapshotId,'snap-1');assert.match(c.getSnapshot().preview.items[0].text,/snap-1/);
  const next=c.preview('link-1','snap-1',true);await c.preview('link-1','snap-1',true);more.resolve(page('snap-1',1,null));await next;
  assert.equal(calls.length,3);assert.equal(calls[2].snapshotId,'snap-1');assert.equal(calls[2].start,1);assert.deepEqual(c.getSnapshot().preview.items.map(x=>x.index),[0,1]);c.dispose();
});

test('closing preview or picker prevents delayed responses from reopening them',async()=>{
  const env=load(),previewWait=deferred(),sourceWait=deferred();
  const c=env.create('s',env.t,async(action)=>action==='preview'?previewWait.promise:sourceWait.promise);
  const previewing=c.preview('link-1','snap-1'),opening=c.openSources();c.closePreview();c.closeSources();previewWait.resolve(page());sourceWait.resolve({ok:true,items:[{id:'late'}]});await Promise.all([previewing,opening]);
  assert.equal(c.getSnapshot().preview,null);assert.equal(c.getSnapshot().sourceOpen,false);assert.deepEqual(c.getSnapshot().sources,[]);c.dispose();
});

test('invalid lists and mismatched snapshot pages show errors rather than incorrect data',async()=>{
  const env=load();const c=env.create('s',env.t,async action=>action==='list'?{ok:true}:page('wrong-snapshot'));
  await c.load();assert.match(c.getSnapshot().error,/无效/);await c.preview('link','expected');assert.match(c.getSnapshot().preview.error,/无效/);assert.deepEqual(c.getSnapshot().preview.items,[]);c.dispose();
});

test('native view renders cwd, versions and searchable sources, and makes only the contracted POSTs',async()=>{
  const env=load(),calls=[];await tick();
  globalThis.fetch=async(url,options)=>{const body=JSON.parse(options.body);calls.push({url,options,body});return {ok:true,status:200,json:async()=>body.action==='sources'?{ok:true,items:[{id:'codex:source',title:'Source project',source:'codex',cwd:'/other/workspace'},{id:'claude:second',title:'Other project',source:'claude',cwd:'/second/workspace'}]}:listing()};};
  env.render();await tick();let tree=env.render();assert.match(text(tree),/\/other\/workspace/);assert.match(text(tree),/2 个版本/);
  await find(tree,n=>n.type==='button'&&text(n)==='添加来源')[0].props.onClick();tree=env.render();
  assert.equal(find(tree,n=>n.props.className==='fl-source').length,2);
  find(tree,n=>n.type==='input')[0].props.onChange({target:{value:'/second'}});tree=env.render();const rows=find(tree,n=>n.props.className==='fl-source');assert.equal(rows.length,1);assert.match(text(rows[0]),/Other project/);
  await find(rows[0],n=>n.type==='button')[0].props.onClick();env.render();
  assert.ok(calls.every(call=>call.url==='/api/dsh-focusing.history-advisor'&&call.options.method==='POST'&&call.body.sessionId==='session-a'));
  assert.deepEqual(calls.map(call=>call.body.action),['list','sources','add']);assert.equal(calls[2].body.sourceSessionId,'claude:second');env.unmount();
});

test('render switches session synchronously without flashing old content and aborts old bindings',async()=>{
  const env=load(),aWait=deferred(),calls=[];await tick();
  globalThis.fetch=async(_url,options)=>{const body=JSON.parse(options.body);calls.push({body,signal:options.signal});return {ok:true,status:200,json:async()=>body.sessionId==='session-a'?aWait.promise:listing([link('only-b')])};};
  env.render('session-a');const switched=env.render('session-b');assert.doesNotMatch(text(switched),/Source project/);await tick();let tree=env.render('session-b');assert.match(text(tree),/Source project/);
  aWait.resolve(listing([link('only-a')]));await tick();tree=env.render('session-b');assert.equal(find(tree,n=>n.type==='article')[0].props.key,'only-b');assert.equal(calls[0].signal.aborted,true);env.unmount();
});

test('empty state and English locale explain on-demand history without sending prompts',async()=>{
  const env=load('en');await tick();globalThis.fetch=async()=>({ok:true,status:200,json:async()=>listing([])});env.render();await tick();const tree=env.render();
  assert.match(text(tree),/No sources linked yet/);assert.match(text(tree),/on demand/);assert.match(text(tree),/does not change this working directory/);assert.equal(find(tree,n=>n.type==='textarea').length,0);env.unmount();
});

test('effect remount invalidates prior mutations even when their responses ignore cancellation',async()=>{
  const env=load(),wait=deferred();let mutated=false;
  const c=env.create('s',env.t,async action=>action==='add'?wait.promise:listing([link(mutated?'remounted':'initial')]));
  await c.load();const old=c.add('other');c.dispose();c.activate();mutated=true;await c.load();wait.resolve(listing([link('late-mutation')]));await old;
  assert.equal(c.getSnapshot().links[0].id,'remounted');assert.equal(c.getSnapshot().pending,null);c.dispose();
});

test('replacing the same session binding clears its old data before new results arrive',async()=>{
  const env=load(),wait=deferred();await tick();let reads=0;
  globalThis.fetch=async()=>({ok:true,status:200,json:async()=>++reads===1?listing([link('old-binding')]):wait.promise});
  env.render();await tick();assert.match(text(env.render()),/Source project/);
  const replacement={id:'session-a',generation:2};const switched=env.render('session-a',replacement);assert.doesNotMatch(text(switched),/Source project/);
  wait.resolve(listing([link('new-binding')]));await tick();const tree=env.render('session-a',replacement);assert.equal(find(tree,n=>n.type==='article')[0].props.key,'new-binding');env.unmount();
});

test('partial source failures show warnings and a successful retry clears them',async()=>{
  const env=load();await tick();let warnings=['Codex: directory unavailable'];
  globalThis.fetch=async(_url,options)=>({ok:true,status:200,json:async()=>JSON.parse(options.body).action==='sources'?{ok:true,items:[],warnings}:listing([])});
  env.render();await tick();let tree=env.render();await find(tree,n=>n.type==='button'&&text(n)==='添加来源')[0].props.onClick();tree=env.render();
  assert.match(text(tree),/部分来源读取失败/);assert.match(text(tree),/Codex: directory unavailable/);assert.ok(find(tree,n=>n.props.role==='status'&&text(n).includes('Codex')).length);
  warnings=[];const picker=find(tree,n=>n.type==='section'&&n.props['aria-label']==='选择来源')[0];await find(picker,n=>n.type==='button'&&text(n)==='重新加载')[0].props.onClick();tree=env.render();assert.doesNotMatch(text(tree),/Codex: directory unavailable/);env.unmount();
});

test('source picker defaults to the exact current project and preserves an explicit all-projects choice',async()=>{
  const env=load();const items=[{id:'a',source:'dsh',cwd:'/work/project/'},{id:'b',source:'codex',cwd:'/other/project'}];
  const c=env.create('session-a',env.t,async()=>({items,targetCwd:'/work/project'}));
  await c.openSources();assert.equal(c.getSnapshot().projectFilter,'/work/project');assert.deepEqual(c.sourceResults().visible.map(x=>x.id),['a']);
  c.setProjectFilter('*');await c.openSources();assert.equal(c.getSnapshot().projectFilter,'*');assert.equal(c.sourceResults().total,2);
  c.setProjectFilter('/other/project');assert.deepEqual(c.sourceResults().visible.map(x=>x.id),['b']);
  const other=env.create('session-b',env.t,async()=>({items,targetCwd:'/missing'}));await other.openSources();assert.equal(other.getSnapshot().projectFilter,'*');assert.equal(other.sourceResults().total,2);
});

test('source picker sorts recent activity descending, falls back to creation date and puts undated records last',async()=>{
  const env=load();const items=[
    {id:'unknown',source:'dsh'},
    {id:'older',source:'dsh',updatedAt:'2026-01-01T00:00:00Z'},
    {id:'created',source:'codex',updatedAt:'invalid',createdAt:'2026-06-01T00:00:00Z'},
    {id:'latest',source:'claude',updatedAt:Date.parse('2026-11-14T00:00:00Z'),createdAt:'2025-01-01T00:00:00Z'},
  ];const c=env.create('session-a',env.t,async()=>({items}));await c.openSources();
  assert.deepEqual(c.sourceResults().visible.map(x=>x.id),['latest','created','older','unknown']);
});

test('source, project and full session ID search compose and distinguish duplicate titles',async()=>{
  const env=load();const items=[
    {id:'codex:full-first-uuid',title:'Same title',source:'codex',cwd:'/one/project',firstPrompt:'Investigate cached connections'},
    {id:'codex:full-second-uuid',title:'Same title',source:'codex',cwd:'/two/project',firstPrompt:'Resolve a different issue'},
    {id:'dsh:third',title:'Same title',source:'dsh',cwd:'/one/project'},
  ];const c=env.create('session-a',env.t,async()=>({items}));await c.openSources();
  c.setSourceFilter('codex');assert.equal(c.sourceResults().total,2);
  c.setProjectFilter('/one/project');assert.deepEqual(c.sourceResults().visible.map(x=>x.id),['codex:full-first-uuid']);
  c.setQuery('CACHED CONNECTIONS');assert.equal(c.sourceResults().total,1);
  c.setProjectFilter('*');c.setQuery('codex:full-second-uuid');assert.deepEqual(c.sourceResults().visible.map(x=>x.id),['codex:full-second-uuid']);
  c.setQuery('');c.setSourceFilter('claude');assert.equal(c.sourceResults().total,0);
  c.setSourceFilter('all');assert.equal(c.sourceResults().total,3);
});

test('source list shows twenty results at a time and resets pagination after any lookup change',async()=>{
  const env=load();const items=Array.from({length:45},(_,i)=>({id:`session-${i}`,title:`Session ${i}`,source:i%2?'codex':'dsh',cwd:'/work',updatedAt:1000+i}));
  const c=env.create('session-a',env.t,async()=>({items}));await c.openSources();assert.equal(c.sourceResults().total,45);assert.equal(c.sourceResults().visible.length,20);assert.equal(c.sourceResults().visible[0].id,'session-44');
  c.moreSources();assert.equal(c.sourceResults().visible.length,40);c.moreSources();assert.equal(c.sourceResults().visible.length,45);
  c.setQuery('Session');assert.equal(c.sourceResults().visible.length,20);c.moreSources();c.setSourceFilter('codex');assert.equal(c.sourceResults().visible.length,20);assert.equal(c.sourceResults().total,22);
  c.moreSources();c.setProjectFilter('/work');assert.equal(c.sourceResults().visible.length,20);
});

test('already linked sources remain identifiable but cannot be added a second time',async()=>{
  const env=load();const actions=[];const c=env.create('session-a',env.t,async action=>{actions.push(action);return action==='list'?listing():{items:[{id:'codex:source',title:'Existing',source:'codex'}]};});
  await c.load();await c.openSources();assert.equal(c.sourceResults().visible[0].id,'codex:source');await c.add('codex:source');assert.deepEqual(actions,['list','sources']);
});

test('rendered picker exposes filters, result counts, complete IDs and dates without expanding full directory paths',async()=>{
  const env=load();await tick();const items=Array.from({length:25},(_,i)=>({id:`codex:complete-session-${i}`,title:'Same title',source:'codex',cwd:'/very/long/work/project',updatedAt:'2026-11-14T00:00:00Z',createdAt:'2026-11-01T00:00:00Z',firstPrompt:`Distinct first prompt ${i}`}));
  globalThis.fetch=async(_url,options)=>({ok:true,status:200,json:async()=>JSON.parse(options.body).action==='sources'?{ok:true,items,targetCwd:'/very/long/work/project'}:listing([])});
  env.render();await tick();let tree=env.render();await find(tree,n=>n.type==='button'&&text(n)==='添加来源')[0].props.onClick();tree=env.render();
  const picker=find(tree,n=>n.type==='section'&&n.props['aria-label']==='选择来源')[0];
  assert.equal(find(picker,n=>n.type==='button'&&n.props['aria-pressed']!==undefined).length,4);
  const project=find(picker,n=>n.type==='select'&&n.props['aria-label']==='项目')[0];assert.equal(project.props.value,'/very/long/work/project');assert.match(text(project),/全部项目/);assert.match(text(project),/当前项目/);
  assert.match(text(picker),/找到 25 个会话，已显示 20 个/);const rows=find(picker,n=>n.props.className==='fl-source');assert.equal(rows.length,20);
  assert.match(text(rows[0]),/会话 ID: codex:complete-session-/);assert.match(text(rows[0]),/最近活动:/);assert.match(text(rows[0]),/创建时间:/);assert.match(text(rows[0]),/Distinct first prompt/);assert.doesNotMatch(text(rows[0]),/\/very\/long\/work/);
  assert.equal(find(rows[0],n=>n.props.title==='/very/long/work/project').length,1);
  await find(picker,n=>n.type==='button'&&text(n)==='加载更多')[0].props.onClick();tree=env.render();assert.equal(find(tree,n=>n.props.className==='fl-source').length,25);
  const search=find(tree,n=>n.type==='input'&&n.props.type==='search')[0];search.props.onChange({target:{value:'codex:complete-session-24'}});tree=env.render();assert.equal(find(tree,n=>n.props.className==='fl-source').length,1);assert.match(text(tree),/会话 ID: codex:complete-session-24/);env.unmount();
});

test('picker labels follow English locale and source filtering is interactive',async()=>{
  const env=load('en');await tick();globalThis.fetch=async(_url,options)=>({ok:true,status:200,json:async()=>JSON.parse(options.body).action==='sources'?{ok:true,items:[{id:'d',title:'DSH entry',source:'dsh'},{id:'c',title:'Codex entry',source:'codex'}]}:listing([])});
  env.render();await tick();let tree=env.render();await find(tree,n=>n.type==='button'&&text(n)==='Add source')[0].props.onClick();tree=env.render();
  assert.match(text(tree),/All sources/);assert.match(text(tree),/All projects/);assert.match(text(tree),/2 sessions found, 2 shown/);
  find(tree,n=>n.type==='button'&&text(n)==='Codex')[0].props.onClick();tree=env.render();assert.equal(find(tree,n=>n.props.className==='fl-source').length,1);assert.match(text(tree),/Session ID: c/);assert.doesNotMatch(text(tree),/Session ID: d/);env.unmount();
});

test('HTTP and non-JSON failures are shown in the view with retry available',async()=>{
  const env=load();await tick();globalThis.fetch=async()=>({ok:false,status:503,json:async()=>{throw new Error('bad');}});env.render();await tick();let tree=env.render();assert.match(text(tree),/HTTP 503/);assert.equal(find(tree,n=>n.props.role==='alert').length,1);
  globalThis.fetch=async()=>({ok:true,status:200,json:async()=>listing([])});await find(tree,n=>n.type==='button'&&text(n)==='重新加载')[0].props.onClick();tree=env.render();assert.equal(find(tree,n=>n.props.role==='alert').length,0);env.unmount();
});
