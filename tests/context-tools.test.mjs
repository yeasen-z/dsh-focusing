import test from 'node:test';
import assert from 'node:assert/strict';
import { createContextQueries, createContextTools } from '../lib/context-tools.mjs';
import { foldRecord } from '../lib/context-records.mjs';
const at = Date.parse('2026-10-29T01:00:00Z');
const exec = {agent:{session:{id:'caller',header:{cwd:'/work'}}}};
function fixture() {
  const events = [
    {type:'user/message',time:at,data:{content:[{type:'text',text:'fix '+ 'a'.repeat(12000)}]}},
    {type:'turn/start',time:at+1,data:{turn:1}},
    {type:'assistant/message',time:at+2,data:{turn:1,message:{content:[{type:'text',text:'fixed'}]}}},
    {type:'turn/end',time:at+3,data:{turn:1}},
  ];
  let enabled=true;
  const record = foldRecord(events,{id:'codex:x',cwd:'/work',source:'codex'});
  const other = {...record,id:'outside',cwd:'/secret'};
  return {events, disable:()=>{enabled=false;}, source:{
    records:async()=> enabled?[record,other]:[other],
    record:async id=>id==='outside'?other:enabled?record:undefined,
    events:async()=>({header:{cwd:'/work'},events}), errors:()=>[],
  }};
}
test('tools register host-compatible definitions and disposers', async()=>{
  const definitions=createContextTools(fixture().source);
  assert.deepEqual(definitions.map(d=>d.name),['focus_list_sessions','focus_read_session','focus_activity']);
  // The installed DSH registry rejects numeric bound keywords, even though
  // standard JSON Schema accepts them. Bounds are checked by execution code.
  const supported = new Set(['type','properties','required','additionalProperties','items','enum','description']);
  function checkSchema(schema) {
    for (const key of Object.keys(schema)) assert.ok(supported.has(key), key);
    for (const child of Object.values(schema.properties ?? {})) checkSchema(child);
    if (schema.items) checkSchema(schema.items);
  }
  definitions.forEach(d=>checkSchema(d.parameters));
  const value=await definitions[0].execute({},exec);
  assert.equal(JSON.parse(value).total,2, "every workspace is searched by default");
  const narrowed=await definitions[0].execute({cwd:'/work'},exec);
  assert.equal(JSON.parse(narrowed).total,1, "cwd narrows to one workspace");
  assert.equal(definitions[0].output.render({},value)[0].text,value);
});
test('full raw content survives bounded pagination; changed content invalidates cursor',async()=>{
  const f=fixture(); const query=createContextQueries(f.source);
  let cursor; const fragments=[];
  do {const result=await query('focus_read_session',{sessionId:'codex:x',limit:2,...cursor?{cursor}:{}},exec);fragments.push(...result.items);cursor=result.nextCursor;} while(cursor);
  const text=fragments.filter(x=>x.eventIndex===0).map(x=>x.text).join('');
  assert.deepEqual(JSON.parse(text),f.events[0]);
  const first=await query('focus_read_session',{sessionId:'codex:x',limit:1},exec);
  f.events[0].data.content[0].text+='changed';
  await assert.rejects(query('focus_read_session',{sessionId:'codex:x',cursor:first.nextCursor},exec),/changed/);
});
test('workspace, source, time, cursor and cancellation boundaries',async()=>{
  const f=fixture(); const query=createContextQueries(f.source);
  // No caller workspace is needed: the query is not tied to where it is asked from.
  assert.equal((await query('focus_list_sessions',{},{})).total,2);
  assert.equal((await query('focus_list_sessions',{cwd:'/secret'},exec)).total,1);
  assert.equal((await query('focus_list_sessions',{cwd:'/nowhere'},exec)).total,0);
  await assert.rejects(query('focus_list_sessions',{cwd:5},exec),/cwd/);
  assert.equal((await query('focus_read_session',{sessionId:'outside'},exec)).sessionId,'outside');
  await assert.rejects(query('focus_list_sessions',{start:'2026-10-29'},exec),/timezone/);
  await assert.rejects(query('focus_list_sessions',{limit:1000},exec),/integer/);
  await assert.rejects(query('focus_list_sessions',{cursor:'bad'},exec),/cursor/);
  await assert.rejects(query('focus_list_sessions',{}, {...exec,signal:AbortSignal.abort()}));
  const activity=await query('focus_activity',{start:'2026-10-29T00:00:00Z',end:'2026-10-30T00:00:00Z'},exec);
  assert.equal(activity.total,2);
  assert.equal((await query('focus_activity',{start:'2026-10-29T00:00:00Z',end:'2026-10-30T00:00:00Z',cwd:'/work'},exec)).total,1);
  f.disable();
  await assert.rejects(query('focus_read_session',{sessionId:'codex:x'},exec),/unavailable/);
});
