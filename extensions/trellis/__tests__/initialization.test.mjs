import './host-env.mjs';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync, readdirSync, lstatSync, symlinkSync, chmodSync, existsSync, cpSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir, homedir } from 'node:os';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import trellis, { __internals } from '../index.ts';
import { inspect, plan, apply, validateUsername, usernameSlug, runtimeBaseline, verifyRuntime, digest } from '../lib/initialization/engine.ts';

export function fixture(t) {
 const root=mkdtempSync(join(tmpdir(),'pi init space '));t.after(()=>rmSync(root,{recursive:true,force:true}));
 const put=(p,value)=>{mkdirSync(dirname(join(root,p)),{recursive:true});writeFileSync(join(root,p),typeof value==='string'?value:JSON.stringify(value));};
 const snapshot=(directory=root)=>Object.fromEntries(readdirSync(directory,{withFileTypes:true}).sort((a,b)=>a.name.localeCompare(b.name)).flatMap(e=>{const p=join(directory,e.name),rel=p.slice(root.length+1);return e.isDirectory()?[[rel,'directory'],...Object.entries(snapshot(p))]:[[rel,e.isSymbolicLink()?'symlink':`${lstatSync(p).mode&0o777}:${readFileSync(p).toString('base64')}`]];}));
 const run=(entry,args=[],key='test')=>spawnSync(process.env.TRELLIS_PYTHON||'python3',['-B',join(root,'.trellis/scripts',entry),...args],{cwd:root,env:{...process.env,PYTHONDONTWRITEBYTECODE:'1',TRELLIS_CONTEXT_ID:key},encoding:'utf8'});
 return {root,put,snapshot,run};
}

test('fresh inspect and complete plan are read-only; apply publishes exact release/modes and canonical task without binding/hooks/Git',t=>{
 const f=fixture(t),before=f.snapshot();assert.equal(inspect(f.root).state,'fresh');const p=plan(f.root,'李 小明');assert.deepEqual(f.snapshot(),before);assert.equal(p.operation,'initialize');assert.equal(apply(p).developer,'李 小明');
 const manifest=verifyRuntime(f.root);assert.equal(manifest.schemaVersion,3);assert.equal(manifest.runtimeReleaseId,runtimeBaseline().releaseId);assert.equal(Object.keys(manifest.files).length,Object.keys(runtimeBaseline().files).length+3);assert.equal(Object.keys(manifest.templates).length,8);
 assert.equal(Object.keys(manifest.skills).length,Object.keys(JSON.parse(readFileSync(new URL('../resources/skill-baseline.json',import.meta.url))).files).length);
 for(const [path,record] of Object.entries({...manifest.files,...manifest.templates,...manifest.skills})){assert.equal(digest(readFileSync(join(f.root,path))),record.sha256,path);assert.equal(lstatSync(join(f.root,path)).mode&0o777,record.mode);}
 assert.ok(Object.values(manifest.templates).every(record=>record.origin==='package-default'));
 const task=JSON.parse(readFileSync(join(f.root,p.task,'task.json')));assert.equal(Object.keys(task).length,24);assert.equal(task.status,'in_progress');assert.equal(task.creator,'李 小明');assert.equal(task.assignee,'李 小明');assert.equal(task.dev_type,'docs');assert.equal(task.priority,'P1');assert.deepEqual(task.relatedFiles,['.trellis/spec/']);
 assert.equal(existsSync(join(f.root,'.trellis/.runtime/sessions')),false);assert.ok(existsSync(join(f.root,'.pi/skills/trellis-start/SKILL.md')));assert.equal(existsSync(join(f.root,'.trellis/spec/frontend')),false);assert.equal(existsSync(join(f.root,'.trellis/spec/backend')),false);
 assert.match(readFileSync(join(f.root,'.trellis/config.yaml'),'utf8'),/session_auto_commit: false/);assert.doesNotMatch(readFileSync(join(f.root,'.trellis/config.yaml'),'utf8'),/^hooks:|packages:|channel:|codex:/m);
 assert.ok(!Object.keys(f.snapshot()).some(p=>p.includes('__pycache__')||p.endsWith('.pyc')||p.includes('/current-task')));
 const ready=f.snapshot();assert.equal(plan(f.root,'李 小明'),undefined);assert.deepEqual(f.snapshot(),ready);assert.throws(()=>plan(f.root,'Other'),/conflict.*李 小明.*Other/);assert.deepEqual(f.snapshot(),ready);
});

test('supported clone restores historical workspace and creates join without rewriting runtime or user content; repeat no-op',t=>{
 const f=fixture(t);apply(plan(f.root,'Returning User'));rmSync(join(f.root,'.trellis/.developer'));f.put('.trellis/workspace/Returning User/journal-1.md','history\r\n');f.put('.trellis/workspace/Returning User/index.md','custom index');f.put('.trellis/config.yaml','custom config');f.put('.trellis/workflow.md','custom workflow');
 const before=f.snapshot(),p=plan(f.root,'Returning User');assert.equal(p.operation,'identity');assert.ok(p.workspaceReused);assert.match(p.task,/00-join-returning-user$/);assert.ok(p.actions.every(a=>['identity','workspace','task'].includes(a.kind)));apply(p);
 const after=f.snapshot();for(const [path,value] of Object.entries(before))if(path!=='.trellis/.runtime/init-operation.json')assert.equal(after[path],value,path);
 assert.equal(plan(f.root,'Returning User'),undefined);
 rmSync(join(f.root,'.trellis/.developer'));const reused=plan(f.root,'Returning User');assert.ok(reused.taskReused);apply(reused);
 rmSync(join(f.root,'.trellis/.developer'));mkdirSync(join(f.root,'.trellis/tasks/archive/2000-01'),{recursive:true});cpSync(join(f.root,p.task),join(f.root,'.trellis/tasks/archive/2000-01',p.task.split('/').at(-1)),{recursive:true});rmSync(join(f.root,p.task),{recursive:true});assert.equal(plan(f.root,'Returning User').taskReused,false);
});

test('unsafe/Unicode username validation and upstream-compatible slug do not slug identity',()=>{
 for(const name of ['',' ',' . ','..','a/b','a\\b','edge\n','x\u0000','x\u200d','a'.repeat(256)])assert.throws(()=>validateUsername(name));
 assert.equal(validateUsername('A B'),'A B');assert.equal(validateUsername('李 小明'),'李 小明');assert.equal(usernameSlug('École Ç'),'e-cole-c');assert.equal(usernameSlug('中文 名字'),'中文-名字');assert.equal(usernameSlug('😀'),'user');assert.equal(usernameSlug('A_B'),'a-b');
});

test('onboarding slug collisions and malformed/half existing tasks conflict without overwrite',t=>{
 const f=fixture(t);apply(plan(f.root,'Owner'));rmSync(join(f.root,'.trellis/.developer'));const p=plan(f.root,'A B');apply(p);rmSync(join(f.root,'.trellis/.developer'));const before=f.snapshot();assert.throws(()=>plan(f.root,'A-B'),/collision/);assert.deepEqual(f.snapshot(),before);
 rmSync(join(f.root,p.task,'prd.md'));assert.throws(()=>plan(f.root,'A B'),/incomplete/);assert.equal(existsSync(join(f.root,p.task,'task.json')),true);
});

test('root blocks/attributes preserve bytes outside owned blocks and modes; exact blocks are reused',t=>{
 const f=fixture(t);f.put('AGENTS.md','custom instructions\r\n');f.put('.gitignore','custom-ignore');f.put('.gitattributes','*.png binary\r\n');chmodSync(join(f.root,'AGENTS.md'),0o640);const p=plan(f.root,'Dev');apply(p);
 assert.ok(readFileSync(join(f.root,'AGENTS.md'),'utf8').startsWith('custom instructions\r\n'));assert.equal(lstatSync(join(f.root,'AGENTS.md')).mode&0o777,0o640);assert.ok(readFileSync(join(f.root,'.gitignore'),'utf8').startsWith('custom-ignore\n'));assert.ok(readFileSync(join(f.root,'.gitattributes'),'utf8').startsWith('*.png binary\r\n'));
});

for(const [path,content] of [
 ['AGENTS.md','<!-- TRELLIS:START -->\ncustom\n<!-- TRELLIS:END -->'],['AGENTS.md','<!-- TRELLIS:START -->'],['.gitignore','# pi-trellis:ignore:start\nx\n# pi-trellis:ignore:end'],['.gitattributes','.trellis/workspace/*/journal-*.md merge=ours'],['.gitattributes','*.md merge=ours'],['.pi/agents/trellis-check.md','custom role']]){
 test(`unknown/customized root or agent collision ${path}: no writes`,t=>{const f=fixture(t);f.put(path,content);const before=f.snapshot();assert.throws(()=>plan(f.root,'Dev'));assert.deepEqual(f.snapshot(),before);});
}

for(const path of ['.trellis','.pi','.pi/agents','AGENTS.md','.gitignore','.gitattributes']){
 test(`symlink/dangling managed target ${path} is rejected without victim writes`,t=>{
 const f=fixture(t),victim=mkdtempSync(join(tmpdir(),'pi-init-victim-'));t.after(()=>rmSync(victim,{recursive:true,force:true}));mkdirSync(dirname(join(f.root,path)),{recursive:true});symlinkSync(join(victim,'missing'),join(f.root,path));const before=f.snapshot();assert.throws(()=>plan(f.root,'Dev'));assert.deepEqual(f.snapshot(),before);assert.deepEqual(readdirSync(victim),[]);
 });
}

test('HOME and unknown/incompatible runtime are read-only; supported script hash drift prevents identity writes',t=>{
 assert.equal(inspect(homedir()).state,'conflict');const f=fixture(t);f.put('.trellis/scripts/task.py','unknown');const before=f.snapshot();assert.equal(inspect(f.root).state,'unsupported');assert.throws(()=>plan(f.root,'Dev'));assert.deepEqual(f.snapshot(),before);
 const g=fixture(t);apply(plan(g.root,'Dev'));rmSync(join(g.root,'.trellis/.developer'));g.put('.trellis/scripts/task.py','changed runtime');const drift=g.snapshot();assert.equal(inspect(g.root).state,'conflict');assert.throws(()=>plan(g.root,'Dev'));assert.deepEqual(g.snapshot(),drift);
});

test('interrupted publication preserves outputs and resumes only identical recorded operation; divergent edits never overwritten',t=>{
 const f=fixture(t),p=plan(f.root,'Dev');assert.throws(()=>apply(p,{afterWrite:(_path,n)=>{if(n===7)throw Error('forced interruption');}}),/forced/);assert.equal(inspect(f.root).state,'incomplete');assert.ok(existsSync(join(f.root,p.actions[0].path)));assert.equal(existsSync(join(f.root,'.trellis/.runtime/init.lock')),false);assert.throws(()=>plan(f.root,'Other'),/recorded developer/);const retry=plan(f.root,'Dev');assert.equal(retry.planHash,p.planHash);assert.equal(apply(retry).state,'ready');
 const g=fixture(t),q=plan(g.root,'Dev');assert.throws(()=>apply(q,{afterWrite:(_path,n)=>{if(n===1)throw Error('forced');}}));g.put(q.actions[0].path,'user modified partial file');const before=g.snapshot();assert.throws(()=>plan(g.root,'Dev'),/changed since preview/);assert.deepEqual(g.snapshot(),before);
});

test('manifest publication interruption is still incomplete and retryable; corrupted operation and lock are conservative',t=>{
 const f=fixture(t),p=plan(f.root,'Dev');assert.throws(()=>apply(p,{afterWrite:path=>{if(path==='.trellis/.pi-trellis.json')throw Error('after manifest');}}));assert.equal(inspect(f.root).state,'incomplete');assert.equal(apply(plan(f.root,'Dev')).state,'ready');
 const g=fixture(t),q=plan(g.root,'Dev');g.put('.trellis/.runtime/init.lock','external owner');const before=g.snapshot();assert.throws(()=>apply(q),/locked/);assert.deepEqual(g.snapshot(),before);
 g.put('.trellis/.runtime/init-operation.json','{}');assert.equal(inspect(g.root).state,'conflict');
});

test('concurrent file changes after preview conflict before lock or writes; identity recovery rechecks runtime',t=>{
 const f=fixture(t),p=plan(f.root,'Dev');f.put('AGENTS.md','concurrent instructions');const before=f.snapshot();assert.throws(()=>apply(p),/changed since preview/);assert.deepEqual(f.snapshot(),before);
 const g=fixture(t);apply(plan(g.root,'Dev'));rmSync(join(g.root,'.trellis/.developer'));const q=plan(g.root,'Dev');g.put('.trellis/scripts/task.py','changed after identity preview');const drift=g.snapshot();assert.throws(()=>apply(q),/changed since preview/);assert.deepEqual(g.snapshot(),drift);
});

test('task_error stays distinct from no_task and command tools scope/invalidate without touching WebSocket monitors',async t=>{
 const f=fixture(t);apply(plan(f.root,'Dev'));const handlers=new Map(),messages=[];trellis({registerMessageRenderer:()=>{},on:(n,h)=>handlers.set(n,h),registerCommand:()=>{},registerTool:()=>{},events:{on:()=>()=>{},emit:()=>{}},sendMessage:m=>messages.push(m),getAllTools:()=>[]});const ctx={cwd:f.root,hasUI:false,ui:{},sessionManager:{getSessionId:()=>f.root,getSessionFile:()=>undefined}};const key=__internals.contextKey(f.root,ctx);const before=()=>handlers.get('before_agent_start')({prompt:'inspect',systemPromptOptions:{sections:{}}},ctx);
 await before();assert.match(messages.at(-1).content,/No active task/);
 for(const input of [{toolName:'bash',command:'task.py current --json',run_in_background:false},{toolName:'bash',command:'task.py current --json',run_in_background:true},{toolName:'monitor',command:'task.py current --json'}]){
  const {toolName,...args}=input;await handlers.get('tool_call')({toolName,input:args},ctx);
  assert.ok(args.command.startsWith(`export TRELLIS_CONTEXT_ID=${key}\n`));
  f.put(`.trellis/.runtime/sessions/${key}.json`,'broken');
  await handlers.get('tool_result')({toolName,input:args},ctx);await before();assert.match(messages.at(-1).content,/task_error/);
 }
 const oldShell={command:'task.py current --json'};await handlers.get('tool_call')({toolName:'bash_bg',input:oldShell},ctx);assert.equal(oldShell.command,'task.py current --json');
 f.put(`.trellis/.runtime/sessions/${key}.json`,'broken');for(const tool of ['bash','monitor']){const input={command:'task.py current --json'};await handlers.get('tool_call')({toolName:tool,input},ctx);assert.ok(input.command.startsWith(`export TRELLIS_CONTEXT_ID=${key}\n`));await handlers.get('tool_result')({toolName:tool,input},ctx);}
 await before();assert.match(messages.at(-1).content,/task_error/);assert.doesNotMatch(messages.at(-1).content,/No active task/);const ws={ws:{url:'ws://localhost'}};await handlers.get('tool_call')({toolName:'monitor',input:ws},ctx);assert.deepEqual(ws,{ws:{url:'ws://localhost'}});
});

test('unsupported deployed release injects no state and blocks command/role execution while WebSocket/non-Trellis reads are untouched',async t=>{
 const f=fixture(t);apply(plan(f.root,'Dev'));const file=join(f.root,'.trellis/.pi-trellis.json'),m=JSON.parse(readFileSync(file));m.runtimeReleaseId='wrong';writeFileSync(file,JSON.stringify(m));
 const handlers=new Map(),messages=[];trellis({registerMessageRenderer:()=>{},on:(n,h)=>handlers.set(n,h),registerCommand:()=>{},registerTool:()=>{},events:{on:()=>()=>{},emit:()=>{}},sendMessage:m=>messages.push(m)});const ctx={cwd:f.root,hasUI:false,ui:{},sessionManager:{getSessionId:()=>f.root,getSessionFile:()=>undefined}};
 await handlers.get('before_agent_start')({prompt:'inspect',systemPromptOptions:{sections:{}}},ctx);assert.deepEqual(messages,[]);
 for(const tool of ['bash','monitor'])assert.equal((await handlers.get('tool_call')({toolName:tool,input:{command:'task.py deactivate'}},ctx)).block,true);
 assert.equal((await handlers.get('tool_call')({toolName:'subagent_run',input:{subagent_type:'trellis-implement',prompt:'work'}},ctx)).block,true);
 assert.equal(await handlers.get('tool_call')({toolName:'monitor',input:{ws:{url:'ws://localhost'}}},ctx),undefined);assert.equal(await handlers.get('tool_call')({toolName:'read',input:{path:'README.md'}},ctx),undefined);
});

test('malformed developer identity and tampered operation ownership cannot be mistaken for ready or publish arbitrary files',t=>{
 const f=fixture(t);apply(plan(f.root,'Dev'));f.put('.trellis/.developer','');assert.equal(inspect(f.root).state,'conflict');const before=f.snapshot();assert.throws(()=>plan(f.root,'Dev'));assert.deepEqual(f.snapshot(),before);
 const g=fixture(t),p=plan(g.root,'Dev');assert.throws(()=>apply(p,{afterWrite:()=>{throw Error('forced');}}));const file=join(g.root,'.trellis/.runtime/init-operation.json'),operation=JSON.parse(readFileSync(file));operation.plan.actions[0].path='unowned.txt';operation.plan.guards['unowned.txt']=null;const {planHash,...body}=operation.plan;operation.plan.planHash=digest(JSON.stringify(body));writeFileSync(file,JSON.stringify(operation));assert.equal(inspect(g.root).state,'conflict');assert.throws(()=>plan(g.root,'Dev'));assert.equal(existsSync(join(g.root,'unowned.txt')),false);
});

test('fresh init works with no global trellis in PATH and sanitized Git suggestion environment',t=>{
 const f=fixture(t),bin=join(f.root,'bin');mkdirSync(bin);const python=spawnSync('which',[process.env.TRELLIS_PYTHON||'python3'],{encoding:'utf8'}).stdout.trim();symlinkSync(python,join(bin,'python3'));
 const old={PATH:process.env.PATH,TRELLIS_PYTHON:process.env.TRELLIS_PYTHON,GIT_CONFIG_COUNT:process.env.GIT_CONFIG_COUNT,GIT_CONFIG_KEY_0:process.env.GIT_CONFIG_KEY_0,GIT_CONFIG_VALUE_0:process.env.GIT_CONFIG_VALUE_0};
 process.env.PATH=bin;process.env.TRELLIS_PYTHON=python;process.env.GIT_CONFIG_COUNT='1';process.env.GIT_CONFIG_KEY_0='user.name';process.env.GIT_CONFIG_VALUE_0='redirected identity';
 try {assert.equal(inspect(f.root).gitSuggestion,undefined);assert.equal(apply(plan(f.root,'Offline Dev')).state,'ready');for(const [entry,args] of [['task.py',['--help']],['get_context.py',['--help']],['add_session.py',['--help']],['worktree.py',['--help']]])assert.equal(f.run(entry,args).status,0,entry);assert.ok(!Object.keys(f.snapshot()).some(p=>p.includes('__pycache__')));}finally{for(const [key,value] of Object.entries(old))if(value===undefined)delete process.env[key];else process.env[key]=value;}
});

test('duplicate managed blocks conflict, exact preexisting blocks preserve surrounding bytes, task and workspace symlinks conflict',t=>{
 const f=fixture(t),block=readFileSync(new URL('../resources/templates/agents-block.md',import.meta.url));f.put('AGENTS.md',Buffer.concat([Buffer.from('prefix\r\n'),block,Buffer.from('suffix\r\n')]).toString());const original=readFileSync(join(f.root,'AGENTS.md'));apply(plan(f.root,'Dev'));assert.deepEqual(readFileSync(join(f.root,'AGENTS.md')),original);
 const g=fixture(t);g.put('AGENTS.md',block.toString()+block.toString());const before=g.snapshot();assert.throws(()=>plan(g.root,'Dev'),/repeated/);assert.deepEqual(g.snapshot(),before);
 const h=fixture(t);apply(plan(h.root,'Dev'));rmSync(join(h.root,'.trellis/.developer'));const victim=mkdtempSync(join(tmpdir(),'pi-init-history-victim-'));t.after(()=>rmSync(victim,{recursive:true,force:true}));rmSync(join(h.root,'.trellis/workspace/Dev'),{recursive:true});symlinkSync(victim,join(h.root,'.trellis/workspace/Dev'));const snapshot=h.snapshot();assert.throws(()=>plan(h.root,'Dev'));assert.deepEqual(h.snapshot(),snapshot);assert.deepEqual(readdirSync(victim),[]);
});
