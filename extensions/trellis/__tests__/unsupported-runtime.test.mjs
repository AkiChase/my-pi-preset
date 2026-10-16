import './host-env.mjs';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import test from 'node:test';
import trellis, { __internals } from '../index.ts';
import { plan, apply } from '../lib/initialization/engine.ts';
import { mockPython } from './runtime-fixture.mjs';

function fixture(t, supported = false) {
 const root=mkdtempSync(join(tmpdir(),'pi-unsupported-runtime-'));t.after(()=>rmSync(root,{recursive:true,force:true}));
 const put=(path,text)=>{mkdirSync(dirname(join(root,path)),{recursive:true});writeFileSync(join(root,path),text);};
 if(supported)apply(plan(root,'Fixture'));
 const handlers=new Map(),commands=new Map(),messages=[],notices=[];
 trellis({registerMessageRenderer:()=>{},events:{on:()=>()=>{},emit:()=>{}},on:(n,h)=>{const previous=handlers.get(n);handlers.set(n,previous?(...args)=>{const old=previous(...args),next=h(...args);return Promise.all([old,next]).then(results=>results[1]);}:h);return()=>{};},registerTool:()=>{},registerCommand:(n,c)=>commands.set(n,c),sendMessage:m=>messages.push(m),getAllTools:()=>[{name:'subagent_run'}]});
 const ctx={cwd:root,hasUI:true,mode:"tui",sessionManager:{getSessionId:()=>root,getSessionFile:()=>undefined},ui:{theme:{fg:(_c,s)=>s,bold:s=>s},setStatus:()=>{},setWidget:()=>{},notify:(s)=>notices.push(s)}};
 const call=(command,toolName='bash')=>handlers.get('tool_call')({toolName,input:{command}},ctx);
 return {root,put,handlers,commands,messages,notices,ctx,call};
}

for(const state of ['absent manifest','mismatched bytes','corrupt manifest','incomplete manifest','incomplete operation']) {
 test(`${state}: startup never executes runtime or binds child; lifecycle commands blocked, reads allowed`,async t=>{
  const f=fixture(t,state!=='absent manifest');
  if(state==='absent manifest'||state==='mismatched bytes'){
   const marker="from pathlib import Path\nPath('executed-unverified').write_text('unsafe')\nprint('{}')\n";
   f.put('.trellis/scripts/task.py',marker);f.put('.trellis/scripts/get_context.py',marker);
   f.put('.trellis/scripts/common/active_task.py',"from pathlib import Path\nPath('bound-unverified').write_text('unsafe')\n");
  }
  if(state==='corrupt manifest')f.put('.trellis/.pi-trellis.json','{broken');
  if(state==='incomplete manifest'){
   const m=JSON.parse(readFileSync(join(f.root,'.trellis/.pi-trellis.json')));delete m.files['.trellis/scripts/task.py'];f.put('.trellis/.pi-trellis.json',JSON.stringify(m));
  }
  if(state==='incomplete operation'){
   const p='.trellis/.runtime/init-operation.json',o=JSON.parse(readFileSync(join(f.root,p)));o.status='incomplete';f.put(p,JSON.stringify(o));
  }
  f.put('.trellis/tasks/task/task.json','{"status":"in_progress"}');
  const executions=[];mockPython(t,f.root,args=>{executions.push(args);});
  const sections={};await f.handlers.get('session_start')({},f.ctx);
  assert.ok(!existsSync(join(f.root,'executed-unverified')), 'session_start executed unverified runtime');
  await f.handlers.get('before_agent_start')({prompt:'inspect',systemPromptOptions:{sections}},f.ctx);
  assert.ok(!existsSync(join(f.root,'executed-unverified')), 'before_agent_start executed unverified runtime');
  await f.handlers.get('before_agent_start')({prompt:'Active task: .trellis/tasks/task\nTrellis agent: trellis-implement\n\nwork',systemPromptOptions:{sections}},f.ctx);
  assert.deepEqual(f.messages,[], 'unsupported project must not inject workflow or task-state');
  assert.deepEqual(sections,{});assert.ok(f.notices.some(s=>/trellis-init/.test(s)));
  assert.ok(!existsSync(join(f.root,'executed-unverified')));assert.ok(!existsSync(join(f.root,'bound-unverified')));
  assert.ok(!existsSync(join(f.root,`.trellis/.runtime/sessions/${__internals.contextKey(f.root,f.ctx)}.json`)));
  for(const tool of ['bash','monitor'])for(const command of [
   'python3 .trellis/scripts/task.py deactivate','python3 -B ./.trellis/scripts/get_context.py --mode default --json',
   './.trellis/scripts/task.py current --json','task.py deactivate',
   'env X=1 python3 ".trellis/scripts/init_developer.py" Dev','env -u TRELLIS_CONTEXT_ID python3 .trellis/scripts/task.py deactivate',
   '/usr/bin/env python3 .trellis/scripts/task.py deactivate','/usr/bin/env -u TRELLIS_CONTEXT_ID python3 .trellis/scripts/get_context.py --json',
   '"/usr/bin/env" X=1 python3 .trellis/scripts/task.py current --json','/usr/bin/nohup python3 .trellis/scripts/task.py deactivate',
   'python3 .trellis/scripts/add_session.py --title test',
   'bash -c \'python3 .trellis/scripts/worktree.py prepare --task task\'',
   'python3 -c "from common.active_task import set_active_task"','python3 -c "from common import active_task"','trellis task finish',
  ]){
   const result=await f.call(command,tool);assert.equal(result?.block,true,`${tool}: ${command}`);assert.match(result.reason,/trellis-init/);
  }
  for (const role of ['trellis-implement','trellis-check','trellis-research']) {
   const child=await f.handlers.get('tool_call')({toolName:'subagent_run',input:{subagent_type:role,description:'Scoped task role',prompt:'work'}},f.ctx);assert.equal(child?.block,true);
  }
  for(const command of ['pwd','git status --short','cat .trellis/scripts/task.py','rg -n task.py .trellis','find .trellis -type f','python3 -c "print(1)"'])assert.equal(await f.call(command),undefined,command);
  assert.equal(await f.handlers.get('tool_call')({toolName:'monitor',input:{ws:{url:'wss://example.invalid'}}},f.ctx),undefined);
  assert.equal(await f.handlers.get('tool_call')({toolName:'subagent_run',input:{subagent_type:'Explore',prompt:'read-only'}},f.ctx),undefined);
  assert.ok(f.commands.has('trellis-init'));assert.ok(!existsSync(join(f.root,'executed-unverified')));
  assert.deepEqual(executions,[], 'unsupported runtime spawned Python');
  await assert.doesNotReject(async()=>f.handlers.get('session_shutdown')({},f.ctx));
 });
}

test('fresh project has usable init help without runtime; supported full runtime still scopes commands and loads task',async t=>{
 const fresh=fixture(t);assert.ok(fresh.commands.has('trellis-init'));await fresh.commands.get('trellis-init').handler('--help',fresh.ctx);assert.ok(fresh.notices.some(s=>s.includes('/trellis-init')));assert.ok(!existsSync(join(fresh.root,'.trellis')));
 const f=fixture(t,true),key=__internals.contextKey(f.root,f.ctx);f.put(`.trellis/.runtime/sessions/${key}.json`,JSON.stringify({current_task:'.trellis/tasks/00-bootstrap-guidelines'}));
 const input={command:'python3 .trellis/scripts/task.py current --json'};assert.equal(await f.handlers.get('tool_call')({toolName:'bash',input},f.ctx),undefined);assert.ok(input.command.startsWith(`export TRELLIS_CONTEXT_ID=${key}\n`));
 await f.handlers.get('before_agent_start')({prompt:'inspect',systemPromptOptions:{sections:{}}},f.ctx);assert.match(f.messages.at(-1).content,/Active task:/);assert.doesNotMatch(f.messages.at(-1).content,/task_error/);
});
