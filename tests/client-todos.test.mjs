import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const source=fs.readFileSync(new URL('../lib/client.js',import.meta.url),'utf8');
const task=(extra={})=>({id:'one',title:'Ship',notes:'Check build',project:'Focusing',quadrant:'do',status:'todo',dueDate:'2026-12-01',createdAt:1,updatedAt:1,completedAt:null,revision:1,...extra});
const response=(tasks,status=200)=>({ok:status===200,status,json:async()=>({ok:status===200,tasks})});
const find=(n,p)=>Array.isArray(n)?n.flatMap(c=>find(c,p)):n&&typeof n==='object'?[...(p(n)?[n]:[]),...(n.children||[]).flatMap(c=>find(c,p))]:[];
const text=n=>Array.isArray(n)?n.map(text).join(''):n&&typeof n==='object'?text(n.children):typeof n==='string'?n:'';
const tick=()=>new Promise(resolve=>setImmediate(resolve));
function mount(handler,language='en',storedView){
  let module,Workbench;
  const calls=[],dict={},storage=storedView?{'dsh-focusing.page':JSON.stringify({view:storedView})}:{};
  globalThis.window={__ModuleLoader__:{load:m=>module=m},sessionStorage:{getItem:k=>storage[k]||null,setItem:(k,v)=>storage[k]=v}};
  globalThis.fetch=async(url,init={})=>{calls.push({url,init,body:init.body?JSON.parse(init.body):null});return handler(calls.at(-1),calls.length);};
  new Function(source)();
  const slots=[];let cursor=0,effects=[];
  const React={createElement:(type,props,...children)=>({type,props:props||{},children}),Fragment:'Fragment',useCallback:f=>f,
    useState:init=>{const i=cursor++;if(!(i in slots))slots[i]=typeof init==='function'?init():init;return[slots[i],v=>slots[i]=typeof v==='function'?v(slots[i]):v];},
    useRef:init=>{const i=cursor++;if(!(i in slots))slots[i]={current:init};return slots[i];},
    useEffect:(fn,deps)=>{const i=cursor++;if(!(i in slots)||deps.some((v,j)=>v!==slots[i][j])){slots[i]=deps;effects.push(fn);}}};
  module.factory(()=>React).apply({locale:{bind:()=>k=>dict[k]||k,register:(ns,lang,values)=>{if(lang===language)Object.assign(dict,values);return()=>{};},subscribe:()=>()=>{}},effect:f=>f(),get:()=>undefined,slots:{inject:(n,f)=>f(),register:(o,c)=>{if(o.name==='focusing.panel.body')Workbench=c;return()=>{};}}});
  const cleanups=[];
  const render=(full=false)=>{cursor=0;const tree=(full?Workbench:Workbench.Todos)({t:k=>dict[k]||k,subscribeLocale:()=>()=>{},capabilities:{canAsk:false,canReport:false,canRooms:false,canAnalyze:false}});if(!full)effects.splice(0).forEach(f=>{const c=f();if(c)cleanups.push(c);});return tree;};
  return {render,calls,Workbench,dispose:()=>cleanups.forEach(f=>f())};
}
const button=(tree,label)=>find(tree,n=>n.type==='button'&&text(n)===label)[0];
const field=(tree,label)=>find(tree,n=>n.type==='label'&&n.children[0]===label)[0].children[1];
const change=(app,label,value)=>field(app.render(),label).props.onChange({target:{value}});
const submit=tree=>find(tree,n=>n.type==='form')[0].props.onSubmit({preventDefault(){}});

test('GET paints four labelled quadrants; completed tasks are collapsed and restorable',async()=>{
 const app=mount(()=>response([task(),task({id:'two',title:'Finished',status:'done'})]));
 assert.match(text(app.render()),/Quadrant todos/);await tick();let tree=app.render();
 assert.equal(app.calls[0].url,'/api/dsh-focusing.todos');assert.equal(app.calls[0].init.credentials,'same-origin');
 assert.deepEqual(find(tree,n=>n.type==='section'&&n.props.className==='fw-todo-quadrant').map(n=>n.props['aria-label']),['Do now','Plan ahead','Delegate when possible','Reduce or set aside']);
 assert.match(text(tree),/Important · Not urgent/);assert.doesNotMatch(text(tree),/Finished/);
 const completed=button(tree,'Completed (1)');assert.equal(completed.props['aria-expanded'],false);completed.props.onClick();tree=app.render();
 assert.match(text(tree),/Finished/);await button(tree,'Restore to do').props.onClick();
 assert.equal(app.calls.at(-1).body.task.status,'todo');assert.equal(app.calls.at(-1).body.revision,1);app.dispose();
});

test('round completion control announces the move and completed count; restore announces success',async()=>{
 const app=mount(c=>c.body?.task?.status==='done'?response([task({status:'done',completedAt:2})]):response([task()]));app.render();await tick();
 const complete=button(app.render(),'Done');assert.equal(complete.props['aria-label'],'Done · Ship');await complete.props.onClick();await tick();
 let tree=app.render();assert.equal(app.calls.at(-1).body.task.status,'done');assert.match(text(tree),/Completed and moved to Completed below/);assert.match(text(tree),/Completed \(1\)/);assert.match(text(find(tree,n=>n.props.className==='fw-todo-summary')[0]),/0 active/);
 button(tree,'Completed (1)').props.onClick();tree=app.render();await button(tree,'Restore to do').props.onClick();await tick();tree=app.render();
 assert.equal(app.calls.at(-1).body.task.status,'todo');assert.match(text(tree),/Restored to do/);assert.match(text(find(tree,n=>n.props.className==='fw-todo-summary')[0]),/1 active/);app.dispose();
});

test('editing a completed task keeps the completed section expanded until cancel',async()=>{
 const app=mount(()=>response([task({status:'done'})]));app.render();await tick();button(app.render(),'Completed (1)').props.onClick();button(app.render(),'Edit').props.onClick();
 let tree=app.render();const toggle=button(tree,'Completed (1)');assert.equal(toggle.props.disabled,true);assert.equal(toggle.props['aria-expanded'],true);toggle.props.onClick();tree=app.render();
 assert.equal(field(tree,'Title').props.value,'Ship');assert.equal(find(tree,n=>n.type==='form').length,1);button(tree,'Cancel').props.onClick();tree=app.render();assert.equal(button(tree,'Completed (1)').props.disabled,false);app.dispose();
});

test('each quadrant creates a task from its own input on Enter and keeps the text when saving fails',async()=>{
 let fail=true;const app=mount(c=>c.body?(fail?response([],500):response([task({id:'new',title:'Call vendor',quadrant:'delegate'})])):response([]));app.render();await tick();
 const quick=()=>find(app.render(),n=>n.type==='input'&&n.props['aria-label']==='Quick add · Delegate when possible')[0];
 assert.deepEqual(find(app.render(),n=>n.props.className==='fw-todo-axis-x')[0].children.map(text),['Urgent','Not urgent']);
 quick().props.onChange({target:{value:'  Call vendor  '}});
 await quick().props.onKeyDown({key:'Enter',preventDefault(){},nativeEvent:{}});await tick();
 assert.deepEqual(app.calls.at(-1).body,{action:'create',task:{title:'Call vendor',notes:'',project:'',quadrant:'delegate',status:'todo',dueDate:''}});
 assert.equal(quick().props.value,'  Call vendor  ');
 fail=false;await quick().props.onKeyDown({key:'Enter',preventDefault(){},nativeEvent:{}});await tick();
 assert.equal(quick().props.value,'');assert.match(text(find(app.render(),n=>n.props['aria-label']==='Delegate when possible')[0]),/Call vendor/);
 const before=app.calls.length;quick().props.onKeyDown({key:'Enter',preventDefault(){},nativeEvent:{isComposing:true}});assert.equal(app.calls.length,before);app.dispose();
});

test('inline create edits all fields, sends only task fields, and moves task by quadrant',async()=>{
 const app=mount(c=>response(c.body?[task({...c.body.task})]:[]));app.render();await tick();
 button(app.render(),'Quick add').props.onClick();
 assert.ok(find(app.render(),n=>n.type==='form')[0].props.className.includes('fw-todo-form-global'));assert.equal(field(app.render(),'Quadrant').props.value,'do');
 for(const [label,value] of [['Title','Write notes'],['Notes','Details'],['Project','Personal'],['Quadrant','plan'],['Status','doing'],['Due date','2026-12-12']])change(app,label,value);
 await submit(app.render());await tick();
 assert.deepEqual(app.calls.at(-1).body,{action:'create',task:{title:'Write notes',notes:'Details',project:'Personal',quadrant:'plan',status:'doing',dueDate:'2026-12-12'}});
 const tree=app.render();assert.equal(find(tree,n=>n.type==='form').length,0);
 assert.match(text(find(tree,n=>n.props['aria-label']==='Plan ahead')[0]),/Write notes/);app.dispose();
});

test('edit and delete use revisions; deleting requires a separate confirmation and cancel sends nothing',async()=>{
 const app=mount(c=>response(c.body?.action==='delete'?[]:[task({revision:7})]));app.render();await tick();
 button(app.render(),'Edit').props.onClick();change(app,'Title','Updated');await submit(app.render());await tick();
 assert.equal(app.calls.at(-1).body.action,'update');assert.equal(app.calls.at(-1).body.id,'one');assert.equal(app.calls.at(-1).body.revision,7);
 button(app.render(),'Delete').props.onClick();assert.equal(app.calls.length,2);
 button(app.render(),'Cancel').props.onClick();assert.equal(app.calls.length,2);
 button(app.render(),'Delete').props.onClick();const confirm=find(app.render(),n=>n.props.role==='group')[0];
 assert.match(confirm.props['aria-label'],/cannot be undone/);await button(confirm,'Delete').props.onClick();await tick();
 assert.deepEqual(app.calls.at(-1).body,{action:'delete',id:'one',revision:7});assert.doesNotMatch(text(app.render()),/Ship/);app.dispose();
});

test('409 reload preserves editing draft and subsequent save uses refreshed revision',async()=>{
 let posts=0;const app=mount(c=>c.body?(++posts===1?response([],409):response([task({...c.body.task,revision:3})])):response([task({title:posts?'Changed elsewhere':'Ship',revision:posts?2:1})]));
 app.render();await tick();button(app.render(),'Edit').props.onClick();change(app,'Title','My draft');await submit(app.render());await tick();
 let tree=app.render();assert.equal(field(tree,'Title').props.value,'My draft');assert.match(text(tree),/Changed elsewhere/);assert.match(text(find(tree,n=>n.props.role==='alert')),/draft kept/);assert.equal(app.calls.length,3);
 await submit(tree);await tick();assert.equal(app.calls.at(-1).body.revision,2);assert.equal(app.calls.at(-1).body.task.title,'My draft');app.dispose();
});

test('failed GET exposes retry; pending controls and synchronous guard prevent duplicate mutations',async()=>{
 let finish;const app=mount((c,n)=>n===1?response([],500):c.body?new Promise(resolve=>finish=resolve):response([task()]));
 app.render();await tick();let tree=app.render();assert.match(text(find(tree,n=>n.props.role==='alert')),/HTTP 500/);
 await button(tree,'Reload').props.onClick();await tick();tree=app.render();const doing=button(tree,'Doing');const request=doing.props.onClick();doing.props.onClick();
 assert.equal(app.calls.length,3);tree=app.render();assert.equal(find(tree,n=>n.props.className==='fw-todo-grid')[0].props['aria-busy'],true);assert.ok(find(tree,n=>n.type==='button').every(n=>n.props.disabled));
 finish(response([],503));await request;await tick();tree=app.render();assert.match(text(tree),/Ship/);assert.match(text(find(tree,n=>n.props.role==='alert')),/HTTP 503/);app.dispose();
});

test('failed update retains draft, malformed responses are errors, and unmount aborts fetch',async()=>{
 const app=mount(c=>c.body?{ok:true,status:200,json:async()=>({ok:true})}:response([task()]));app.render();await tick();button(app.render(),'Edit').props.onClick();change(app,'Notes','Keep me');await submit(app.render());await tick();
 assert.equal(field(app.render(),'Notes').props.value,'Keep me');assert.match(text(app.render()),/invalid response/);app.dispose();
 const pending=mount(()=>new Promise(()=>{}));pending.render();const signal=pending.calls[0].init.signal;pending.dispose();assert.equal(signal.aborted,true);
});

test('Chinese labels, keyboard form semantics, and restored Workbench route work without model capabilities',async()=>{
 const app=mount(()=>response([]),'zh');app.render();await tick();let tree=app.render();for(const label of ['立即处理','计划推进','尽量委托','减少或搁置'])assert.match(text(tree),new RegExp(label));
 button(tree,'快速添加').props.onClick();tree=app.render();assert.equal(field(tree,'标题').props.required,true);assert.equal(field(tree,'截止日期').props.type,'date');assert.equal(button(tree,'保存').props.disabled,true);app.dispose();
 const restored=mount(()=>response([]),'en','todos');const root=restored.render(true);
 assert.equal(find(root,n=>n.props['aria-current']==='page')[0].props.title,'Quadrant todos');assert.equal(find(root,n=>n.type===restored.Workbench.Todos).length,1);
 assert.doesNotMatch(source,/className:'fw-cap'/);
});
