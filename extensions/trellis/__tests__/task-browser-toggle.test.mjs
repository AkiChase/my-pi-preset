import './host-env.mjs';
import assert from 'node:assert/strict';
import test from 'node:test';
import { registerTaskBrowserCommand } from '../lib/task-browser/command.ts';

const PRESS = '\x1b[116;6u';
const REPEAT = '\x1b[116;6:2u';
const RELEASE = '\x1b[116;6:3u';
const KEY = 'trellis-task-viewer';
const tick = () => new Promise(resolve => setImmediate(resolve));
function deferred() {
 let resolve, reject;
 const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
 return { promise, resolve, reject };
}

// Fake-pi/handle logic only: no real TUI, layout, component rendering or overlay mounting.
function harness(t, options = {}) {
 const commands = new Map(), listeners = new Set(), statuses = new Map(), notices = [], messages = [], jobs = [], components = [];
 let id = 'session-1', root = '/fake/project', focus = {}, loads = 0, subscriptions = 0;
 const h = { commands, listeners, statuses, notices, messages, jobs, components, holdFactory: false, holdHandle: false, holdSettlement: false };
 const manager = { getSessionId: () => id };
 const ctx = { mode: 'tui', hasUI: true, cwd: root, sessionManager: manager, ui: {
  theme: {},
  notify(text) { notices.push(text); options.onNotice?.(text); },
  setStatus(key, value) { if(value === undefined)statuses.delete(key);else statuses.set(key,value);options.onStatus?.(key,value); },
  onTerminalInput(listener) {
   subscriptions++;
   listeners.add(listener);
   options.onSubscribe?.();
   return () => { listeners.delete(listener); options.onUnsubscribe?.(); };
  },
  custom(factory, customOptions) {
   const settled = deferred();
   const job = { factory, options: customOptions, settled, closed: false, component: undefined, handle: undefined, doneCalls: 0, changes: [], focuses: 0 };
   jobs.push(job);
   const done = () => {
    if(job.closed)return;
    job.doneCalls++;job.closed = true;
    job.component?.dispose();
    if(!h.holdSettlement)settled.resolve();
   };
   job.done = done;
   job.deliverHandle = () => job.options.onHandle(job.handle);
   job.deliverFactory = async () => {
    const component = await factory({}, {}, {}, done);
    if(job.closed)return;
    job.component = component;
    let hidden = false;
    job.handle = {
     setHidden(value) { hidden = value; job.changes.push(value); if(!value)focus = component;options.onHidden?.(value); },
     isHidden: () => hidden,
     isFocused: () => focus === component,
     focus() { job.focuses++;focus = component; },
     hide() { assert.fail('Never remove a custom overlay through handle.hide'); },
    };
    if(options.missingHandle)delete job.handle[options.missingHandle];
    focus = component;
    if(!h.holdHandle)job.deliverHandle();
   };
   if(!h.holdFactory)void job.deliverFactory().catch(error=>settled.reject(error));
   return settled.promise;
  },
 } };
 if(options.noListener)delete ctx.ui.onTerminalInput;
 const owner = registerTaskBrowserCommand({ registerCommand: (name, command) => commands.set(name,command), sendMessage: message => messages.push(message) }, {
  findRoot: () => { options.onRoot?.();if(root instanceof Error)throw root;return root; }, currentTask: () => undefined,
 }, {
  loadLayout: () => { loads++;return options.loadLayout?.() ?? Promise.resolve({}); },
  createComponent(args) {
   const component = { args, disposals: 0, reading: {}, dispose() { this.disposals++;options.onDispose?.(); }, render() { assert.fail('No rendering in Trellis logic tests'); }, invalidate() {} };
   components.push(component);options.onCreate?.();return component;
  },
 });
 Object.assign(h,{ owner, ctx, setId: value => { id=value; }, setRoot: value => { root=value; }, stealFocus: () => { focus={}; },
  input(data=PRESS) { let result;for(const listener of listeners){result=listener(data);if(result?.consume)break;}return result; },
  command: (args='', context=ctx) => commands.get(KEY).handler(args,context),
  get loads() { return loads; },
 });
 Object.defineProperty(h,'loads',{get:()=>loads});
 Object.defineProperty(h,'subscriptions',{get:()=>subscriptions});
 owner.start(ctx);
 t.after(() => { owner.close();for(const job of jobs)job.settled.resolve(); });
 return h;
}

test('session key opens from idle, hides and restores the identical interaction across foreign focus', async t => {
 const h=harness(t);
 assert.equal(h.listeners.size,1);
 assert.deepEqual(h.input(),{consume:true});await tick();
 const job=h.jobs[0],component=h.components[0],reading=component.reading;
 assert.equal(h.jobs.length,1);assert.equal(component.args.hideHint,'Ctrl+Shift+T Hide');
 assert.deepEqual(h.input(),{consume:true});
 assert.deepEqual(job.changes,[true]);assert.match(h.statuses.get(KEY),/Ctrl\+Shift\+T to restore/);
 h.stealFocus();h.input();
 assert.deepEqual(job.changes,[true,false]);assert.equal(h.statuses.size,0);
 assert.equal(h.components[0],component);assert.equal(component.reading,reading);assert.equal(component.disposals,0);
 assert.equal(h.jobs.length,1);assert.equal(job.doneCalls,0);
});

test('cold open and foreground promotion work independently of editor shortcut handlers', async t => {
 const h=harness(t);h.stealFocus();h.input();await tick();
 const job=h.jobs[0];h.stealFocus();h.input();
 assert.equal(job.focuses,1);assert.deepEqual(job.changes,[]);assert.equal(job.doneCalls,0);
 assert.equal(h.jobs.length,1);
});

test('command reuses current or hidden browser; complete close opens a fresh instance and keeps session listener', async t => {
 const h=harness(t);const first=h.command();await tick();
 const job=h.jobs[0];await h.command();assert.equal(job.focuses,1);
 h.input();await h.command();assert.deepEqual(job.changes,[true,false]);assert.equal(h.jobs.length,1);
 h.components[0].args.done();await first;
 assert.equal(h.components[0].disposals,1);assert.equal(h.listeners.size,1);
 h.input();await tick();assert.equal(h.jobs.length,2);assert.notEqual(h.components[0],h.components[1]);
 assert.equal(h.statuses.size,0);
});

test('ordinary input, Escape, Ctrl+C and legacy Ctrl+T are never consumed', async t => {
 const h=harness(t);h.input();await tick();h.input();
 for(const data of ['text','\x1b','\x03','\x14','\x1b[A'])assert.equal(h.input(data),undefined);
 assert.deepEqual(h.jobs[0].changes,[true]);assert.equal(h.jobs[0].closed,false);
});

test('Kitty release/repeat never open, toggle or immediately reopen on a held key', async t => {
 const h=harness(t);
 for(const data of [REPEAT,RELEASE])assert.deepEqual(h.input(data),{consume:true});
 assert.equal(h.jobs.length,0);
 h.input();await tick();h.input();
 for(const data of [REPEAT,RELEASE])h.input(data);
 assert.deepEqual(h.jobs[0].changes,[true]);
});

test('opening reentry shares admission without queuing a hide or duplicate custom call', async t => {
 const layout=deferred(),h=harness(t,{loadLayout:()=>layout.promise});
 const first=h.command(),second=h.command();h.input();h.input(REPEAT);
 assert.equal(h.loads,1);assert.equal(h.jobs.length,0);
 layout.resolve({});await tick();assert.equal(h.jobs.length,1);assert.deepEqual(h.jobs[0].changes,[]);
 h.components[0].args.done();await Promise.all([first,second]);
});

test('retirement during layout loading prevents late mount and settles the command promptly', async t => {
 const layout=deferred(),h=harness(t,{loadLayout:()=>layout.promise});
 const command=h.command();h.owner.close();await command;
 assert.equal(h.listeners.size,0);layout.resolve({});await tick();assert.equal(h.jobs.length,0);
});

test('retirement before delayed factory delivery completes the old custom without making a component', async t => {
 const h=harness(t);h.holdFactory=true;
 const command=h.command();await tick();h.owner.close();await command;
 await h.jobs[0].deliverFactory();assert.equal(h.components.length,0);assert.equal(h.jobs[0].doneCalls,1);
});

test('retirement with delayed onHandle cannot revive the old interaction or erase a fresh hidden status', async t => {
 const h=harness(t);h.holdHandle=true;
 const command=h.command();await tick();const old=h.jobs[0];
 h.owner.close();await command;h.holdHandle=false;h.setId('session-2');h.owner.start(h.ctx);
 h.input();await tick();h.input();const status=h.statuses.get(KEY);
 old.deliverHandle();assert.deepEqual(old.changes,[]);assert.equal(h.statuses.get(KEY),status);
 assert.equal(h.jobs[1].closed,false);
});

test('late custom settlement cannot remove the next admission, listener or hidden status', async t => {
 const h=harness(t);h.holdSettlement=true;
 const first=h.command();await tick();const old=h.jobs[0];
 h.components[0].args.done();await first;
 h.input();await tick();h.input();const status=h.statuses.get(KEY);
 old.settled.resolve();await tick();assert.equal(h.statuses.get(KEY),status);assert.equal(h.listeners.size,1);
 h.input();assert.deepEqual(h.jobs[1].changes,[true,false]);
});

test('manager replacement at same root retires the old listener, component and hidden prompt', async t => {
 const h=harness(t);h.input();await tick();h.input();
 const oldListener=[...h.listeners][0];
 const fresh={...h.ctx,sessionManager:{getSessionId:()=> 'session-1'}};
 h.owner.start(fresh);
 assert.equal(h.listeners.size,1);assert.equal(h.jobs[0].closed,true);assert.equal(h.statuses.size,0);
 assert.equal(oldListener(PRESS),undefined);
 h.input();await tick();assert.equal(h.jobs.length,2);
 await h.command('',h.ctx);assert.equal(h.jobs[1].closed,false,'stale commands must not close a fresh browser');
});

test('changed session ID gates old keys until start; run signal abort is not session retirement', async t => {
 const h=harness(t);const controller=new AbortController();h.ctx.signal=controller.signal;
 h.input();await tick();controller.abort();h.input();assert.deepEqual(h.jobs[0].changes,[true]);
 h.setId('session-2');assert.equal(h.input(),undefined);
 h.owner.start(h.ctx);assert.equal(h.jobs[0].closed,true);h.input();await tick();assert.equal(h.jobs.length,2);
});

test('layout and component construction failures release admission, so reopening succeeds', async t => {
 let fail=true;
 const h=harness(t,{loadLayout:()=>fail?Promise.reject(new Error('layout failed')):Promise.resolve({})});
 await h.command();assert.equal(h.jobs.length,0);assert.match(h.notices.at(-1),/unavailable/);
 fail=false;h.input();await tick();assert.equal(h.jobs.length,1);
 const other=harness(t,{onCreate:()=>{throw new Error('component failed');}});
 await other.command();assert.match(other.notices.at(-1),/unavailable/);assert.equal(other.jobs[0].closed,true);
});

test('component creation reentry disposes the late component exactly once', async t => {
 let owner;
 const h=harness(t,{onCreate:()=>owner.close()});owner=h.owner;
 await h.command();await tick();assert.equal(h.components[0].disposals,1);assert.equal(h.jobs[0].closed,true);
});

test('missing listener retains the command close path without advertising a hiding shortcut', async t => {
 const h=harness(t,{noListener:true});const command=h.command();await tick();
 assert.equal(h.components[0].args.hideHint,undefined);assert.match(h.notices.at(-1),/shortcut unavailable/);
 h.components[0].args.done();await command;assert.equal(h.statuses.size,0);
});

for(const method of ['focus','setHidden','isHidden','isFocused'])test(`missing ${method} refuses safely instead of hiding irreversibly`,async t => {
 const h=harness(t,{missingHandle:method});await h.command();await tick();
 assert.equal(h.jobs[0].closed,true);assert.match(h.notices.at(-1),/visibility\/focus controls/);
 assert.equal(h.components[0].disposals,1);assert.equal(h.listeners.size,1);
});

test('sink failures and unsubscribe failure do not prevent completion or make retired listeners live', async t => {
 const h=harness(t,{onStatus:()=>{throw new Error('status sink');},onUnsubscribe:()=>{throw new Error('unsubscribe');},onNotice:()=>{throw new Error('notice');},onDispose:()=>{throw new Error('dispose');}});
 const command=h.command();await tick();h.input();const oldListener=[...h.listeners][0];
 h.owner.close();h.owner.close();await command;
 assert.equal(h.components[0].disposals,1);assert.equal(h.jobs[0].closed,true);assert.equal(h.statuses.size,0);
 assert.equal(oldListener(PRESS),undefined);
});

test('input subscription reentry cannot leak an active listener after retirement', t => {
 let owner;
 const h=harness(t);owner=h.owner;owner.close();
 h.ctx.ui.onTerminalInput=listener=>{h.listeners.add(listener);owner.close();return()=>h.listeners.delete(listener);};
 owner.start(h.ctx);assert.equal(h.listeners.size,0);
});

test('host disposal and component unavailable callback complete only the owned interaction',async t => {
 const h=harness(t);const first=h.command();await tick();h.jobs[0].component.dispose();await first;
 assert.equal(h.components[0].disposals,1);h.input();await tick();
 h.components[1].args.unavailable(new Error('bounded layout failed'));await tick();
 assert.equal(h.jobs[1].closed,true);assert.equal(h.listeners.size,1);assert.match(h.notices.at(-1),/bounded layout failed/);
});

test('runtime/project validation rejects restoration, but unrelated input remains untouched',async t => {
 const h=harness(t);h.input();await tick();h.input();h.setRoot(new Error('runtime invalid'));
 h.input();assert.equal(h.jobs[0].closed,true);assert.equal(h.statuses.size,0);assert.match(h.notices.at(-1),/runtime invalid/);
 assert.equal(h.input('plain'),undefined);
 h.setRoot('/another/project');h.input();await tick();assert.equal(h.jobs.length,1);
});

test('command refusal notices tolerate UI and non-UI sink failures without opening',async t => {
 const h=harness(t,{onNotice:()=>{throw new Error('notice failed');}});
 await assert.doesNotReject(h.command('unexpected'));
 await assert.doesNotReject(h.command('',{...h.ctx,mode:'rpc'}));
 h.setRoot(new Error('runtime invalid'));await assert.doesNotReject(h.command());
 h.setRoot(undefined);await assert.doesNotReject(h.command());
 const noUI={...h.ctx,hasUI:false,mode:'print'};
 const owner=registerTaskBrowserCommand({registerCommand:(name,command)=>h.commands.set(name,command),sendMessage:()=>{throw new Error('message failed');}}, {
  findRoot:()=>undefined,currentTask:()=>undefined,
 });
 t.after(()=>owner.close());
 await assert.doesNotReject(h.command('',noUI));assert.equal(h.jobs.length,0);
});

test('command runtime failure and missing root retire a hidden interaction through shared admission',async t => {
 const h=harness(t);h.input();await tick();h.input();
 h.setRoot(new Error('runtime invalid'));await h.command();
 assert.equal(h.jobs[0].closed,true);assert.equal(h.statuses.size,0);
 h.setRoot('/fake/project');h.input();await tick();h.input();
 h.setRoot(undefined);await h.command();assert.equal(h.jobs[1].closed,true);assert.equal(h.statuses.size,0);
});

test('synchronous restore during hide cannot leave a hidden hint on a visible browser',async t => {
 let h, once=true;
 h=harness(t,{onHidden:value=>{if(value&&once){once=false;void h.command();}}});
 h.input();await tick();h.input();
 assert.equal(h.jobs[0].handle.isHidden(),false);assert.equal(h.statuses.size,0);
 assert.deepEqual(h.jobs[0].changes,[true,false]);
});

test('a newer synchronous hide during restore retains its own hidden hint',async t => {
 let h, reenter=false;
 h=harness(t,{onHidden:value=>{if(!value&&reenter){reenter=false;h.input();}}});
 h.input();await tick();h.input();reenter=true;h.input();
 assert.equal(h.jobs[0].handle.isHidden(),true);assert.match(h.statuses.get(KEY),/to restore/);
 assert.deepEqual(h.jobs[0].changes,[true,false,true]);
});

test('unsupported modes, missing project and command arguments keep existing refusal behavior',async t => {
 const h=harness(t);await h.command('unexpected');assert.match(h.notices.at(-1),/Usage/);
 for(const mode of ['rpc','print','json'])await h.command('',{...h.ctx,mode});
 assert.match(h.notices.at(-1),/interactive terminal/);
 h.setRoot(undefined);await h.command();assert.match(h.notices.at(-1),/No Trellis project/);assert.equal(h.jobs.length,0);
 h.owner.close();h.owner.start({...h.ctx,mode:'rpc'});assert.equal(h.listeners.size,0);
});
