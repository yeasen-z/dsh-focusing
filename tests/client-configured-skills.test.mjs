import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const SOURCE=readFileSync(new URL('../lib/client.js',import.meta.url),'utf8');
const tick=()=>new Promise(resolve=>setImmediate(resolve));
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {resolve,promise};};
const text=n=>typeof n==='string'?n:Array.isArray(n)?n.map(text).join(''):n?.children?.map(text).join('')||'';
const find=(n,p,out=[])=>{if(Array.isArray(n))n.forEach(x=>find(x,p,out));else if(n&&typeof n==='object'){if(p(n))out.push(n);(n.children||[]).forEach(x=>find(x,p,out));}return out;};
const row={name:'office',description:'Create Office documents',modelInvocable:true,whenToUse:'When editing spreadsheets',path:'/skills/office/SKILL.md'};
function harness(){
 let module;globalThis.window={__ModuleLoader__:{load:m=>module=m}};globalThis.fetch=async()=>({ok:true,json:async()=>({settings:{}})});new Function(SOURCE)();
 let states=[],memos=[],effects=[],si=0,mi=0,ei=0,pending=[];
 const React={createElement:(type,props,...children)=>({type,props:props||{},children}),Fragment:'Fragment',useCallback:fn=>fn,
 useState:init=>{const i=si++;if(!(i in states))states[i]=typeof init==='function'?init():init;return [states[i],v=>states[i]=typeof v==='function'?v(states[i]):v];},
 useMemo:(fn,deps)=>{const i=mi++,old=memos[i];if(!old||deps.some((x,j)=>x!==old.deps[j]))memos[i]={deps,value:fn()};return memos[i].value;},
 useEffect:(fn,deps)=>{const i=ei++,old=effects[i];if(!old||deps.some((x,j)=>x!==old.deps[j]))pending.push(()=>{old?.cleanup?.();effects[i]={deps,cleanup:fn()};});}};
 const api=module.factory(()=>React),tables={},registrations=[],hooks={},remotes={},bindings=new Map(['a','b'].map(id=>[id,{session:{getSnapshot:()=>({openState:'open'})}}]));let locale='zh',list=async()=>({ok:true,value:{skills:[row]}}),calls=[],retains=0,releases=0;
 const sessions={binding:id=>bindings.get(id),subagentAddress:()=>undefined,using:async(id,options,fn)=>{retains++;try{return await fn({binding:bindings.get(id)});}finally{releases++;}}};
 const remote=new Proxy({skills:{list:(...args)=>{calls.push(args);return list(...args);}},$on:(name,fn)=>remotes[name]=fn},{get(target,key){if(key==='skills'&&!api.inject.includes('remote.skills'))throw new Error('cannot get property "remote.skills" without inject');return target[key];}});
 const ctx={locale:{bind:()=>key=>tables[locale]?.[key]||key,register:(_ns,lang,table)=>{tables[lang]=table;return()=>{};},subscribe:()=>()=>{}},effect:fn=>fn(),on:(name,fn)=>hooks[name]=fn,get:name=>({sessions,remote})[name],slots:{inject:(_slot,fn)=>fn(),register:(options,component)=>{registrations.push({options,component});return()=>{};}}};
 api.apply(ctx);
 const entry=registrations.find(x=>x.options.id==='focusing-configured-skills'),wb=registrations.find(x=>x.options.name==='focusing.panel.body').component;
 const render=(id='a')=>{si=mi=ei=0;pending=[];const tree=wb.configuredSkills.Panel(entry.options.inject(id));pending.forEach(fn=>fn());return tree;};
 return {entry,ctx,skills:wb.configuredSkills,render,bindings,sessions,remotes,hooks,calls,setList:fn=>list=fn,setLocale:value=>locale=value,counts:()=>({retains,releases}),unmount:()=>effects.forEach(e=>e.cleanup?.()),t:ctx.locale.bind()};
}
test('registers additive Skills tab after linked snapshots and localizes label',()=>{
 const h=harness();assert.equal(h.entry.options.order,30);assert.equal(h.entry.options.name,'conversation.view');assert.equal(h.entry.options.label(),'已配置 Skills');h.setLocale('en');assert.equal(h.entry.options.label(),'Configured Skills');
});
test('uses official exact-session read with retain/release and does not execute any skill',async()=>{
 const h=harness(),signal=new AbortController().signal;assert.deepEqual(await h.skills.read(h.ctx,'a',h.bindings.get('a'),signal,h.t),[row]);
 assert.equal(h.calls.length,1);assert.deepEqual(h.calls[0],[{sessionId:'a'},signal]);assert.deepEqual(h.counts(),{retains:1,releases:1});
});
test('rejects absent APIs, subagents, stale bindings and unopened sessions without catalog calls',async()=>{
 const h=harness(),read=()=>h.skills.read(h.ctx,'a',h.bindings.get('a'),new AbortController().signal,h.t);
 await assert.rejects(h.skills.read({get:()=>undefined},'a',{},new AbortController().signal,h.t),/接口不可用/);
 h.sessions.subagentAddress=()=>({kind:'subagent'});await assert.rejects(read(),/普通会话/);h.sessions.subagentAddress=()=>undefined;
 await assert.rejects(h.skills.read(h.ctx,'a',{},new AbortController().signal,h.t),/普通会话/);
 h.bindings.get('a').session.getSnapshot=()=>({openState:'opening'});await assert.rejects(read(),/普通会话/);assert.equal(h.calls.length,0);assert.deepEqual(h.counts(),{retains:1,releases:1});
});
test('surfaces authorization errors without falling back to a global catalog',async()=>{
 const h=harness();h.setList(async()=>({ok:false,error:{code:'gateway/forbidden',message:'Denied'}}));
 await assert.rejects(h.skills.read(h.ctx,'a',h.bindings.get('a'),new AbortController().signal,h.t),/gateway\/forbidden: Denied/);assert.deepEqual(h.counts(),{retains:1,releases:1});
});
test('validates metadata, detects replaced binding and respects cancellation',async()=>{
 const h=harness();const read=signal=>h.skills.read(h.ctx,'a',h.bindings.get('a'),signal,h.t);
 h.setList(async()=>({ok:true,value:{skills:[{name:'bad'}]}}));await assert.rejects(read(new AbortController().signal),/无效数据/);
 const wait=deferred();h.setList(()=>wait.promise);const ac=new AbortController(),pending=read(ac.signal);ac.abort();wait.resolve({ok:true,value:{skills:[row]}});await assert.rejects(pending,/abort/i);
 h.setList(async()=>{h.bindings.set('a',{});return {ok:true,value:{skills:[row]}};});await assert.rejects(read(new AbortController().signal),/普通会话/);
});
test('controller invalidates late reads, clears stale metadata on reload and retries failures',async()=>{
 const h=harness(),wait=deferred();let calls=0;const c=h.skills.createController(()=>++calls===1?wait.promise:Promise.resolve([{...row,name:'new'}]));const old=c.load();await c.load();wait.resolve([row]);await old;assert.equal(c.getSnapshot().skills[0].name,'new');
 c.dispose();await c.load();assert.equal(calls,2);c.revive();await c.load();assert.equal(calls,3);
 let fail=true;const d=h.skills.createController(async()=>{if(fail)throw new Error('offline');return [];});await d.load();assert.equal(d.getSnapshot().loaded,false);assert.match(d.getSnapshot().error,/offline/);fail=false;await d.load();assert.equal(d.getSnapshot().loaded,true);assert.equal(d.getSnapshot().error,'');
});
test('renders searchable metadata and expandable usage without loading bodies or sending messages',async()=>{
 const h=harness();h.render();await tick();let tree=h.render();assert.match(text(tree),/office/);assert.match(text(tree),/模型也可按需使用/);assert.equal(text(tree).includes('/office '),false);
 find(tree,n=>n.type==='button'&&text(n)==='office')[0].props.onClick();tree=h.render();assert.match(text(tree),/\/office /);assert.match(text(tree),/When editing spreadsheets/);assert.match(text(tree),/SKILL.md/);assert.equal(h.calls.length,1);
 find(tree,n=>n.type==='input')[0].props.onChange({target:{value:'absent'}});assert.match(text(h.render()),/没有匹配/);h.unmount();
});
test('shows user-only, empty and retryable errors in both languages',async()=>{
 const h=harness();h.setLocale('en');h.setList(async()=>({ok:true,value:{skills:[{name:'manual',description:'Only manual',modelInvocable:false}]}}));h.render();await tick();assert.match(text(h.render()),/User invocation only/);
 h.setList(async()=>({ok:true,value:{skills:[]}}));h.remotes['plugin-manager/changed']();await tick();assert.match(text(h.render()),/No user-invocable/);
 h.setList(async()=>{throw new Error('offline');});h.hooks['connection/reset']();await tick();assert.match(text(h.render()),/offline/);assert.equal(find(h.render(),n=>n.props.role==='alert').length,1);h.unmount();
});
test('groups Skills by location without treating names or third-party packages as built-ins',async()=>{
  const h=harness();h.setList(async()=>({ok:true,value:{skills:[
    {...row,name:'builtin-doc',path:'/app/node_modules/@deepseek-ai/dsh-agent-preset/skills/dsh-doc/SKILL.md'},
    ...['office','office-docx','office-pptx','office-xlsx'].map(name=>({...row,name,path:`/app/node_modules/@deepseek-ai/dsh-skill-office/assets/${name}/SKILL.md`})),
    {...row,name:'dsh-doc',path:'/home/person/.agents/skills/custom/SKILL.md'},
    {...row,name:'windows',path:'C:\\Users\\person\\.dsh\\skills\\custom\\SKILL.md'},
    {...row,name:'plugin',path:'/node_modules/third-party/skills/custom/SKILL.md'},
    {...row,name:'nested',path:'/node_modules/@deepseek-ai/dsh-agent-preset/node_modules/third-party/skills/custom/SKILL.md'},
    {...row,name:'unknown',path:undefined},
  ]}}));h.render();await tick();let tree=h.render();
  const group=label=>find(tree,n=>n.type==='section'&&n.props['aria-label']===label)[0];
  assert.match(text(group('DSH 内置')),/builtin-doc/);assert.equal(text(group('DSH 内置')).includes('nested'),false);
  assert.equal(find(group('DSH 内置'),n=>n.type==='article').length,5);
  for(const name of ['office','office-docx','office-pptx','office-xlsx'])assert.ok(find(group('DSH 内置'),n=>n.type==='button'&&text(n)===name).length);
  assert.match(text(group('用户 / 项目 Skills')),/dsh-doc/);assert.match(text(group('用户 / 项目 Skills')),/windows/);
  assert.match(text(group('插件 / 其他来源')),/plugin/);assert.match(text(group('插件 / 其他来源')),/nested/);assert.match(text(group('插件 / 其他来源')),/unknown/);
  find(tree,n=>n.type==='input')[0].props.onChange({target:{value:'windows'}});tree=h.render();assert.equal(group('DSH 内置'),undefined);assert.match(text(group('用户 / 项目 Skills')),/1/);
  h.setLocale('en');tree=h.render();assert.ok(group('User / project Skills'));h.unmount();
});
test('session/preset changes refresh only the relevant catalog and clear prior details',async()=>{
 const h=harness();h.render();await tick();h.render();h.remotes['agent-preset/selected']('b');assert.equal(h.calls.length,1);h.remotes['agent-preset/selected']('a');await tick();assert.equal(h.calls.length,2);
 const wait=deferred();h.setList(()=>wait.promise);h.remotes['agent-preset/selected']('a');assert.equal(text(h.render('b')).includes('office'),false);wait.resolve({ok:true,value:{skills:[row]}});await tick();h.render('b');assert.equal(h.calls.at(-1)[0].sessionId,'b');h.unmount();
});
