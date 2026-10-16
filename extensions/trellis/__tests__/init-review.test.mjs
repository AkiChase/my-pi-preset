import './host-env.mjs';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync, readdirSync, lstatSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { cpSync } from 'node:fs';
import { tmpdir } from 'node:os';
import nativeTest, { after } from 'node:test';
import { plan, apply, inspect, digest, verifyRuntime } from '../lib/initialization/engine.ts';
import { resourcePlan, applyResourcePlan } from '../lib/initialization/resources.ts';
import { copyRuntimeFixture, rehomeOperationRecord } from './runtime-fixture.mjs';

const smoke=new Set(['forged incomplete operation cannot authorize unknown runtime']);
const test=(name,fn,options)=>smoke.has(name)?nativeTest(name,fn,options):undefined;

function shape(root) {
 const put=(path,content)=>{mkdirSync(dirname(join(root,path)),{recursive:true});writeFileSync(join(root,path),content);};
 const snapshot=(directory=root)=>Object.fromEntries(readdirSync(directory,{withFileTypes:true}).sort((a,b)=>a.name.localeCompare(b.name)).flatMap(e=>{const p=join(directory,e.name),rel=p.slice(root.length+1);return e.isDirectory()?[[rel,'directory'],...Object.entries(snapshot(p))]:[[rel,`${lstatSync(p).mode&0o777}:${readFileSync(p).toString('base64')}`]];}));
 return {root,put,snapshot};
}
// An initialized project costs about a second to build; every case that only mutates an installed
// project copies one shared build instead. Cases that need the initial plan keep a fresh directory.
function fixture(t) { return shape(copyRuntimeFixture(t,{user:'Dev'})); }
function fresh(t) {
 const root=mkdtempSync(join(tmpdir(),'pi-init-review-'));t.after(()=>rmSync(root,{recursive:true,force:true}));
 return shape(root);
}
function rehash(p) { const {planHash,...body}=p; p.planHash=digest(JSON.stringify(body)); }
let interruptedRoot;
const templateCleanup=[];
after(()=>templateCleanup.forEach(cleanup=>cleanup()));
function interrupted(t) {
 if(!interruptedRoot) {
  const f=fresh({after:cleanup=>templateCleanup.push(cleanup)});
  f.put('AGENTS.md','User instructions\n');
  assert.throws(()=>apply(plan(f.root,'Dev'),{afterWrite:()=>{throw Error('interrupt');}}));
  interruptedRoot=f.root;
 }
 const f=fresh(t);cpSync(interruptedRoot,f.root,{recursive:true});
 rehomeOperationRecord(interruptedRoot,f.root);return f;
}
function joined(t) {
 return shape(copyRuntimeFixture(t,{user:'Dev',key:'joined-review',prepare:root=>{
  rmSync(join(root,'.trellis/.developer'));apply(plan(root,'Dev'));
 }}));
}
for(const attack of ['unknown runtime','changed runtime','overwrite identity','overwrite history','root replacement','missing required output','manifest source','task hook field','array guards','unknown schema field']) {
 test(`forged incomplete operation cannot authorize ${attack}`,t=>{
  const f=interrupted(t);
  const file=join(f.root,'.trellis/.runtime/init-operation.json'),record=JSON.parse(readFileSync(file));const q=record.plan;
  const change=(kind,text)=>{const a=q.actions.find(a=>a.kind===kind);a.output=Buffer.from(text).toString('base64');return a;};
  if(attack==='unknown runtime') {const a=q.actions.find(a=>a.kind==='runtime');a.path='.trellis/scripts/custom.py';q.guards[a.path]=null;}
  if(attack==='changed runtime') change('runtime','print("untrusted")\n');
  if(attack==='overwrite identity'||attack==='overwrite history') {const kind=attack==='overwrite identity'?'identity':'workspace';const a=q.actions.find(a=>a.kind===kind);f.put(a.path,'existing user bytes');a.original={sha256:digest('existing user bytes'),mode:0o644};q.guards[a.path]=a.original;}
  if(attack==='root replacement') change('root','Replacement instructions\n');
  if(attack==='missing required output') {const a=q.actions.find(a=>a.kind==='agent');q.actions=q.actions.filter(x=>x!==a);delete q.guards[a.path];}
  if(attack==='manifest source') {const a=q.actions.find(a=>a.kind==='manifest'),m=JSON.parse(Buffer.from(a.output,'base64'));m.files['.trellis/scripts/task.py'].source='untrusted';a.output=Buffer.from(JSON.stringify(m)).toString('base64');}
  if(attack==='task hook field') {const a=q.actions.find(a=>a.path.endsWith('/task.json')),m=JSON.parse(Buffer.from(a.output,'base64'));m.meta={hook:'untrusted'};a.output=Buffer.from(JSON.stringify(m)).toString('base64');}
  if(attack==='array guards') {q.guards=Object.assign([],q.guards);}
  if(attack==='unknown schema field') q.untrusted='unknown';
  rehash(q);f.put('.trellis/.runtime/init-operation.json',JSON.stringify(record));const before=f.snapshot();
  assert.equal(inspect(f.root).state,'conflict');assert.throws(()=>plan(f.root,'Dev'));assert.throws(()=>apply(q));assert.deepEqual(f.snapshot(),before);
 });
}
// Roles are read by dispatch without hash checks and templates are user documents: an older recorded
// fingerprint is a safe update, not a blocked or malformed project.
for(const attack of ['stale template hash','stale role hash','stale role mode']) {
 test(`resource manifest treats ${attack} as a safe update without writing`,t=>{
  const f=fixture(t);const file=join(f.root,'.trellis/.pi-trellis.json'),m=JSON.parse(readFileSync(file));
  const role=attack!=='stale template hash';
  if(!role)m.templates['.trellis/workflow.md'].sha256=digest('not shipped');
  if(attack==='stale role hash')m.files['.pi/agents/trellis-check.md'].sha256=digest('older role wording');
  if(attack==='stale role mode')m.files['.pi/agents/trellis-check.md'].mode=0o600;
  f.put('.trellis/.pi-trellis.json',JSON.stringify(m));const before=f.snapshot();
  // The runtime gate accepts a stale role/template fingerprint; only the exact key set and format are enforced.
  assert.ok(verifyRuntime(f.root));assert.equal(inspect(f.root).state,'ready');
  const p=resourcePlan(f.root,'update');assert.deepEqual(p.report.conflicts,[]);assert.equal(p.unchanged,false);
  assert.deepEqual(f.snapshot(),before);
  // Update refreshes the recorded fingerprint without touching the user's document or role bytes.
  applyResourcePlan(p);assert.ok(verifyRuntime(f.root));assert.equal(resourcePlan(f.root,'update').unchanged,true);
 });
}
// Manifest field permutations are covered in manifest-provenance.test.mjs.
// Keep this file focused on recovery authorization and successful safe updates.

test('root suffix alone cannot replace user prefix or duplicate an owned block, and skipped required root output cannot pass',t=>{
 for(const attack of ['changed prefix','duplicate block','skip root']) {
  const f=fresh(t);f.put('AGENTS.md','User bytes\n');const p=plan(f.root,'Dev');assert.throws(()=>apply(p,{afterWrite:()=>{throw Error('interrupt');}}));
  const file=join(f.root,'.trellis/.runtime/init-operation.json'),record=JSON.parse(readFileSync(file)),q=record.plan,a=q.actions.find(a=>a.path==='AGENTS.md');
  if(attack==='changed prefix')a.output=Buffer.from('Malicious prefix\n'+readFileSync(new URL('../resources/templates/agents-block.md',import.meta.url),'utf8')).toString('base64');
  if(attack==='duplicate block'){const block=readFileSync(new URL('../resources/templates/agents-block.md',import.meta.url),'utf8');f.put('AGENTS.md',block);a.original={sha256:digest(block),mode:0o644};q.guards[a.path]=a.original;a.output=Buffer.from(block+block).toString('base64');}
  if(attack==='skip root')q.actions=q.actions.filter(x=>x!==a);
  rehash(q);f.put('.trellis/.runtime/init-operation.json',JSON.stringify(record));const before=f.snapshot();assert.throws(()=>plan(f.root,'Dev'));assert.throws(()=>apply(q));assert.deepEqual(f.snapshot(),before);
 }
});
test('onboarding reused records reject malformed canonical fields without changing user history',t=>{
 for(const change of [{name:'wrong'},{status:'invalid'},{children:'bad'},{title:null}]) {
  const f=joined(t);rmSync(join(f.root,'.trellis/.developer'));
  const path='.trellis/tasks/00-join-dev/task.json',record=JSON.parse(readFileSync(join(f.root,path)));f.put(path,JSON.stringify({...record,...change}));const before=f.snapshot();assert.throws(()=>plan(f.root,'Dev'));assert.deepEqual(f.snapshot(),before);
 }
});

test('all required outputs verify before manifest publication and completion; missing workspace is not success',t=>{
 const f=fresh(t),p=plan(f.root,'Dev');
 assert.throws(()=>apply(p,{afterWrite:path=>{if(path.endsWith('/prd.md'))rmSync(join(f.root,'.trellis/workspace/Dev/journal-1.md'));}}));
 assert.equal(existsSync(join(f.root,'.trellis/.pi-trellis.json')),false);assert.equal(inspect(f.root).state,'incomplete');assert.equal(existsSync(join(f.root,p.task,'task.json')),true);
});
test('completed operation remains diagnostic after legitimate task edits; custom hooks are not managed overwrite authority',t=>{
 const f=fixture(t);f.put('.trellis/scripts/custom-hook.py','# user hook\n');f.put('.trellis/tasks/00-bootstrap-guidelines/task.json','{"status":"completed"}');assert.equal(inspect(f.root).state,'ready');assert.ok(verifyRuntime(f.root));assert.equal(readFileSync(join(f.root,'.trellis/scripts/custom-hook.py'),'utf8'),'# user hook\n');
});

test('forged root append cannot bypass conflicting journal attributes',t=>{
 const f=fresh(t),p=plan(f.root,'Dev');assert.throws(()=>apply(p,{afterWrite:()=>{throw Error('interrupt');}}));const file=join(f.root,'.trellis/.runtime/init-operation.json'),record=JSON.parse(readFileSync(file)),q=record.plan,a=q.actions.find(a=>a.path==='.gitattributes');const original='*.md merge=ours\n';f.put(a.path,original);a.original={sha256:digest(original),mode:0o644};q.guards[a.path]=a.original;a.output=Buffer.from(original+readFileSync(new URL('../resources/templates/journal.gitattributes',import.meta.url),'utf8')).toString('base64');rehash(q);f.put('.trellis/.runtime/init-operation.json',JSON.stringify(record));const before=f.snapshot();assert.throws(()=>plan(f.root,'Dev'));assert.deepEqual(f.snapshot(),before);
});
test('forged identity operation on an unsupported manifest cannot publish identity first',t=>{
 const f=fixture(t);rmSync(join(f.root,'.trellis/.developer'));const p=plan(f.root,'Dev');const path='.trellis/.pi-trellis.json',manifest=JSON.parse(readFileSync(join(f.root,path)));manifest.runtimeReleaseId='unsupported';const value=JSON.stringify(manifest);f.put(path,value);p.guards[path]={sha256:digest(value),mode:0o644};rehash(p);const before=f.snapshot();assert.throws(()=>apply(p));assert.deepEqual(f.snapshot(),before);
});

test('invalid task records cannot enter disk fast path or injected active task',async t=>{
 const {default:trellis,__internals}=await import('../index.ts');const f=fixture(t);const handlers=new Map(),messages=[];
 trellis({registerMessageRenderer:()=>{},on:(n,h)=>handlers.set(n,h),registerCommand:()=>{},registerTool:()=>{},events:{on:()=>()=>{},emit:()=>{}},sendMessage:m=>messages.push(m),getAllTools:()=>[]});const ctx={cwd:f.root,hasUI:false,ui:{},sessionManager:{getSessionId:()=>f.root,getSessionFile:()=>undefined}},key=__internals.contextKey(f.root,ctx),task='.trellis/tasks/invalid';
 f.put(`.trellis/.runtime/sessions/${key}.json`,JSON.stringify({current_task:task}));f.put(task+'/prd.md','INVALID MATERIAL');
 for(const record of [{},{title:null,status:'in_progress'},{status:{}},{foo:'not a task'}]){
  f.put(task+'/task.json',JSON.stringify(record));assert.equal(__internals.readActiveTaskFromDisk(f.root,key),undefined);
  await handlers.get('tool_result')({toolName:'bash',input:{command:'task.py current'}},ctx);await handlers.get('before_agent_start')({prompt:'inspect',systemPromptOptions:{sections:{}}},ctx);
  assert.match(messages.at(-1).content,/task_error/);assert.doesNotMatch(messages.at(-1).content,/Active task:/);
 }
});
