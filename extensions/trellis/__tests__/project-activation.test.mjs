import './host-env.mjs';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, symlinkSync, existsSync, chmodSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import test from 'node:test';
import trellis from '../index.ts';
import { discoverProject, initializationRoot, requireProjectRuntime } from '../lib/project-state.ts';
import { copyRuntimeFixture, mockPython } from './runtime-fixture.mjs';

// Supported projects are copies of one shared initialized project (runtime-fixture.mjs).
function fixture(t,runtime=false) {
 if(runtime)return copyRuntimeFixture(t);
 const root=mkdtempSync(join(tmpdir(),'pi-project-activation-'));t.after(()=>rmSync(root,{recursive:true,force:true}));return root;
}
function harness(root) {
 const commands=new Map(),tools=new Map(),handlers=new Map(),messages=[],notices=[],display={},publications=[];let subscriptions=0;
 trellis({registerMessageRenderer:()=>{},registerCommand:(n,c)=>commands.set(n,c),registerTool:t=>tools.set(t.name,t),events:{on:()=>{subscriptions++;return()=>{};},emit:(name,request)=>{if(name==='preset:widget-display:connect:v1')request.accept({set:content=>{publications.push(request.ctx);display.widget=content;return true;},dispose:()=>{display.widget=undefined;}});}},on:(n,h)=>{const previous=handlers.get(n);handlers.set(n,previous?async(...args)=>{await previous(...args);await h(...args);}:h);return()=>{};},getAllTools:()=>[{name:'subagent_run'}],sendMessage:m=>messages.push(m)});
 const ctx={cwd:root,hasUI:true,mode:"tui",sessionManager:{getSessionId:()=>root,getSessionFile:()=>undefined},ui:{theme:{fg:(_c,t)=>t,bold:t=>t},notify:t=>notices.push(t),setWidget:(_k,v)=>display.widget=v,setStatus:(_k,v)=>display.status=v}};
 return {commands,tools,handlers,messages,notices,display,publications,ctx,get subscriptions(){return subscriptions;}};
}

test('Trellis discovery stops at Git directory/file boundary and checks boundary Trellis first',t=>{
 const root=fixture(t);mkdirSync(join(root,'.trellis'));const repo=join(root,'repo'),sub=join(repo,'src');mkdirSync(sub,{recursive:true});
 for(const marker of ['directory','file']){
  if(marker==='directory')mkdirSync(join(repo,'.git'));else writeFileSync(join(repo,'.git'),'gitdir: elsewhere');
  assert.deepEqual(discoverProject(sub),{gitRoot:repo});assert.equal(initializationRoot(sub),repo);
  mkdirSync(join(repo,'.trellis'));assert.equal(discoverProject(sub).root,repo);rmSync(join(repo,'.trellis'),{recursive:true});rmSync(join(repo,'.git'),{recursive:true});
 }
 assert.equal(discoverProject(sub).root,root);assert.equal(initializationRoot(sub),root);
 rmSync(join(root,'.trellis'),{recursive:true});assert.deepEqual(discoverProject(sub),{});assert.equal(initializationRoot(sub),sub);
});

for(const kind of ['file','dangling symlink'])test(`invalid ${kind} Trellis marker cannot inherit ancestor`,t=>{
 const root=fixture(t);mkdirSync(join(root,'.trellis'));const child=join(root,'child');mkdirSync(child);
 if(kind==='file')writeFileSync(join(child,'.trellis'),'bad');else symlinkSync('missing',join(child,'.trellis'));
 assert.equal(discoverProject(child).root,child);assert.throws(()=>requireProjectRuntime(child),/local directory/);
});

test('factory and fresh startup register only init, no RPC subscription, Python, state or persistent display',async t=>{
 const root=fixture(t),h=harness(root),calls=[];mockPython(t,root,args=>{calls.push(args);});
 assert.deepEqual([...h.commands.keys()],['trellis-init']);assert.equal(h.tools.size,0);assert.equal(h.subscriptions,0);
 h.display.widget=['stale'];h.display.status='stale';await h.handlers.get('session_start')({},h.ctx);
 await h.handlers.get('before_agent_start')({prompt:'hello',systemPromptOptions:{sections:{}}},h.ctx);await h.handlers.get('agent_end')({},h.ctx);
 assert.equal(h.display.widget,undefined);assert.equal(h.display.status,undefined);assert.deepEqual(h.messages,[]);assert.deepEqual(calls,[]);assert.equal(existsSync(join(root,'.trellis')),false);assert.equal(h.tools.size,0);
});

test('supported startup registers viewer command and dispatch tool once; invalidation clears UI without state injection',async t=>{
 const root=fixture(t,true);const h=harness(root);
 await h.handlers.get('session_start')({},h.ctx);assert.deepEqual([...h.commands.keys()].sort(),['trellis-init','trellis-task-viewer']);assert.deepEqual([...h.tools.keys()],['trellis_dispatch']);assert.equal(h.subscriptions,2);assert.deepEqual(h.display.widget,['▸ trellis(0)']);
 await h.handlers.get('session_start')({},h.ctx);assert.equal(h.subscriptions,2);
 rmSync(join(root,'.trellis/scripts/task.py'));await h.handlers.get('agent_end')({},h.ctx);assert.equal(h.display.widget,undefined);assert.equal(h.display.status,undefined);
 await h.handlers.get('before_agent_start')({prompt:'inspect',systemPromptOptions:{sections:{}}},h.ctx);assert.deepEqual(h.messages,[]);
 await h.commands.get('trellis-task-viewer').handler('',{...h.ctx,mode:'tui'});assert.ok(h.notices.some(n=>/unavailable/.test(n)));
 const reloaded=harness(root);await reloaded.handlers.get('session_start')({},reloaded.ctx);assert.deepEqual([...reloaded.commands.keys()],['trellis-init']);assert.equal(reloaded.tools.size,0);
});


test('registered runner refuses another project prompt, display and dispatch',async t=>{
 const a=fixture(t,true),b=fixture(t,true);const h=harness(a);await h.handlers.get('session_start')({},h.ctx);
 h.ctx.cwd=b;const sections={};await h.handlers.get('before_agent_start')({prompt:'inspect',systemPromptOptions:{sections}},h.ctx);assert.deepEqual(sections,{});assert.deepEqual(h.messages,[]);
 await h.handlers.get('agent_end')({},h.ctx);assert.equal(h.display.widget,undefined);assert.equal(h.display.status,undefined);
 await assert.rejects(h.tools.get('trellis_dispatch').execute('id',{action:'stop'},undefined,undefined,h.ctx),/Project changed/);
 await h.handlers.get('session_start')({},h.ctx);assert.equal(h.subscriptions,2);assert.deepEqual([...h.commands.keys()].sort(),['trellis-init','trellis-task-viewer']);
 await h.commands.get('trellis-task-viewer').handler('',{...h.ctx,mode:'tui'});assert.ok(h.notices.some(n=>/Project changed/.test(n)));
 const blocked=await h.handlers.get('tool_call')({toolName:'subagent_run',input:{subagent_type:'trellis-check',prompt:'work'}},h.ctx);assert.equal(blocked?.block,true);
 const input={command:'pwd'};assert.equal(await h.handlers.get('tool_call')({toolName:'bash',input},h.ctx),undefined);assert.equal(input.command,'pwd');
});

for(const route of ['tool_result','viewer','dispatch','tool_call'])test(`runtime invalidation clears stale display on ${route} before agent_end`,async t=>{
 const root=fixture(t,true);const h=harness(root);await h.handlers.get('session_start')({},h.ctx);
 const before=readFileSync(join(root,'.trellis/scripts/get_context.py'));
 rmSync(join(root,'.trellis/scripts/task.py'));
 if(route==='tool_result')await h.handlers.get(route)({toolName:'bash',input:{command:'python3 .trellis/scripts/task.py current'}},h.ctx);
 if(route==='viewer')await h.commands.get('trellis-task-viewer').handler('',{...h.ctx,mode:'tui'});
 if(route==='dispatch')await assert.rejects(h.tools.get('trellis_dispatch').execute('id',{action:'stop'},undefined,undefined,h.ctx),/missing or modified/);
 if(route==='tool_call')assert.equal((await h.handlers.get(route)({toolName:'subagent_run',input:{subagent_type:'trellis-implement',prompt:'work'}},h.ctx))?.block,true);
 assert.equal(h.display.widget,undefined);assert.equal(h.display.status,undefined);assert.deepEqual(h.messages,[]);
 assert.deepEqual(readFileSync(join(root,'.trellis/scripts/get_context.py')),before);assert.equal(existsSync(join(root,'.trellis/scripts/task.py')),false);
});

test('removed project marker blocks Trellis children and runtime commands but not ordinary reads',async t=>{
 const root=fixture(t,true);const h=harness(root);await h.handlers.get('session_start')({},h.ctx);rmSync(join(root,'.trellis'),{recursive:true});
 for(const event of [{toolName:'subagent_run',input:{subagent_type:'trellis-check',prompt:'work'}},{toolName:'bash',input:{command:'python3 .trellis/scripts/task.py current'}}]){
  assert.equal((await h.handlers.get('tool_call')(event,h.ctx))?.block,true);
 }
 for(const event of [{toolName:'read',input:{path:'README.md'}},{toolName:'bash',input:{command:'pwd'}},{toolName:'subagent_run',input:{subagent_type:'Explore',prompt:'read'}}])assert.equal(await h.handlers.get('tool_call')(event,h.ctx),undefined);
 assert.equal(h.display.widget,undefined);assert.equal(h.display.status,undefined);assert.equal(existsSync(join(root,'.trellis')),false);
});

test('unreadable discovery never inherits parent or disrupts ordinary read/search; Trellis execution is blocked',async t=>{
 if(process.getuid?.()===0){t.skip('root can traverse chmod-000 fixtures');return;}
 const root=fixture(t,true);const child=join(root,'blocked');mkdirSync(child);chmodSync(child,0);
 try {
 assert.throws(()=>discoverProject(child),/EACCES/);
 const h=harness(child);h.display.widget=['stale'];h.display.status='stale';
 await h.handlers.get('session_start')({},h.ctx);await h.handlers.get('before_agent_start')({prompt:'inspect',systemPromptOptions:{sections:{}}},h.ctx);
 for(const event of [{toolName:'read',input:{path:'README.md'}},{toolName:'grep',input:{pattern:'foo'}},{toolName:'bash',input:{command:'pwd'}}])assert.equal(await h.handlers.get('tool_call')(event,h.ctx),undefined);
 assert.equal((await h.handlers.get('tool_call')({toolName:'subagent_run',input:{subagent_type:'trellis-implement',prompt:'work'}},h.ctx))?.block,true);
 assert.deepEqual([...h.commands.keys()],['trellis-init']);assert.equal(h.tools.size,0);assert.equal(h.display.widget,undefined);assert.equal(h.display.status,undefined);assert.deepEqual(h.messages,[]);
 await assert.doesNotReject(h.handlers.get('agent_end')({},h.ctx));assert.doesNotThrow(()=>h.handlers.get('session_shutdown')({},h.ctx));
 } finally { chmodSync(child,0o700); }
});

test('supported clone without developer identity still activates commands and no-task count',async t=>{
 const root=fixture(t,true);rmSync(join(root,'.trellis/.developer'));const h=harness(root);await h.handlers.get('session_start')({},h.ctx);
 assert.ok(h.commands.has('trellis-task-viewer'));assert.ok(h.tools.has('trellis_dispatch'));assert.deepEqual(h.display.widget,['▸ trellis(0)']);assert.equal(existsSync(join(root,'.trellis/.developer')),false);
});

test('fresh runner cannot activate another project on session replacement without reload',async t=>{
 const a=fixture(t),b=fixture(t,true);const h=harness(a);await h.handlers.get('session_start')({},h.ctx);h.ctx.cwd=b;
 await h.handlers.get('session_start')({},h.ctx);const sections={};await h.handlers.get('before_agent_start')({prompt:'inspect',systemPromptOptions:{sections}},h.ctx);await h.handlers.get('agent_end')({},h.ctx);
 assert.deepEqual([...h.commands.keys()],['trellis-init']);assert.equal(h.tools.size,0);assert.equal(h.subscriptions,0);assert.deepEqual(sections,{});assert.deepEqual(h.messages,[]);assert.equal(h.display.widget,undefined);assert.equal(h.display.status,undefined);
 assert.equal((await h.handlers.get('tool_call')({toolName:'subagent_run',input:{subagent_type:'trellis-check',prompt:'work'}},h.ctx))?.block,true);
 const reloaded=harness(b);await reloaded.handlers.get('session_start')({},reloaded.ctx);assert.ok(reloaded.commands.has('trellis-task-viewer'));assert.ok(reloaded.tools.has('trellis_dispatch'));
});

test('late startup and stale manager refresh cannot replace the current display generation',async t=>{
 const root=fixture(t,true),h=harness(root);
 const fresh={...h.ctx,sessionManager:{getSessionId:()=>root,getSessionFile:()=>undefined}};
 let callbacks=[];
 // Hold the first startup's public CLI result, preserving real initialized bytes.
 const childProcess=await import('node:child_process');
 const {syncBuiltinESMExports}=await import('node:module');
 const original=childProcess.default.execFile;
 childProcess.default.execFile=(executable,args,options,callback)=>{
  if(options?.cwd===root && args[0].endsWith('get_context.py')) { callbacks.push(callback); return; }
  return original(executable,args,options,callback);
 };
 syncBuiltinESMExports();
 try {
  const oldStart=h.handlers.get('session_start')({},h.ctx);
  await new Promise(resolve=>setImmediate(resolve));
  const freshStart=h.handlers.get('session_start')({},fresh);
  await new Promise(resolve=>setImmediate(resolve));
  for(const callback of callbacks)callback(null,'{}','');
  await Promise.all([oldStart,freshStart]);
  assert.equal(h.publications.at(-1),fresh);
  assert.ok(!h.publications.includes(h.ctx),'late startup must not even attempt stale widget delivery');
  const before=h.publications.length;
  await h.handlers.get('agent_end')({},h.ctx);
  assert.equal(h.publications.length,before,'stale manager cannot invalidate or publish a refresh');
 } finally { childProcess.default.execFile=original;syncBuiltinESMExports();await h.handlers.get('session_shutdown')({},fresh); }
});
