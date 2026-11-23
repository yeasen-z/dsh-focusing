import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const source=readFileSync(new URL('../lib/client.js',import.meta.url),'utf8');
const text=n=>typeof n==='string'?n:Array.isArray(n)?n.map(text).join(''):n?.children?.map(text).join('')||'';
const find=(n,p,out=[])=>{if(Array.isArray(n))n.forEach(x=>find(x,p,out));else if(n&&typeof n==='object'){if(p(n))out.push(n);(n.children||[]).forEach(x=>find(x,p,out));}return out;};
const tick=()=>new Promise(r=>setImmediate(r));
function harness(digest,{locale='zh',post}={}){
  let module,Workbench,props,states=[0,'result',digest.id,digest,'',[]],si=0,ri=0,ei=0;
  const refs=[],effects=[],pending=[],requests=[],dict={};
  globalThis.window={__ModuleLoader__:{load:m=>module=m}};
  globalThis.fetch=async(url,options={})=>{requests.push({url,options});return {ok:true,json:async()=>options.method==='POST'?await post?.(JSON.parse(options.body))??{ok:true,digest:{...digest,status:'running',stage:'batches'}}:String(url).includes('.digest?')?{ok:true,digest}:{ok:true}};};
  new Function(source)();
  const React={createElement:(type,props,...children)=>({type,props:props||{},children}),Fragment:'Fragment',useCallback:f=>f,
    useState:init=>{const i=si++;if(!(i in states))states[i]=typeof init==='function'?init():init;return [states[i],v=>states[i]=typeof v==='function'?v(states[i]):v];},
    useRef:v=>refs[ri++]??={current:v},useEffect:(fn,deps)=>{const i=ei++,old=effects[i];if(!old||!deps||deps.some((v,j)=>v!==old.deps?.[j]))pending.push(()=>{old?.cleanup?.();effects[i]={deps,cleanup:fn()};});}};
  module.factory(()=>React).apply({locale:{bind:()=>k=>dict[k]??k,register:(_n,l,t)=>{if(l===locale)Object.assign(dict,t);return()=>{};},subscribe:()=>()=>{}},effect:f=>f(),get:()=>undefined,slots:{inject:(_n,f)=>f(),register:(o,c)=>{if(o.name==='focusing.panel.body'){Workbench=c;props=o.inject?.();}return()=>{};}}});
  const render=(runEffects=false)=>{si=ri=ei=0;pending.length=0;const tree=Workbench({...props,t:k=>dict[k]??k,subscribeLocale:()=>()=>{},openSession:()=>{}});if(runEffects)pending.splice(0).forEach(f=>f());return tree;};
  return {render,requests,dict,state:()=>states,close:()=>effects.forEach(e=>{if(typeof e?.cleanup==='function')e.cleanup();})};
}
const base={id:'saved-42',request:'整理本周',createdAt:Date.now(),range:{key:'this-week',label:'本周',from:'2026-11-09',to:'2026-11-15'},status:'running',stage:'batches',progress:{totalSessions:42,completedSessions:18,totalBatches:8,completedBatches:3,failedBatches:1},result:{projects:[],days:[],next:[],sections:[]}};
test('bounded pipeline shows stages and counts without rendering snapshot payloads',()=>{
 const h=harness({...base,snapshot:{secret:'PRIVATE RAW HISTORY'}});const tree=h.render(),s=text(tree);
 assert.match(s,/固定本次整理的来源快照/);assert.match(s,/分批提炼会话内容/);assert.match(s,/18 \/ 42 个会话/);assert.match(s,/3 \/ 8 批完成/);assert.match(s,/1 批未完成/);assert.ok(!s.includes('PRIVATE RAW HISTORY'));
 const active=find(tree,n=>n.props.className==='fw-think'&&find(n,x=>x.props.className==='fw-spin').length);assert.match(text(active),/分批提炼/);
});
test('partial done result warns about coverage and offers same-id resume in English',async()=>{
 const h=harness({...base,status:'done',partial:true,retryable:true},{locale:'en'});const tree=h.render();assert.match(text(tree),/Only some sources are covered/);
 await find(tree,n=>n.type==='button'&&text(n)==='Resume unfinished digest')[0].props.onClick();
 const request=h.requests.find(r=>r.options.method==='POST');assert.deepEqual(JSON.parse(request.options.body),{action:'retry',id:'saved-42'});assert.equal(h.state()[2],'saved-42');assert.equal(h.state()[3].status,'running');
});
test('restored interrupted digest retries same id and restarts stopped polling',async(t)=>{
 const h=harness({...base,status:'interrupted',retryable:true});t.after(()=>h.close());h.render(true);await tick();let tree=h.render(true);assert.match(text(tree),/整理已中断/);
 const before=h.requests.filter(r=>String(r.url).includes('.digest?')).length;
 await find(tree,n=>n.type==='button'&&text(n)==='继续未完成的整理')[0].props.onClick();h.render(true);await tick();
 assert.equal(h.requests.filter(r=>String(r.url).includes('.digest?')).length,before+1);assert.equal(h.state()[2],'saved-42');h.close();
});
test('resume submission deduplicates clicks and shows errors without losing prior digest',async()=>{
 let resolve;const gate=new Promise(r=>resolve=r);const h=harness({...base,status:'failed',retryable:true},{post:()=>gate});
 const button=find(h.render(),n=>n.type==='button'&&text(n)==='继续未完成的整理')[0];const first=button.props.onClick();await button.props.onClick();assert.equal(h.requests.length,1);assert.equal(find(h.render(),n=>n.type==='button'&&text(n)==='继续未完成的整理')[0].props.disabled,true);
 resolve({ok:false,reason:'offline'});await first;assert.match(text(h.render()),/offline/);assert.equal(h.state()[3].status,'failed');assert.equal(h.state()[2],'saved-42');
});
test('older failed digests without resume support still create a new request',async()=>{
 const savedNavigator=Object.getOwnPropertyDescriptor(globalThis,'navigator');Object.defineProperty(globalThis,'navigator',{value:{language:'zh'},configurable:true});
 const h=harness({...base,status:'failed',retryable:false},{post:()=>({ok:true,ask:{id:'focus-new-id',title:'整理本周',status:'running',report:{request:'整理本周',kind:'weekly',range:base.range},messages:[]}})});
 try{await find(h.render(),n=>n.type==='button'&&text(n)==='重试')[0].props.onClick();const body=JSON.parse(h.requests[0].options.body);assert.equal(body.action,undefined);assert.equal(body.report.request,'整理本周');assert.equal(body.range,'this-week');assert.match(h.requests[0].url,/native-ask$/);assert.equal(h.state()[2],'focus-new-id');}
 finally{if(savedNavigator)Object.defineProperty(globalThis,'navigator',savedNavigator);else delete globalThis.navigator;}
});
test('missing progress fields do not claim zero coverage and legacy stages still render',()=>{
 const h=harness({...base,progress:{totalSessions:42},stage:'reduce'});assert.match(text(h.render()),/— \/ 42/);
 const old=harness({...base,progress:undefined,stage:'model'});assert.match(text(old.render()),/由模型归纳/);assert.ok(!text(old.render()).includes('undefined'));
});
