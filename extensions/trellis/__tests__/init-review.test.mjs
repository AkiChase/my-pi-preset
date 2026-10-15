import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync, readdirSync, lstatSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import test from 'node:test';
import { plan, apply, inspect, digest, verifyRuntime } from '../lib/initialization/engine.ts';

function fixture(t) {
 const root=mkdtempSync(join(tmpdir(),'pi-init-review-'));t.after(()=>rmSync(root,{recursive:true,force:true}));
 const put=(path,content)=>{mkdirSync(dirname(join(root,path)),{recursive:true});writeFileSync(join(root,path),content);};
 const snapshot=(directory=root)=>Object.fromEntries(readdirSync(directory,{withFileTypes:true}).sort((a,b)=>a.name.localeCompare(b.name)).flatMap(e=>{const p=join(directory,e.name),rel=p.slice(root.length+1);return e.isDirectory()?[[rel,'directory'],...Object.entries(snapshot(p))]:[[rel,`${lstatSync(p).mode&0o777}:${readFileSync(p).toString('base64')}`]];}));
 return {root,put,snapshot};
}
function rehash(p) { const {planHash,...body}=p; p.planHash=digest(JSON.stringify(body)); }
for(const attack of ['unknown runtime','changed runtime','overwrite identity','overwrite history','root replacement','missing required output','manifest source','task hook field','array guards','unknown schema field']) {
 test(`forged incomplete operation cannot authorize ${attack}`,t=>{
  const f=fixture(t);f.put('AGENTS.md','User instructions\n');const p=plan(f.root,'Dev');
  assert.throws(()=>apply(p,{afterWrite:()=>{throw Error('interrupt');}}));
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
for(const attack of ['unknown template','wrong source','wrong initial template hash','missing role']) {
 test(`resource manifest rejects ${attack} without running or writing`,t=>{
  const f=fixture(t);apply(plan(f.root,'Dev'));const file=join(f.root,'.trellis/.pi-trellis.json'),m=JSON.parse(readFileSync(file));
  if(attack==='unknown template')m.templates['user.txt']={sha256:digest('x'),mode:0o644,origin:'package-default',source:'user.txt'};
  if(attack==='wrong source')m.files['.trellis/scripts/task.py'].source=null;
  if(attack==='wrong initial template hash')m.templates['.trellis/workflow.md'].sha256=digest('not shipped');
  if(attack==='missing role')delete m.files['.pi/agents/trellis-check.md'];
  f.put('.trellis/.pi-trellis.json',JSON.stringify(m));const before=f.snapshot();assert.throws(()=>verifyRuntime(f.root));assert.equal(inspect(f.root).state,'conflict');assert.deepEqual(f.snapshot(),before);
 });
}

test('root suffix alone cannot replace user prefix or duplicate an owned block, and skipped required root output cannot pass',t=>{
 for(const attack of ['changed prefix','duplicate block','skip root']) {
  const f=fixture(t);f.put('AGENTS.md','User bytes\n');const p=plan(f.root,'Dev');assert.throws(()=>apply(p,{afterWrite:()=>{throw Error('interrupt');}}));
  const file=join(f.root,'.trellis/.runtime/init-operation.json'),record=JSON.parse(readFileSync(file)),q=record.plan,a=q.actions.find(a=>a.path==='AGENTS.md');
  if(attack==='changed prefix')a.output=Buffer.from('Malicious prefix\n'+readFileSync(new URL('../resources/templates/agents-block.md',import.meta.url),'utf8')).toString('base64');
  if(attack==='duplicate block'){const block=readFileSync(new URL('../resources/templates/agents-block.md',import.meta.url),'utf8');f.put('AGENTS.md',block);a.original={sha256:digest(block),mode:0o644};q.guards[a.path]=a.original;a.output=Buffer.from(block+block).toString('base64');}
  if(attack==='skip root')q.actions=q.actions.filter(x=>x!==a);
  rehash(q);f.put('.trellis/.runtime/init-operation.json',JSON.stringify(record));const before=f.snapshot();assert.throws(()=>plan(f.root,'Dev'));assert.throws(()=>apply(q));assert.deepEqual(f.snapshot(),before);
 }
});
test('onboarding reused records reject malformed canonical fields without changing user history',t=>{
 for(const change of [{name:'wrong'},{status:'invalid'},{children:'bad'},{title:null}]) {
  const f=fixture(t);apply(plan(f.root,'Dev'));rmSync(join(f.root,'.trellis/.developer'));apply(plan(f.root,'Dev'));rmSync(join(f.root,'.trellis/.developer'));
  const path='.trellis/tasks/00-join-dev/task.json',record=JSON.parse(readFileSync(join(f.root,path)));f.put(path,JSON.stringify({...record,...change}));const before=f.snapshot();assert.throws(()=>plan(f.root,'Dev'));assert.deepEqual(f.snapshot(),before);
 }
});

test('all required outputs verify before manifest publication and completion; missing workspace is not success',t=>{
 const f=fixture(t),p=plan(f.root,'Dev');
 assert.throws(()=>apply(p,{afterWrite:path=>{if(path.endsWith('/prd.md'))rmSync(join(f.root,'.trellis/workspace/Dev/journal-1.md'));}}));
 assert.equal(existsSync(join(f.root,'.trellis/.pi-trellis.json')),false);assert.equal(inspect(f.root).state,'incomplete');assert.equal(existsSync(join(f.root,p.task,'task.json')),true);
});
test('published manifest during an incomplete operation cannot authorize runtime execution',t=>{
 const f=fixture(t),p=plan(f.root,'Dev');assert.throws(()=>apply(p,{afterWrite:path=>{if(path==='.trellis/.pi-trellis.json')throw Error('interrupt');}}));
 assert.throws(()=>verifyRuntime(f.root),/incomplete|Interrupted/);assert.equal(apply(plan(f.root,'Dev')).state,'ready');
});
test('completed operation remains diagnostic after legitimate task edits; custom hooks are not managed overwrite authority',t=>{
 const f=fixture(t);apply(plan(f.root,'Dev'));f.put('.trellis/scripts/custom-hook.py','# user hook\n');f.put('.trellis/tasks/00-bootstrap-guidelines/task.json','{"status":"completed"}');assert.equal(inspect(f.root).state,'ready');assert.ok(verifyRuntime(f.root));assert.equal(readFileSync(join(f.root,'.trellis/scripts/custom-hook.py'),'utf8'),'# user hook\n');
});

test('forged root append cannot bypass conflicting journal attributes',t=>{
 const f=fixture(t),p=plan(f.root,'Dev');assert.throws(()=>apply(p,{afterWrite:()=>{throw Error('interrupt');}}));const file=join(f.root,'.trellis/.runtime/init-operation.json'),record=JSON.parse(readFileSync(file)),q=record.plan,a=q.actions.find(a=>a.path==='.gitattributes');const original='*.md merge=ours\n';f.put(a.path,original);a.original={sha256:digest(original),mode:0o644};q.guards[a.path]=a.original;a.output=Buffer.from(original+readFileSync(new URL('../resources/templates/journal.gitattributes',import.meta.url),'utf8')).toString('base64');rehash(q);f.put('.trellis/.runtime/init-operation.json',JSON.stringify(record));const before=f.snapshot();assert.throws(()=>plan(f.root,'Dev'));assert.deepEqual(f.snapshot(),before);
});
test('forged identity operation on an unsupported manifest cannot publish identity first',t=>{
 const f=fixture(t);apply(plan(f.root,'Dev'));rmSync(join(f.root,'.trellis/.developer'));const p=plan(f.root,'Dev');const path='.trellis/.pi-trellis.json',manifest=JSON.parse(readFileSync(join(f.root,path)));manifest.runtimeReleaseId='unsupported';const value=JSON.stringify(manifest);f.put(path,value);p.guards[path]={sha256:digest(value),mode:0o644};rehash(p);const before=f.snapshot();assert.throws(()=>apply(p));assert.deepEqual(f.snapshot(),before);
});

test('invalid task records cannot enter disk fast path or injected active task',async t=>{
 const {default:trellis,__internals}=await import('../index.ts');const f=fixture(t);apply(plan(f.root,'Dev'));const handlers=new Map(),messages=[];
 trellis({on:(n,h)=>handlers.set(n,h),registerCommand:()=>{},registerTool:()=>{},events:{on:()=>()=>{},emit:()=>{}},sendMessage:m=>messages.push(m),getAllTools:()=>[]});const ctx={cwd:f.root,hasUI:false,ui:{},sessionManager:{getSessionId:()=>f.root,getSessionFile:()=>undefined}},key=__internals.contextKey(f.root,ctx),task='.trellis/tasks/invalid';
 f.put(`.trellis/.runtime/sessions/${key}.json`,JSON.stringify({current_task:task}));f.put(task+'/prd.md','INVALID MATERIAL');
 for(const record of [{},{title:null,status:'in_progress'},{status:{}},{foo:'not a task'}]){
  f.put(task+'/task.json',JSON.stringify(record));assert.equal(__internals.readActiveTaskFromDisk(f.root,key),undefined);
  await handlers.get('tool_result')({toolName:'bash',input:{command:'task.py current'}},ctx);await handlers.get('before_agent_start')({prompt:'inspect',systemPromptOptions:{sections:{}}},ctx);
  assert.match(messages.at(-1).content,/task_error/);assert.doesNotMatch(messages.at(-1).content,/Active task:/);
 }
});
