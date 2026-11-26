import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { normalizeSettings } from '../lib/settings.mjs';
import { normalizeInterfacePreferences, sidebarFontCss } from '../lib/interface-preferences.mjs';

const source = fs.readFileSync(process.env.FOCUSING_CLIENT_FILE || new URL('../lib/client.js', import.meta.url), 'utf8');
function harness() {
  let definition, Workbench;
  const mounted = new Map(), mountedById = new Map(), cleanup = [], storage = new Map(), dictionary = {}, opened = [];
  const hooks = []; let index = 0, effectIndex = 0; const effectDeps = [], effectCleanup = [], pending = [];
  const React = {
    createElement: (type, props, ...children) => ({ type, props: props || {}, children }), Fragment: 'Fragment',
    useState: initial => { const i=index++; if (!(i in hooks)) hooks[i]=typeof initial==='function'?initial():initial; return [hooks[i], value => { hooks[i]=typeof value==='function'?value(hooks[i]):value; }]; },
    useRef: initial => { const i=index++; return hooks[i] ??= { current: initial }; },
    useEffect: (fn, deps) => { const i=effectIndex++; if (!effectDeps[i] || deps.some((v,j)=>v!==effectDeps[i][j])) { effectDeps[i]=deps; pending.push(()=>{effectCleanup[i]?.();effectCleanup[i]=fn();}); } },
  };
  vm.runInNewContext(source, { window: { __ModuleLoader__: {load:d=>definition=d}, localStorage: {getItem:k=>storage.get(k),setItem:(k,v)=>storage.set(k,v)}, addEventListener(){},removeEventListener(){} }, console, AbortController, URLSearchParams, setTimeout,clearTimeout,fetch:async()=>({json:async()=>({ok:true,settings:{}})}) });
  const api=definition.factory(()=>React);
  api.apply({get:n=>n==='uiWorkspace'?{openSession:id=>opened.push(id)}:undefined,
    effect:fn=>{const dispose=fn();if(typeof dispose==='function')cleanup.push(dispose);return dispose;},
    locale:{bind:()=>k=>dictionary[k]||k,register:(_ns,lang,dict)=>{if(lang==='zh')Object.assign(dictionary,dict);return()=>{};},subscribe:()=>()=>{}},
    slots:{inject:(_name,fn)=>{const dispose=fn();if(typeof dispose==='function')cleanup.push(dispose);return dispose;},register:(options,component)=>{const entry={options,component};mounted.set(options.name,entry);mountedById.set(options.id||options.key||options.name,entry);if(options.name==='focusing.panel.body')Workbench=component;return()=>{mountedById.delete(options.id||options.key||options.name);if(mounted.get(options.name)===entry)mounted.delete(options.name);};}},
  });
  return { Workbench, mounted, mountedById, opened, storage, dictionary, hooks,
    render:(component,props,attach)=>{index=0;effectIndex=0;const tree=component(props);attach?.(tree);while(pending.length)pending.shift()();return tree;},
    dispose:()=>{effectCleanup.forEach(fn=>fn?.());cleanup.reverse().forEach(fn=>fn());},
  };
}
function nodes(node,predicate,out=[]) { if(Array.isArray(node))node.forEach(n=>nodes(n,predicate,out));else if(node&&typeof node==='object'){if(predicate(node))out.push(node);nodes(node.children||[],predicate,out);}return out; }

test('interface settings default off, persist independently, and sanitize size',()=>{
  assert.deepEqual(normalizeInterfacePreferences(),{sidebarFontEnabled:false,sidebarFontSize:14,recentTabsEnabled:false});
  const saved=normalizeSettings({sidebarFontEnabled:true,sidebarFontSize:18,recentTabsEnabled:true});
  assert.equal(saved.sidebarFontSize,18);assert.equal(saved.recentTabsEnabled,true);
  const disabled=normalizeSettings({...saved,sidebarFontEnabled:false});
  assert.equal(disabled.sidebarFontEnabled,false);assert.equal(disabled.recentTabsEnabled,true);assert.equal(disabled.sidebarFontSize,18);
  assert.equal(normalizeSettings({sidebarFontSize:999}).sidebarFontSize,20);
  assert.equal(normalizeSettings({sidebarFontSize:NaN,sidebarFontEnabled:'true'}).sidebarFontSize,14);
});
test('saved checkbox values mount only their own feature and unload removes both',()=>{
  const env=harness(), f=env.Workbench.interfaceFeatures;
  assert.equal(env.mountedById.has('focusing-sidebar-font'),false);
  assert.equal(env.mounted.has('conversation.header.leading'),false);
  f.accept({sidebarFontEnabled:true,sidebarFontSize:18});
  assert.equal(env.mountedById.has('focusing-sidebar-font'),true);assert.equal(env.mounted.has('conversation.header.leading'),false);
  assert.match(env.mountedById.get('focusing-sidebar-font').component().children.join(''),/font-size: 18px/);
  f.accept({recentTabsEnabled:true});
  assert.equal(env.mountedById.has('focusing-sidebar-font'),false);assert.equal(env.mounted.has('conversation.header.leading'),true);
  f.accept({});assert.equal(env.mounted.has('conversation.header.leading'),false);
  f.accept({recentTabsEnabled:true,sidebarFontEnabled:true});env.dispose();
  assert.equal(env.mountedById.has('focusing-sidebar-font'),false);assert.equal(env.mounted.has('conversation.header.leading'),false);
});
test('native chrome launcher toggles between the current session and Focusing',()=>{
  const env=harness();const entry=env.mountedById.get('focusing-window-launcher');
  assert.ok(entry);let panel=null,opened=0,returned=0;
  const props={...entry.options.inject(),usePanelInfo:f=>f({activePanelId:panel}),open:()=>{opened++;panel='focusing';},back:()=>{returned++;panel=null;}};
  const render=()=>env.render(entry.component,props);
  let tree=render();let button=nodes(tree,n=>n.props.className==='focusing-window-launcher')[0];
  assert.equal(button.props.title,'Focusing');button.props.onClick();assert.equal(opened,1);
  tree=render();button=nodes(tree,n=>n.props.className==='focusing-window-launcher')[0];
  assert.equal(button.props.title,'返回会话');assert.equal(button.children[0].type.name,'UndoIcon');button.props.onClick();assert.equal(returned,1);
  tree=render();button=nodes(tree,n=>n.props.className==='focusing-window-launcher')[0];assert.equal(button.props.title,'Focusing');
  const css=nodes(tree,n=>n.type==='style')[0].children.join('');
  assert.match(css,/left:var\(--dsh-frame-leading-clearance,84px\)/);
  assert.match(css,/div:has\(> \[data-shell-leading\]\) \.focusing-window-launcher\{display:flex\}/);
  env.dispose();assert.equal(env.mountedById.has('focusing-window-launcher'),false);
});
test('browser adapter stays identical to backend normalization and scoped CSS',()=>{
  const env=harness(), f=env.Workbench.interfaceFeatures;
  for(const value of [{},{sidebarFontSize:18.5},{sidebarFontSize:Infinity},{sidebarFontEnabled:'true',recentTabsEnabled:true}])assert.equal(JSON.stringify(f.normalize(value)),JSON.stringify(normalizeInterfacePreferences(value)));
  for(const size of [12,14,20,Infinity])assert.equal(f.sidebarFontCss(size),sidebarFontCss(size));
  assert.doesNotMatch(sidebarFontCss(18),/\bbody\b|html\s*\{/);
  assert.match(sidebarFontCss(18),/\.kB3qhq_root \.JoiKIa_title/);
});
test('sidebar navigation creates editor tabs immediately, without seeding history or evicting open tabs',()=>{
  const env=harness();env.Workbench.interfaceFeatures.accept({recentTabsEnabled:true});
  env.storage.set('dsh-focusing.recent-session-tabs.v1',JSON.stringify(['unopened']));
  const entry=env.mounted.get('conversation.header.leading');
  let list={phase:'pending',byId:{a:{title:'Alpha',retainedBy:{mainView:1}},unopened:{title:'Unopened'}}};
  const props={...entry.options.inject(),useSessions:selector=>selector(list)};
  const render=()=>{env.render(entry.component,props);return env.render(entry.component,props);};
  let tree=render();
  assert.deepEqual(nodes(tree,n=>n.props.className==='focusing-recent-open').map(n=>n.props.title),['Alpha']);
  for(let i=0;i<15;i++){
    const byId=Object.fromEntries(Object.entries(list.byId).map(([id,row])=>[id,{...row,retainedBy:{}}]));
    byId['s'+i]={title:'Session '+i,retainedBy:{mainView:1}};
    list={phase:'ready',byId};tree=render();
  }
  const buttons=nodes(tree,n=>n.props.className==='focusing-recent-open');
  assert.equal(buttons.length,16,'opening more than twelve sessions keeps earlier tabs');
  assert.equal(buttons[0].props.title,'Alpha');assert.equal(buttons.at(-1).props['aria-current'],'page');
  buttons[0].props.onClick();assert.deepEqual(env.opened,['a']);
  assert.equal(JSON.parse(env.storage.get('dsh-focusing.open-session-tabs.v2')).length,16);
});

test('topbar positioning does not depend on native conversation view tabs',()=>{
  const env=harness();env.Workbench.interfaceFeatures.accept({recentTabsEnabled:true});
  const entry=env.mounted.get('conversation.header.leading');
  const props={...entry.options.inject(),useSessions:f=>f({phase:'ready',byId:{}})};
  const tree=env.render(entry.component,props);
  const css=nodes(tree,n=>n.type==='style')[0].children.join('');
  assert.match(css,/header:has\(\[data-conversation-header-leading\] \.focusing-recent-seat\)\{padding-top:5px\}/);
  assert.equal(tree.props.className,'focusing-recent-seat','the header keeps a seat for the row');
  assert.equal(nodes(tree,n=>n.props.className==='focusing-recent-bar').length,1,'without a portal the bar stays inline');
  env.dispose();
});
test('the tab bar floats over the frame so the session right panel does not narrow it',()=>{
  assert.match(source,/\.focusing-recent-bar\[data-floating\]\{position:absolute;right:0;/,'the floating bar runs to the window edge');
  assert.match(source,/html\[data-focusing-tabs-floating\] \[data-rightbar-col\] \[data-sidebar-right-panel='push'\]\{top:var\(--focusing-tabs-bottom,0px\)\}/,'the docked right panel starts below the bar');
  assert.match(source,/querySelector\?\.\(':scope > \[data-shell-overlay\]'\)/,'the bar is placed in the frame overlay layer');
  assert.match(source,/root\.removeAttribute\('data-focusing-tabs-floating'\)/,'unmounting restores the right panel');
});
test('closing the active tab selects its neighbour; closing the last returns to Focusing',()=>{
  const env=harness();env.storage.set('dsh-focusing.open-session-tabs.v2',JSON.stringify(['a','b']));
  env.Workbench.interfaceFeatures.accept({recentTabsEnabled:true});
  const entry=env.mounted.get('conversation.header.leading');let panel=null,closedLast=0;
  let list={phase:'ready',byId:{a:{title:'Alpha'},b:{title:'Beta',retainedBy:{mainView:1}}}};
  const props={...entry.options.inject(),closeLast:()=>{closedLast++;panel='focusing';},usePanelInfo:f=>f({activePanelId:panel}),useSessions:f=>f(list)};
  const render=()=>{env.render(entry.component,props);return env.render(entry.component,props);};
  let tree=render();nodes(tree,n=>n.props.className==='focusing-recent-close')[1].props.onClick();
  assert.deepEqual(env.opened,['a']);assert.equal(list.byId.b.title,'Beta');
  list={phase:'ready',byId:{a:{title:'Alpha',retainedBy:{mainView:1}},b:{title:'Beta'}}};
  tree=render();nodes(tree,n=>n.props.className==='focusing-recent-close')[0].props.onClick();
  tree=render();assert.equal(closedLast,1);assert.equal(nodes(tree,n=>n.props.className==='focusing-recent-open').length,0);
  panel=null;tree=render();assert.deepEqual(nodes(tree,n=>n.props.className==='focusing-recent-open').map(n=>n.props.title),['Alpha'],'same session reopens after returning from the home panel');
});
test('interface settings use independent checkboxes and show the size only when checked',()=>{
  const env=harness();
  // SettingsDialog starts with locale tick, selected page, saved settings and edit state.
  env.hooks.push(0,'interface',{sidebarFontEnabled:false,sidebarFontSize:14,recentTabsEnabled:false},null);
  const props={t:k=>env.dictionary[k]||k,subscribeLocale:()=>()=>{},open:false};
  let tree=env.render(env.Workbench.SettingsDialog,props);
  let checks=nodes(tree,n=>n.type==='input'&&n.props.type==='checkbox');
  assert.equal(checks.length,2);assert.equal(checks[0].props.checked,false);assert.equal(checks[1].props.checked,false);
  assert.equal(nodes(tree,n=>n.props.type==='range').length,0);
  checks[0].props.onChange({target:{checked:true}});tree=env.render(env.Workbench.SettingsDialog,props);
  assert.equal(nodes(tree,n=>n.props.type==='range').length,1);
  checks=nodes(tree,n=>n.type==='input'&&n.props.type==='checkbox');assert.equal(checks[1].props.checked,false);
});

test('subagents and archived sessions are excluded from restored and current tabs without seeding history',()=>{
  for(const cached of [[],['child','orphan','activeChild','old']]){
    const env=harness();
    env.storage.set('dsh-focusing.open-session-tabs.v2',JSON.stringify([...cached,...(cached.length?['archived']:[])]));
    env.Workbench.interfaceFeatures.accept({recentTabsEnabled:true});
    const entry=env.mounted.get('conversation.header.leading');
    const list={phase:'ready',byId:{
      child:{title:'Child',parentId:'old',updatedAt:90},
      orphan:{title:'Orphan',origin:'subagent',updatedAt:100},
      activeChild:{title:'Active child',parentId:'old',retainedBy:{mainView:1},updatedAt:110},
      old:{title:'Old',updatedAt:10},recent:{title:'Recent',updatedAt:20},
      archived:{title:'Archived',updatedAt:120},
    }};
    const props={...entry.options.inject(),useWorkspaces:f=>f({archivedSessionIds:['archived']}),useSessions:selector=>selector(list)};
    const first=env.render(entry.component,props);
    assert.equal(nodes(first,n=>n.props.className==='focusing-recent-open').some(n=>/Child|Orphan|Active child/.test(n.props.title)),false,'no cached child flashes before cleanup');
    const tree=env.render(entry.component,props);
    const buttons=nodes(tree,n=>n.props.className==='focusing-recent-open');
    assert.deepEqual(buttons.map(n=>n.props.title),cached.length?['Old']:[]);
    assert.ok(buttons.every(n=>n.props['aria-current']===undefined));
    assert.deepEqual(JSON.parse(env.storage.get('dsh-focusing.open-session-tabs.v2')),cached.length?['old']:[]);
    env.dispose();
  }
});

test('horizontal navigation has no arrow buttons and preserves wheel, trackpad and zoom gestures',()=>{
  const env=harness();env.Workbench.interfaceFeatures.accept({recentTabsEnabled:true});
  const entry=env.mounted.get('conversation.header.leading');
  const list={phase:'ready',byId:{a:{title:'Alpha'},b:{title:'Beta'}}};
  const props={...entry.options.inject(),useSessions:selector=>selector(list)};
  const listeners=new Map();
  const rail={scrollLeft:0,scrollWidth:900,clientWidth:300,children:[],querySelector:()=>null,
    addEventListener:(name,fn,options)=>{listeners.set(name,fn);if(name==='wheel')assert.equal(options.passive,false);},
    removeEventListener:(name,fn)=>{if(listeners.get(name)===fn)listeners.delete(name);}};
  const attach=tree=>{nodes(tree,n=>n.props.className==='focusing-recent-track')[0].props.ref.current=rail;};
  const render=()=>env.render(entry.component,props,attach);
  render();let tree=render();
  assert.equal(nodes(tree,n=>n.props.className==='focusing-recent-scroll').length,0);
  assert.match(nodes(tree,n=>n.type==='style')[0].children.join(''),/scrollbar-width:none/);
  let prevented=0;
  const wheel=values=>listeners.get('wheel')({deltaX:0,deltaY:80,deltaMode:0,ctrlKey:false,preventDefault:()=>prevented++,...values});
  wheel({});assert.equal(rail.scrollLeft,80);assert.equal(prevented,1);
  wheel({deltaMode:1,deltaY:2});assert.equal(rail.scrollLeft,112);
  wheel({deltaX:100,deltaY:1});assert.equal(rail.scrollLeft,112,'native horizontal gesture is left to browser');
  wheel({ctrlKey:true});assert.equal(rail.scrollLeft,112,'pinch/zoom is not hijacked');
  wheel({deltaMode:2,deltaY:1});assert.equal(rail.scrollLeft,412);
  wheel({deltaY:999});assert.equal(rail.scrollLeft,600);
  const atEnd=prevented;wheel({});assert.equal(prevented,atEnd,'vertical page scroll is released at the boundary');
  env.dispose();assert.equal(listeners.size,0,'native listeners are released on unmount');
});

test('restored tabs survive initial loading and follow workspace archive changes independently',()=>{
  const env=harness();env.storage.set('dsh-focusing.open-session-tabs.v2',JSON.stringify(['a','b']));
  env.Workbench.interfaceFeatures.accept({recentTabsEnabled:true});
  const entry=env.mounted.get('conversation.header.leading');
  let list={phase:'pending',byId:{}};let archived=[];
  const props={...entry.options.inject(),useSessions:f=>f(list),useWorkspaces:f=>f({archivedSessionIds:archived})};
  const render=()=>{env.render(entry.component,props);return env.render(entry.component,props);};
  render();assert.deepEqual(JSON.parse(env.storage.get('dsh-focusing.open-session-tabs.v2')),['a','b']);
  list={phase:'ready',byId:{a:{title:'Alpha'},b:{title:'Beta'}}};
  let tree=render();assert.equal(nodes(tree,n=>n.props.className==='focusing-recent-open').length,2);
  archived=['b'];tree=render();
  assert.deepEqual(nodes(tree,n=>n.props.className==='focusing-recent-open').map(n=>n.props.title),['Alpha']);
  assert.deepEqual(JSON.parse(env.storage.get('dsh-focusing.open-session-tabs.v2')),['a']);
});

test('an oversized active title starts at its beginning and manual scrolling stays put',()=>{
  const env=harness();env.Workbench.interfaceFeatures.accept({recentTabsEnabled:true});
  const entry=env.mounted.get('conversation.header.leading');
  const title='A complete session title '.repeat(20);
  const list={phase:'ready',byId:{a:{title,retainedBy:{mainView:1}}}};
  const props={...entry.options.inject(),useSessions:f=>f(list)};
  const rail={scrollLeft:0,clientWidth:300,scrollWidth:1300,children:[],addEventListener(){},removeEventListener(){},querySelector:()=>({offsetLeft:100,offsetWidth:1000})};
  const render=()=>env.render(entry.component,props,tree=>{nodes(tree,n=>n.props.className==='focusing-recent-track')[0].props.ref.current=rail;});
  render();let tree=render();
  assert.equal(rail.scrollLeft,100,'activation exposes the start, not the end, of a long title');
  assert.equal(nodes(tree,n=>n.props.className==='focusing-recent-open')[0].children[0],title);
  rail.scrollLeft=650;tree=render();
  assert.equal(rail.scrollLeft,650,'ordinary renders do not undo the user’s horizontal scroll');
  env.dispose();
});

test('running labels and unread completion dots follow actual session activity and viewing',()=>{
  const env=harness();env.storage.set('dsh-focusing.open-session-tabs.v2',JSON.stringify(['a','b']));
  env.Workbench.interfaceFeatures.accept({recentTabsEnabled:true});
  const entry=env.mounted.get('conversation.header.leading');
  let list={phase:'ready',byId:{a:{title:'Alpha',running:true,retainedBy:{mainView:1}},b:{title:'Beta',running:true}}};
  const props={...entry.options.inject(),useSessions:f=>f(list)};
  const render=()=>{env.render(entry.component,props);return env.render(entry.component,props);};
  let tree=render();assert.equal(nodes(tree,n=>n.props.className==='focusing-recent-running').length,2);
  assert.equal(nodes(tree,n=>n.props.className==='focusing-recent-unread').length,0);
  list={phase:'ready',byId:{a:{title:'Alpha',running:false,retainedBy:{mainView:1}},b:{title:'Beta',running:false}}};
  tree=render();const dots=nodes(tree,n=>n.props.className==='focusing-recent-unread');
  assert.equal(dots.length,1,'only the offscreen completion is unread');assert.equal(dots[0].props.title,'运行完成，尚未查看');
  assert.deepEqual(JSON.parse(env.storage.get('dsh-focusing.session-tab-activity.v1')),{a:{running:false,unread:false},b:{running:false,unread:true}});
  list={phase:'ready',byId:{a:{title:'Alpha',running:false},b:{title:'Beta',running:false,retainedBy:{mainView:1}}}};
  tree=render();assert.equal(nodes(tree,n=>n.props.className==='focusing-recent-unread').length,0,'viewing clears the dot');
  assert.equal(JSON.parse(env.storage.get('dsh-focusing.session-tab-activity.v1')).b.unread,false);
  env.dispose();
});

test('pending human approval takes precedence over the running label',()=>{
  const env=harness();env.storage.set('dsh-focusing.open-session-tabs.v2',JSON.stringify(['a','b']));
  env.Workbench.interfaceFeatures.accept({recentTabsEnabled:true});
  const entry=env.mounted.get('conversation.header.leading');
  const list={phase:'ready',byId:{a:{title:'Alpha',running:true,retainedBy:{mainView:1}},b:{title:'Beta',running:true}}};
  let statuses=new Map([['b',{running:true,pendingInteraction:{kind:'approval',key:'approval:1',sessionId:'b'},completionUnread:false}]]);
  const props={...entry.options.inject(),useSessions:f=>f(list),useSessionStatus:f=>f(statuses)};
  const render=()=>{env.render(entry.component,props);return env.render(entry.component,props);};
  let tree=render();let badges=nodes(tree,n=>n.props.className==='focusing-recent-running focusing-recent-approval');
  assert.equal(badges.length,1);assert.equal(badges[0].children[0],'待批准');
  assert.equal(nodes(tree,n=>n.props.className==='focusing-recent-running').length,1);
  statuses=new Map();tree=render();
  assert.equal(nodes(tree,n=>n.props.className==='focusing-recent-running focusing-recent-approval').length,0);
  assert.equal(nodes(tree,n=>n.props.className==='focusing-recent-running').length,2);
  env.dispose();
});

test('a completion observed on reload remains unread until its tab is opened',()=>{
  const env=harness();env.storage.set('dsh-focusing.open-session-tabs.v2',JSON.stringify(['a']));
  env.storage.set('dsh-focusing.session-tab-activity.v1',JSON.stringify({a:{running:true,unread:false}}));
  env.Workbench.interfaceFeatures.accept({recentTabsEnabled:true});
  const entry=env.mounted.get('conversation.header.leading');
  let list={phase:'ready',byId:{a:{displayTitle:'Full fallback title',running:false}}};
  const props={...entry.options.inject(),useSessions:f=>f(list)};
  env.render(entry.component,props);let tree=env.render(entry.component,props);
  assert.equal(nodes(tree,n=>n.props.className==='focusing-recent-unread').length,1);
  assert.equal(nodes(tree,n=>n.props.className==='focusing-recent-open')[0].children[0],'Full fallback title');
  list={phase:'ready',byId:{a:{title:'Full fallback title',running:false,retainedBy:{mainView:1}}}};
  env.render(entry.component,props);tree=env.render(entry.component,props);
  assert.equal(nodes(tree,n=>n.props.className==='focusing-recent-unread').length,0);
  env.dispose();
});
