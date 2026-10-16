import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync, readdirSync } from 'node:fs';
import { AsyncLocalStorage } from 'node:async_hooks';
import { cp, rm } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it, after } from 'node:test';
import { canonicalPath } from '../lib/config.ts';
import { manageWorktree } from './worktree-fixture.mjs';
import { registerDispatchTool } from '../lib/subagent-rpc.ts';
import { readExecution } from '../lib/executions.ts';
import { apply, plan } from '../lib/initialization/engine.ts';
import { readSourceExecution } from '../lib/source-executions.ts';
import { readBinding } from '../lib/bindings.ts';
import { queryWorktree } from '../lib/worktree-query.ts';
import { mockPython } from './runtime-fixture.mjs';

// Build the initialized Git/Trellis project once and copy it per case.
// Cases run serially; the root test runner owns file-level concurrency.
// Keep the scoped cwd and mock routing so each case owns its project state.
const cases=[];
const test=(name,fn)=>cases.push({name,fn});
const cwdScope=new AsyncLocalStorage();
const realCwd=process.cwd, originalCwd=process.cwd();
const neutralCwd=canonicalPath(mkdtempSync(join(tmpdir(),'pi-dispatch-cwd-')));
process.chdir(neutralCwd);
process.cwd=function cwd(){return cwdScope.getStore()?.cwd ?? realCwd.call(process);};
const templates={};
after(()=>{process.cwd=realCwd;process.chdir(originalCwd);rmSync(neutralCwd,{recursive:true,force:true});for(const root of Object.values(templates))rmSync(root,{recursive:true,force:true});});
const extensionSettings=JSON.stringify({extensions:[new URL('../../trellis.ts',import.meta.url).pathname]});
const TASK='.trellis/tasks/test';
// Files that record the absolute project root: the completed initialization
// record and, for a created worktree, the binding/marker records and Git's
// worktree links. Each copy rewrites them exactly as the real flow would have.
function rebase(from,to) {
 const bindings=join(to,'.trellis/.runtime/pi-trellis/bindings');
 const files=['.trellis/.runtime/init-operation.json','.git/worktrees/test/gitdir','.worktree/test/.git','.worktree/test/.trellis/.runtime/pi-trellis/binding.json'].map(path=>join(to,path));
 if(existsSync(bindings))files.push(...readdirSync(bindings).map(name=>join(bindings,name)));
 const escape=path=>JSON.stringify(path).slice(1,-1);
 for(const file of files)if(existsSync(file))writeFileSync(file,readFileSync(file,'utf8').replaceAll(escape(from),escape(to)));
}
async function copyProject(from) {
 const root=canonicalPath(mkdtempSync(join(tmpdir(),'pi-dispatch-')));
 await cp(from,root,{recursive:true});rebase(from,root);return root;
}
function sourceTemplate() {
 if(templates.source)return templates.source;
 const root=canonicalPath(mkdtempSync(join(tmpdir(),'pi-dispatch-template-')));templates.source=root;
 const put=(path,data)=>{mkdirSync(join(root,path,'..'),{recursive:true});writeFileSync(join(root,path),data);};
 const git=(...args)=>execFileSync('git',['-C',root,...args],{encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
 git('init','-q');put('.gitignore','/.worktree/\n/.trellis/.runtime/\n/.pi/\n');put('code.txt','base');
 apply(plan(root,'Fixture'));put('.trellis/spec/spec.md','BASE target spec');
 git('add','.');git('-c','user.name=Fixture','-c','user.email=fixture@example.invalid','-c','commit.gpgsign=false','commit','-qm','fixture');
 put('.pi/settings.json',extensionSettings);
 put(TASK+'/task.json','{"status":"in_progress"}');put(TASK+'/prd.md','Task requirements');
 for(const role of ['implement','check'])put(TASK+'/'+role+'.jsonl','{"file":".trellis/spec/spec.md"}');
 for(const role of ['implement','check','research'])put('.pi/agents/trellis-'+role+'.md',`---\nname: trellis-${role}\ntools: read, write, edit, bash, find, grep\nextensions: true\nisolation: off\n---\nRole\n`);
 return root;
}
// A real native create + prepare performed once (the first case below still
// exercises create -> not-ready rejection -> prepare per case).
let readyTemplate;
function preparedTemplate() {
 return readyTemplate??=(async()=>{
  const root=await copyProject(sourceTemplate());templates.ready=root;
  const created=await manageWorktree({cwd:root,task:TASK,action:'create',confirm:true});
  mkdirSync(join(created.binding.worktreePath,'.pi'),{recursive:true});writeFileSync(join(created.binding.worktreePath,'.pi/settings.json'),extensionSettings);
  await manageWorktree({cwd:root,task:TASK,action:'prepare',confirm:true});
  return root;
 })();
}

async function fixture(t) {
 const scope=cwdScope.getStore();if(!scope)throw Error('dispatch fixture requires a cwd scope');
 return project(t,scope,await copyProject(sourceTemplate()));
}
/** Source project with a ready (created and prepared) managed worktree; `prepared` mirrors the created binding. */
async function readyFixture(t) {
 const scope=cwdScope.getStore();if(!scope)throw Error('dispatch fixture requires a cwd scope');
 const f=project(t,scope,await copyProject(await preparedTemplate()));
 const binding=readBinding(f.root,f.task);assert.equal(binding.preparationState,'ready');assert.equal(binding.sourceRoot,f.root);
 return Object.assign(f,{prepared:{binding}});
}
const queryTemplates=new Map();
// RPC/state and CLI setup tests use captured native facts. Files, locks,
// snapshots, status and management commands remain real; tests of query drift
// and source authority never use this helper.
async function stateFixture(t, managed=true, { liveMaterials=false }={}) {
 const template=managed?await preparedTemplate():sourceTemplate();
 const f=managed?await readyFixture(t):await fixture(t);
 const capture=async(task,role)=>{
  const key=`${managed}:${task??''}:${role??''}`;
  if(!queryTemplates.has(key))queryTemplates.set(key,JSON.stringify(await queryWorktree(template,task,false,undefined,false,role)));
  const escape=path=>JSON.stringify(path).slice(1,-1);
  return queryTemplates.get(key).replaceAll(escape(template),escape(f.root));
 };
 const plain=await capture(), selected=await capture(TASK);
 const roles={};for(const role of ['implement','check'])roles[role]=liveMaterials
  ? JSON.stringify(await queryWorktree(f.root,TASK,false,undefined,false,role))
  : await capture(TASK,role);
 let queries=0;
 mockPython(t,f.root,args=>{
  if(!args.some(arg=>arg.endsWith('/query-worktree.py')))return;
  queries++;
  const role=args.includes('--role')?args[args.indexOf('--role')+1]:undefined;
  const task=args.includes('--task')?args[args.indexOf('--task')+1]:undefined;
  assert.ok(task===undefined||task===TASK,'state fixture cannot simulate another task');
  assert.ok(role===undefined||Object.hasOwn(roles,role),'unexpected material role');
  return {stdout:role?roles[role]:task?selected:plain};
 });
 t.after(()=>assert.ok(queries>0,'state test must exercise the query boundary'));
 return f;
}

function project(t,scope,root) {
 scope.cwd=root;t.after(()=>rm(root,{recursive:true,force:true}));
 const put=(path,data)=>{mkdirSync(join(root,path,'..'),{recursive:true});writeFileSync(join(root,path),data);};
 const git=(...args)=>execFileSync('git',['-C',root,...args],{encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
 const task=TASK;
 const chdir=path=>{scope.cwd=path;};
 const run=async(extra={})=>{const result=await manageWorktree({cwd:root,task,action:'create',confirm:true,...extra});if((extra.action??'create')==='create'&&result.binding){mkdirSync(join(result.binding.worktreePath,'.pi'),{recursive:true});writeFileSync(join(result.binding.worktreePath,'.pi/settings.json'),extensionSettings);}return result;};
 const handlers=new Map(), events=new Map(), tools=new Map();
 const bus={on:(name,handler)=>{if(!events.has(name))events.set(name,new Set());events.get(name).add(handler);return()=>events.get(name).delete(handler);},emit:(name,data)=>{for(const handler of [...(events.get(name)||[])])handler(data);}};
 const pi={events:bus,on:(name,fn)=>handlers.set(name,fn),registerTool:tool=>tools.set(tool.name,tool)};
 registerDispatchTool(pi,async()=>task);
 const replies=[];
 bus.on('subagents:rpc:ping',({requestId})=>bus.emit('subagents:rpc:ping:reply:'+requestId,{success:true,data:{version:2}}));
 let seq=0, spawnFailure;
 bus.on('subagents:rpc:spawn',params=>{replies.push(params);bus.emit('subagents:rpc:spawn:reply:'+params.requestId,spawnFailure ? {success:false,error:spawnFailure} : {success:true,data:{id:'agent-'+(++seq)}});});
 const call=input=>tools.get('trellis_dispatch').execute('tool',input,undefined,undefined,{cwd:root});
 const dispatch=(agent='trellis-implement')=>call({agent,prompt:'work'});
 return {root,task,put,run,dispatch,call,bus,replies,handlers,git,chdir,failSpawn:error=>{spawnFailure=error;}};
}

test('dispatch requires ready, uses target cwd/off, returns real id and prevents same-dir overlap',async t=>{
 const f=await fixture(t);const c=await f.run();
 await assert.rejects(f.dispatch(),/ready worktree/);await f.run({action:'prepare'});
 const first=await f.dispatch();assert.equal(first.details.agentId,'agent-1');
 assert.equal(f.replies[0].options.cwd,c.binding.worktreePath);assert.equal(f.replies[0].options.isolation,'off');
 assert.match(f.replies[0].prompt,/Review base:/);assert.doesNotMatch(f.replies[0].prompt,/BASE target spec|trellis-hook-injected/);assert.match(f.replies[0].prompt,/Source authority contract/);
 await assert.rejects(f.dispatch('trellis-check'),/running\/unknown/);
 f.bus.emit('subagents:completed',{id:'agent-1'});
 assert.equal(readExecution(c.binding).state,'completed');
 const second=await f.dispatch('trellis-check');assert.equal(second.details.agentId,'agent-2');
 f.bus.emit('subagents:failed',{id:'agent-2',error:'cancelled'});assert.equal(readExecution(c.binding).state,'failed');
});

test('early completed event before RPC reply cannot leave a stale running lease',async t=>{
 const f=await stateFixture(t),c=f.prepared;
 f.bus.on('subagents:rpc:spawn',()=>f.bus.emit('subagents:completed',{id:'agent-1'}));
 await f.dispatch();assert.equal(readExecution(c.binding).state,'completed');
});

test('check snapshot becomes stale after manual change; terminal event releases directory but never marks acceptance',async t=>{
 const f=await stateFixture(t,true,{liveMaterials:true}),c=f.prepared;
 await f.dispatch('trellis-check');f.bus.emit('subagents:completed',{id:'agent-1'});
 const current=await f.run({action:'status'});assert.match(current.note,/current snapshot/);
 writeFileSync(join(c.binding.worktreePath,'code.txt'),'manual change');
 const stale=await f.run({action:'status'});assert.match(stale.note,/stale/);
});

test('shutdown retains unknown lease instead of claiming a running child stopped',async t=>{
 const f=await stateFixture(t),c=f.prepared;
 await f.dispatch();f.handlers.get('session_shutdown')();
 assert.equal(readExecution(c.binding).state,'unknown');
 await assert.rejects(f.dispatch(),/shut down/);
});

test('target pointer is not authoritative; incompatible custom role still rejects without spawn',async t=>{
 const f=await stateFixture(t),c=f.prepared;
 f.put('.pi/agents/trellis-implement.md','---\nname: trellis-implement\nisolation: worktree\n---\n');
 await assert.rejects(f.dispatch(),/conflicts/);assert.equal(f.replies.length,0);
 f.put('.pi/agents/trellis-implement.md','---\nname: trellis-implement\ntools: read, write, edit, bash, find, grep\nextensions: true\nisolation: off\n---\nRole\n');
 mkdirSync(join(c.binding.worktreePath,'.trellis/.runtime/sessions'),{recursive:true});
 writeFileSync(join(c.binding.worktreePath,'.trellis/.runtime/sessions',c.binding.contextId+'.json'),'broken target pointer');
 await f.dispatch();assert.equal(f.replies.length,1);
});


test('dispatch old call shape/optional empty task works; stop requires no agent/prompt and waits for terminal evidence',async t=>{
 const f=await stateFixture(t),c=f.prepared;
 const first=await f.call({action:'',task:'',agent:'trellis-implement',prompt:'old shape'});assert.equal(first.details.agentId,'agent-1');
 let stopped;
 f.bus.on('subagents:rpc:stop',params=>{stopped=params;f.bus.emit('subagents:rpc:stop:reply:'+params.requestId,{success:true});});
 for(const input of [{action:'stop',agent:'trellis-implement'},{action:'stop',prompt:'ignored prose'},{action:'stop',agent:''},{action:'stop',prompt:''},{action:'stop',task:'',agent:'',prompt:''}]){
  stopped=undefined;await assert.rejects(f.call(input),/dispatch-only/);assert.equal(stopped,undefined);assert.equal(readExecution(c.binding).state,'running');
 }
 const result=await f.call({action:'stop',task:''});assert.equal(stopped.agentId,'agent-1');assert.equal(result.details.agentId,'agent-1');assert.equal(readExecution(c.binding).state,'running');
 await assert.rejects(f.dispatch(),/running\/unknown/);
 f.bus.emit('subagents:completed',{id:'agent-1'});assert.equal(readExecution(c.binding).state,'completed');
 for(const input of [{agent:'trellis-implement',prompt:''},{agent:'trellis-implement',prompt:'   '},{action:'invalid'},{task:' ',agent:'trellis-implement',prompt:'work'},{agent:''}])await assert.rejects(f.call(input));
});

test('host rechecks selected source role after ping; invalid source spawns zero',async t=>{
 const f=await readyFixture(t),c=f.prepared;
 f.bus.on('subagents:rpc:ping',()=>f.put(f.task+'/implement.jsonl','{"file":"missing-source"}'));
 await assert.rejects(f.dispatch(),/source|missing-source/);assert.equal(f.replies.length,0);assert.equal(readExecution(c.binding),undefined);
});

test('failed/unknown provider stop retains lease; source task and actual host cwd/config remain required',async t=>{
 const f=await stateFixture(t),c=f.prepared;
 await assert.rejects(f.call({action:'stop'}),/No known agent id/);
 f.put('.pi/settings.json','{}');await assert.rejects(f.dispatch(),/Persist/);assert.equal(f.replies.length,0);
 f.put('.pi/settings.json',JSON.stringify({extensions:[new URL('../../trellis.ts',import.meta.url).pathname]}));
 f.put(f.task+'/task.json','{"status":"planning"}');await assert.rejects(f.dispatch(),/in_progress/);assert.equal(f.replies.length,0);
 f.put(f.task+'/task.json','{"status":"in_progress"}');
 f.chdir(c.binding.worktreePath);try{await assert.rejects(f.dispatch(),/source project root/);}finally{f.chdir(f.root);}
 await f.dispatch();f.bus.on('subagents:rpc:stop',params=>f.bus.emit('subagents:rpc:stop:reply:'+params.requestId,{success:false,error:'stop denied'}));
 await assert.rejects(f.call({action:'stop'}),/stop denied/);assert.equal(readExecution(c.binding).state,'running');
});


test('spawn failure remains unknown with long-lived host owner instead of releasing ambiguous child',async t=>{
 const f=await stateFixture(t),c=f.prepared;f.failSpawn('ambiguous spawn failed');
 await assert.rejects(f.dispatch(),/ambiguous spawn/);const record=readExecution(c.binding);assert.equal(record.state,'unknown');assert.equal(record.ownerPid,process.pid);assert.equal(record.agentId,undefined);
 await assert.rejects(f.run({action:'recover'}),/still alive/);assert.equal(readExecution(c.binding).state,'unknown');
});

test('modified target runtime is rejected before execution/spawn, even if it attempts lock-time material changes',async t=>{
 const f=await readyFixture(t),c=f.prepared;
 // Change material during the second query, when the source lock is held.
 writeFileSync(join(c.binding.worktreePath,'.trellis/scripts/task.py'),`import pathlib,os,json
if pathlib.Path(${JSON.stringify(join(f.root,'.trellis/.runtime/pi-trellis/worktrees.lock'))}).exists():
 pathlib.Path(${JSON.stringify(f.task+'/prd.md')}).write_text('LATEST lock-time task material')
p=pathlib.Path('.trellis/.runtime/sessions')/(os.environ['TRELLIS_CONTEXT_ID']+'.json')
print(json.dumps({'current_task':json.loads(p.read_text()),'source':'session:'+os.environ['TRELLIS_CONTEXT_ID']}))
`);
 await assert.rejects(f.call({agent:'trellis-implement',prompt:'First line\n\tSecond line'}),/runtime is missing or modified/);
 assert.equal(f.replies.length,0);assert.equal(readExecution(c.binding),undefined);
 assert.equal(readFileSync(join(f.root,f.task,'prd.md'),'utf8'),'Task requirements');
});

test('shutdown while spawn reply is pending retains unknown with returned id, never revives running lease',async t=>{
 const f=await stateFixture(t),c=f.prepared;
 f.bus.on('subagents:rpc:spawn',()=>f.handlers.get('session_shutdown')());
 await assert.rejects(f.dispatch(),/shut down during spawn/);
 const record=readExecution(c.binding);assert.equal(record.state,'unknown');assert.equal(record.agentId,'agent-1');assert.equal(record.ownerPid,process.pid);
});

test('live source changes dispatch directly without refresh or task copies',async t=>{
 const f=await readyFixture(t),c=f.prepared;f.put(f.task+'/prd.md','approved update');
 await f.dispatch();const record=readExecution(c.binding);assert.equal(record.materialRevision,record.sourceFingerprint);assert.equal(record.targetFingerprint.length,64);
 assert.doesNotMatch(f.replies[0].prompt,/approved update|trellis-hook-injected/);assert.match(f.replies[0].prompt,/Trellis authority:/);
});
test('target stale spec and task identity cannot override source authority or change target Git',async t=>{
 const f=await readyFixture(t),c=f.prepared;
 writeFileSync(join(c.binding.worktreePath,'.trellis/spec/spec.md'),'OLD target material');
 mkdirSync(join(c.binding.worktreePath,f.task),{recursive:true});
 writeFileSync(join(c.binding.worktreePath,f.task,'task.json'),'{"status":"planning","id":"another-task"}');
 const targetGit=()=>execFileSync('git',['-C',c.binding.worktreePath,'status','--porcelain'],{encoding:'utf8'});
 const before=targetGit();await f.dispatch();assert.equal(targetGit(),before);
 const {parseDispatchFacts}=await import('../lib/task-context.ts');const facts=parseDispatchFacts(f.replies[0].prompt);
 assert.equal(facts.taskPath,join(f.root,f.task));assert.equal(facts.references[0].path,join(f.root,'.trellis/spec/spec.md'));
 assert.equal(readFileSync(facts.references[0].path,'utf8'),'BASE target spec');assert.doesNotMatch(f.replies[0].prompt,/OLD target material|another-task/);
 f.bus.emit('subagents:completed',{id:'agent-1'});
 rmSync(join(c.binding.worktreePath,f.task),{recursive:true});
 const withoutTarget=await queryWorktree(f.root,f.task,true,undefined,true,'implement');
 assert.equal(withoutTarget.materials.state,'valid');
 assert.equal(withoutTarget.materials.taskPath,facts.taskPath);
 assert.equal(withoutTarget.materials.sourceFingerprint,readExecution(c.binding).sourceFingerprint);
 assert.ok(!existsSync(join(c.binding.worktreePath,f.task)));
});

test('supported source/target release mismatch rejects before provider ping/spawn or target CLI execution',async t=>{
 const f=await readyFixture(t),c=f.prepared;let ping=0;f.bus.on('subagents:rpc:ping',()=>{ping++;});
 const manifest=join(f.root,'.trellis/.pi-trellis.json'),original=readFileSync(manifest);const changed=JSON.parse(original);changed.runtimeReleaseId='unsupported-release';writeFileSync(manifest,JSON.stringify(changed));await assert.rejects(f.dispatch(),/Unsupported project runtime release/);assert.equal(ping,0);assert.equal(f.replies.length,0);writeFileSync(manifest,original);
 const target=join(c.binding.worktreePath,'.trellis/.pi-trellis.json'),record=JSON.parse(readFileSync(target));record.runtimeReleaseId='unsupported-target';writeFileSync(target,JSON.stringify(record));await assert.rejects(f.dispatch(),/Unsupported project runtime release/);assert.equal(f.replies.length,0);assert.equal(readExecution(c.binding),undefined);
});

test('valid multiline dispatch prose retains exact lines through the registered tool',async t=>{
 const f=await stateFixture(t),c=f.prepared;await f.call({agent:'trellis-implement',prompt:'First line\n\tSecond line'});assert.match(f.replies[0].prompt,/First line\n\tSecond line/);assert.equal(readExecution(c.binding).agentId,'agent-1');
});

// Git's repository identity is fixed per fixture; resolve it once instead of on every record read.
const identities=new WeakMap();
const repositoryIdentity=f=>{if(!identities.has(f)){const dir=f.git('rev-parse','--git-common-dir');identities.set(f,dir.startsWith('/')?dir:join(f.root,dir));}return identities.get(f);};
const sourceRecord=f=>readSourceExecution({sourceRoot:f.root,repositoryIdentity:repositoryIdentity(f),taskDir:f.task});
test('unbound source dispatch uses shared cwd, current materials, no binding and per-task overlap',async t=>{
 const f=await fixture(t);f.put(f.task+'/prd.md','UNCOMMITTED source material');
 const first=await f.dispatch();assert.equal(first.details.mode,'source');assert.equal(first.details.cwd,f.root);
 assert.equal(f.replies[0].options.cwd,f.root);assert.equal(f.replies[0].options.isolation,'off');
 assert.doesNotMatch(f.replies[0].prompt,/UNCOMMITTED source material|trellis-hook-injected/);assert.match(f.replies[0].prompt,/Trellis authority:/);assert.match(f.replies[0].prompt,/Shared directory: Other agents/);
 assert.doesNotMatch(f.replies[0].prompt,/Review base:|Trellis material revision:/);assert.equal(readBinding(f.root,f.task),undefined);
 await assert.rejects(f.dispatch(),/running\/unknown/);await assert.rejects(f.run(),/source execution/);
 const other='.trellis/tasks/other';f.put(other+'/task.json','{"status":"in_progress"}');f.put(other+'/prd.md','Other');f.put(other+'/implement.jsonl','{"file":".trellis/spec/spec.md"}');
 const second=await f.call({task:other,agent:'trellis-implement',prompt:'other work'});assert.equal(second.details.agentId,'agent-2');
 assert.equal(sourceRecord(f).state,'running');f.bus.emit('subagents:completed',{id:'agent-1'});assert.equal(sourceRecord(f).state,'completed');
 await f.dispatch('trellis-check');assert.equal(sourceRecord(f).agentId,'agent-3');
 f.bus.emit('subagents:completed',{id:'agent-1'});assert.equal(sourceRecord(f).state,'running');
});
test('source early terminal, stop and shutdown preserve lifecycle truth',async t=>{
 const f=await stateFixture(t,false);f.bus.on('subagents:rpc:spawn',()=>f.bus.emit('subagents:completed',{id:'agent-1'}));
 await f.dispatch();assert.equal(sourceRecord(f).state,'completed');
 await f.dispatch();f.bus.on('subagents:rpc:stop',({requestId})=>f.bus.emit('subagents:rpc:stop:reply:'+requestId,{success:true}));
 await f.call({action:'stop'});assert.equal(sourceRecord(f).state,'running');
 f.handlers.get('session_shutdown')();assert.equal(sourceRecord(f).state,'unknown');
});
test('source dispatch status and lock-time binding changes reject before spawn',async t=>{
 const f=await fixture(t);f.put(f.task+'/task.json','{"status":"planning"}');await assert.rejects(f.dispatch(),/in_progress/);assert.equal(f.replies.length,0);
 f.put(f.task+'/task.json','{"status":"in_progress"}');f.bus.on('subagents:rpc:ping',()=>f.put(f.task+'/task.json','{"status":"planning"}'));
 await assert.rejects(f.dispatch(),/in_progress/);assert.equal(sourceRecord(f),undefined);
});
test('source ambiguous startup and shutdown during reply retain unknown',async t=>{
 const f=await stateFixture(t,false);f.failSpawn('ambiguous source spawn');await assert.rejects(f.dispatch(),/ambiguous/);assert.equal(sourceRecord(f).state,'unknown');await assert.rejects(f.dispatch(),/running\/unknown/);
});
test('source shutdown inside spawn retains returned real id without reviving lease',async t=>{
 const f=await stateFixture(t,false);f.bus.on('subagents:rpc:spawn',()=>f.handlers.get('session_shutdown')());await assert.rejects(f.dispatch(),/shut down during spawn/);
 assert.equal(sourceRecord(f).state,'unknown');assert.equal(sourceRecord(f).agentId,'agent-1');
});

test('new host can request source stop and reconcile terminal evidence from disk',async t=>{
 const f=await stateFixture(t,false);await f.dispatch();f.handlers.get('session_shutdown')();assert.equal(sourceRecord(f).state,'unknown');
 const tools=new Map();registerDispatchTool({events:f.bus,on:()=>{},registerTool:tool=>tools.set(tool.name,tool)},async()=>f.task);
 f.bus.on('subagents:rpc:stop',({requestId,agentId})=>{assert.equal(agentId,'agent-1');f.bus.emit('subagents:rpc:stop:reply:'+requestId,{success:true});});
 await tools.get('trellis_dispatch').execute('new',{action:'stop'},undefined,undefined,{cwd:f.root});assert.equal(sourceRecord(f).state,'unknown');
 f.bus.emit('subagents:completed',{id:'agent-1'});assert.equal(sourceRecord(f).state,'completed');
});
test('source record reader interoperates with Python create preview and rejects malformed leases',async t=>{
 const f=await fixture(t);await f.dispatch();const record=sourceRecord(f);
 const script=new URL('../runtime/query-worktree.py',import.meta.url).pathname;
 assert.equal(JSON.parse(execFileSync('python3',['-B',script,'--cwd',f.root,'--task',f.task],{encoding:'utf8'})).ok,true);
 await assert.rejects(f.run({confirm:false}),/source execution/);
 f.bus.emit('subagents:completed',{id:'agent-1'});const preview=await f.run({confirm:false});assert.equal(preview.preview,true);
});

test('provider ping introducing a binding never switches an unbound dispatch silently',async t=>{
 const f=await fixture(t);f.bus.on('subagents:rpc:ping',()=>execFileSync('python3',['-B',join(f.root,'.trellis/scripts/worktree.py'),'create','--task',f.task,'--confirm'],{cwd:f.root,stdio:'pipe'}));
 await assert.rejects(f.dispatch(),/became bound/);assert.equal(f.replies.length,0);assert.equal(sourceRecord(f),undefined);
});

test('invalid source execution blocks Python create before mutation and preserves record',async t=>{
 const f=await stateFixture(t,false);await f.dispatch();const r=sourceRecord(f);f.bus.emit('subagents:completed',{id:'agent-1'});
 const name=new URL('../lib/source-executions.ts',import.meta.url);const {sourceExecutionFile}=await import(name.href);const file=sourceExecutionFile(r);
 for(const raw of ['null',JSON.stringify({...r,ownerPid:0}),JSON.stringify({...r,version:true}),JSON.stringify({...r,taskDir:'.trellis/tasks/wrong'})]) {
  writeFileSync(file,raw);await assert.rejects(f.run({confirm:false}));assert.equal(readFileSync(file,'utf8'),raw);assert.equal(readBinding(f.root,f.task),undefined);
 }
});

test('terminal before new host first call reconciles cached evidence despite corrupt neighbor',async t=>{
 const f=await stateFixture(t,false);await f.dispatch();f.handlers.get('session_shutdown')();
 const tools=new Map();registerDispatchTool({events:f.bus,on:()=>{},registerTool:tool=>tools.set(tool.name,tool)},async()=>f.task);
 f.put('.trellis/.runtime/pi-trellis/source-executions/'+ '0'.repeat(64)+'.json','null');
 f.bus.emit('subagents:completed',{id:'agent-1'});
 await assert.rejects(tools.get('trellis_dispatch').execute('stop',{action:'stop'},undefined,undefined,{cwd:f.root}),/No known agent id/);
 assert.equal(sourceRecord(f).state,'completed');
 const result=await tools.get('trellis_dispatch').execute('next',{agent:'trellis-check',prompt:'check'},undefined,undefined,{cwd:f.root});assert.equal(result.details.agentId,'agent-2');
});
test('source terminal queues under reservation lock and cannot overwrite a newer request',async t=>{
 const f=await stateFixture(t,false);await f.dispatch();const record=sourceRecord(f);
 const {acquireBindingLock}=await import('../lib/bindings.ts');const {writeSourceExecution}=await import('../lib/source-executions.ts');
 const release=acquireBindingLock(f.root);
 f.bus.emit('subagents:completed',{id:'agent-1'});assert.equal(sourceRecord(f).state,'running');
 // Another lock owner publishes completion, then legally reserves a new request.
 writeSourceExecution({...record,state:'completed'});writeSourceExecution({...record,requestId:'new-request',agentId:'new-agent',state:'running'});release();
 await new Promise(resolve=>setTimeout(resolve,60));assert.equal(sourceRecord(f).requestId,'new-request');assert.equal(sourceRecord(f).state,'running');
});
test('source shutdown queues under reservation lock without overwriting a newer request',async t=>{
 const f=await stateFixture(t,false);await f.dispatch();const record=sourceRecord(f);
 const {acquireBindingLock}=await import('../lib/bindings.ts');const {writeSourceExecution}=await import('../lib/source-executions.ts');const release=acquireBindingLock(f.root);
 f.handlers.get('session_shutdown')();writeSourceExecution({...record,state:'completed'});writeSourceExecution({...record,requestId:'new-request',agentId:'new-agent',state:'running'});release();
 await new Promise(resolve=>setTimeout(resolve,60));assert.equal(sourceRecord(f).requestId,'new-request');assert.equal(sourceRecord(f).state,'running');
});
test('Python source decoder matches UTF16 astral and escaped surrogate bounds',async t=>{
 const f=await stateFixture(t,false);await f.dispatch();const r=sourceRecord(f);f.bus.emit('subagents:completed',{id:'agent-1'});
 const {sourceExecutionFile,readSourceExecution}=await import('../lib/source-executions.ts');const file=sourceExecutionFile(r);
 for(const value of ['😀'.repeat(129),'\ud800'.repeat(257)]) {
  writeFileSync(file,JSON.stringify({...r,state:'completed',requestId:value}));assert.throws(()=>readSourceExecution(r));await assert.rejects(f.run({confirm:false}),/identifier/);
 }
 for(const value of ['😀'.repeat(128),'\ud800'.repeat(256)]) {
  writeFileSync(file,JSON.stringify({...r,state:'completed',requestId:value}));assert.equal(readSourceExecution(r).state,'completed');assert.equal((await f.run({confirm:false})).preview,true);
 }
});

test('selected role isolation: broken check does not block implement/research, but invalid role source spawns zero',async t=>{
 const f=await readyFixture(t),c=f.prepared;f.put(f.task+'/check.jsonl','{"file":"source-missing"}');
 await f.dispatch();f.bus.emit('subagents:completed',{id:'agent-1'});await assert.rejects(f.dispatch('trellis-check'),/source-missing/);assert.equal(f.replies.length,1);
 await f.dispatch('trellis-research');assert.equal(f.replies.length,2);f.bus.emit('subagents:completed',{id:'agent-2'});
 rmSync(join(f.root,f.task,'prd.md'));await assert.rejects(f.dispatch(),/Source material/);assert.equal(f.replies.length,2);assert.equal(readExecution(c.binding).state,'completed');
});
test('source/managed source requirements changed after first role query refuse spawn with no lease',async t=>{
 const {mockPython}=await import('./runtime-fixture.mjs');
 for(const managed of [false,true]) await t.test(managed?'managed drift':'source drift',async child=>{
  const f=managed?await readyFixture(child):await fixture(child);const binding=managed?f.prepared.binding:undefined;
  let count=0;
  mockPython(child,f.root,(args)=>{
   if(!args.includes('--role'))return;
   const stdout=execFileSync(process.env.TRELLIS_PYTHON||'python3',args,{cwd:f.root,encoding:'utf8'});
   if(++count===1)f.put(f.task+'/prd.md','CHANGED after graph before rendering');
   return {stdout};
  });
  await assert.rejects(f.dispatch(),/changed during prompt rendering/);assert.equal(f.replies.length,0);
  if(binding)assert.equal(readExecution(binding),undefined);else assert.equal(sourceRecord(f),undefined);
 });
});
test('target adapter missing rejects managed spawn without executing target CLI',async t=>{
 const f=await readyFixture(t),c=f.prepared;writeFileSync(join(c.binding.worktreePath,'.pi/settings.json'),'{}');
 await assert.rejects(f.dispatch(),/target\/user settings/);assert.equal(f.replies.length,0);assert.equal(readExecution(c.binding),undefined);
});

test('target checkout changes during final native query refuse managed spawn with no lease',async t=>{
 const f=await readyFixture(t),c=f.prepared;const {mockPython}=await import('./runtime-fixture.mjs');let queries=0;
 mockPython(t,f.root,args=>{
  if(!args.includes('--role'))return;
  const stdout=execFileSync(process.env.TRELLIS_PYTHON||'python3',args,{cwd:f.root,encoding:'utf8'});
  if(++queries===2)writeFileSync(join(c.binding.worktreePath,'code.txt'),'changed after captured snapshot');
  return {stdout};
 });
 await assert.rejects(f.dispatch(),/checkout changed during prompt rendering/);assert.equal(f.replies.length,0);assert.equal(readExecution(c.binding),undefined);
});

const scoped=fn=>t=>cwdScope.run({},()=>fn(t));
describe('dispatch (independent copied projects)',()=>{for(const c of cases)it(c.name,scoped(c.fn));});
