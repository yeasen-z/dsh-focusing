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
  const other = {...record,id:'outside',cwd:'/secret',source:'dsh'};
  return {events, disable:()=>{enabled=false;}, source:{
    records:async()=> enabled?[record,other]:[other],
    record:async id=>id==='outside'?other:enabled?record:undefined,
    events:async()=>({header:{cwd:'/work'},events}), errors:()=>[],
  }};
}
test('tools register host-compatible definitions and disposers', async()=>{
  const definitions=createContextTools(fixture().source);
  assert.deepEqual(definitions.map(d=>d.name),['focus_list_sessions','focus_read_session','focus_activity']);
  assert.deepEqual(definitions[0].parameters.properties.sources.items.enum,['dsh','codex','claude']);
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
  assert.equal(JSON.parse(value).items.length,2);
  assert.match(definitions[1].description,/6,000 characters/);
});
test('full raw content survives bounded pagination; changed content invalidates cursor',async()=>{
  const f=fixture(); const query=createContextQueries(f.source);
  const defaultPage=await query('focus_read_session',{sessionId:'codex:x'},exec);
  assert.equal(defaultPage.items.length,6);
  assert.equal(defaultPage.items[0].text.length,6000);
  assert.equal(defaultPage.nextCursor,null, 'a typical session fits in one default read');
  let cursor; const fragments=[];
  do {const result=await query('focus_read_session',{sessionId:'codex:x',limit:2,...cursor?{cursor}:{}},exec);fragments.push(...result.items);cursor=result.nextCursor;} while(cursor);
  const text=fragments.filter(x=>x.eventIndex===0).map(x=>x.text).join('');
  assert.deepEqual(JSON.parse(text),f.events[0]);
  const first=await query('focus_read_session',{sessionId:'codex:x',limit:1},exec);
  f.events[0].data.content[0].text+='changed';
  await assert.rejects(query('focus_read_session',{sessionId:'codex:x',cursor:first.nextCursor},exec),/changed/);
});
test('model-sized pages preserve complete JSON, cursors and exact long event fragments', async () => {
  const f = fixture();
  f.events[0].data.content[0].text = '\\"\n'.repeat(8500);
  const tool = createContextTools(f.source, { resultLimit: 12000 })[1];
  const fragments = [];
  let cursor;
  do {
    const text = await tool.execute({ sessionId: 'codex:x', limit: 50, ...(cursor ? { cursor } : {}) }, exec);
    assert.ok(text.length <= 12000);
    const result = JSON.parse(text);
    assert.equal(result.pageOffset, fragments.length);
    assert.equal(result.truncated, !!result.nextCursor);
    assert.ok(result.items.length);
    fragments.push(...result.items);
    assert.ok(fragments.length <= result.total);
    cursor = result.nextCursor;
  } while (cursor);
  assert.deepEqual(JSON.parse(fragments.filter(item => item.eventIndex === 0).map(item => item.text).join('')), f.events[0]);
  const result = JSON.parse(await tool.execute({ sessionId: 'codex:x', startEventIndex: 2 }, exec));
  assert.deepEqual(result.items.map(item => item.eventIndex), [2, 3]);
});

test('ranked session pages preserve total and continue without missing or repeating matches', async () => {
  const f = fixture();
  const [record] = await f.source.records();
  const records = Array.from({ length: 50 }, (_, i) => ({ ...record, id: `codex:${i}`, title: `fix ${i} ${'title '.repeat(55)}`, cwd: `/${'directory/'.repeat(20)}${i}` }));
  const tool = createContextTools({ ...f.source, records: async () => records }, { resultLimit: 12000 })[0];
  const seen = new Set();
  let cursor;
  let pages = 0;
  do {
    const text = await tool.execute({ query: 'fix', limit: 50, ...(cursor ? { cursor } : {}) }, exec);
    assert.ok(text.length <= 12000);
    const result = JSON.parse(text);
    assert.equal(result.total, records.length);
    assert.equal(result.pageOffset, seen.size);
    assert.ok(result.items.length);
    for (const item of result.items) {
      assert.ok(!seen.has(item.id));
      seen.add(item.id);
    }
    cursor = result.nextCursor;
    pages++;
  } while (cursor);
  assert.ok(pages > 1);
  assert.equal(seen.size, records.length);
});

test('list searches original text and returns a location that can be read directly', async () => {
  const f = fixture();
  f.events.splice(3, 0, { type: 'tool/result', time: at + 2, data: { message: { content: [{ type: 'text', text: `${'x'.repeat(2000)}\nunique restart marker` }] } } });
  const query = createContextQueries(f.source, { resultLimit: 12000 });
  const result = await query('focus_list_sessions', { query: 'restart marker', sources: ['codex'] }, exec);
  assert.equal(result.total, 1);
  assert.equal(result.items[0].id, 'codex:x');
  const [match] = result.items[0].matches;
  assert.match(match.text, /unique restart marker/);
  assert.equal(match.eventIndex, 3);
  const evidence = await query('focus_read_session', { sessionId: 'codex:x', startEventIndex: match.eventIndex }, exec);
  assert.equal(evidence.items[0].eventIndex, match.eventIndex);
});

test('bounded activity pages keep full-range totals and unbounded tag searches work', async () => {
  const f = fixture();
  const tools = createContextTools(f.source, { bound: { start: 0, end: null, tags: ['source:codex'] }, resultLimit: 12000 });
  const listed = JSON.parse(await tools[0].execute({}, exec));
  assert.equal(listed.total, 1);
  assert.equal(listed.range.end, null);
  const args = { start: '2026-01-01T00:00:00Z', end: '2027-01-01T00:00:00Z' };
  const text = await tools[2].execute(args, exec);
  const first = JSON.parse(text);
  assert.ok(text.length <= 12000);
  assert.ok(first.nextCursor);
  assert.equal(first.totalDays, 365);
  assert.equal(first.total, 1);
  assert.equal(first.totalSessions, 1);
  const next = JSON.parse(await tools[2].execute({ ...args, cursor: first.nextCursor, limit: 1 }, exec));
  assert.equal(next.pageOffset, first.days.length);
  assert.equal(next.days.length, 1);
  assert.equal(next.total, first.total);
});

test('native Ask conversations are excluded from search, raw reads and activity', async () => {
  const f = fixture();
  const query = createContextQueries(f.source, { excludedSessions: async () => new Set(['codex:x']) });
  const listed = await query('focus_list_sessions', {}, exec);
  assert.deepEqual(listed.items.map(item => item.id), ['outside']);
  await assert.rejects(query('focus_read_session', { sessionId: 'codex:x' }, exec), /outside the historical search/);
  const counts = await query('focus_activity', { start: '2026-10-29T00:00:00Z', end: '2026-10-30T00:00:00Z' }, exec);
  assert.equal(counts.totalSessions, 1);
  assert.equal(counts.total, 1);
});

test('workspace, source, time, cursor and cancellation boundaries',async()=>{
  const f=fixture(); const query=createContextQueries(f.source);
  // No caller workspace is needed: the query is not tied to where it is asked from.
  assert.equal((await query('focus_list_sessions',{},{})).total,2);
  assert.equal((await query('focus_list_sessions',{sources:['codex']},exec)).total,1);
  assert.equal((await query('focus_list_sessions',{sources:['claude']},exec)).total,0);
  await assert.rejects(query('focus_list_sessions',{sources:['other']},exec),/Invalid sources/);
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

test('a window bounds every query, and a range wholly outside it is refused', async()=>{
  const f=fixture();
  const window={start:at-1000,end:at+1000};
  const query=createContextQueries(f.source,{bound:window});
  // A list with no dates at all still only covers the window.
  const listed=await query('focus_list_sessions',{},exec);
  assert.deepEqual(listed.range,window);
  // The model asking for something wider is clamped, not obeyed.
  const wide=await query('focus_list_sessions',{start:new Date(0).toISOString(),end:new Date(at+9e9).toISOString()},exec);
  assert.equal(wide.range.start,window.start);
  assert.equal(wide.range.end,window.end);
  // Reading a session only returns events inside the window.
  const read=await query('focus_read_session',{sessionId:'codex:x'},exec);
  assert.ok(read.items.length>0);
  assert.equal(read.range.start,window.start);
  // Wholly before the window: nothing to read, and it says so.
  await assert.rejects(query('focus_list_sessions',{start:'2020-01-01T00:00:00Z',end:'2020-02-01T00:00:00Z'},exec),/outside the window/);
  // No window means everything still works.
  const open=await createContextQueries(f.source)('focus_list_sessions',{},exec);
  assert.equal(open.range.start,0);
  assert.equal(open.range.end,null);
});
