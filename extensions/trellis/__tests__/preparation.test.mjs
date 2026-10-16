import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import nativeTest from 'node:test';
import { canonicalPath } from '../lib/config.ts';
import { installWorktreeCli, manageWorktree } from './worktree-fixture.mjs';
import { readBinding } from '../lib/bindings.ts';
import { writeExecution } from '../lib/executions.ts';

const smoke=new Set([
 'prepare preview/confirm use source materials without task copies, start, hooks, pointers or Git changes',
]);
const test=(name,fn,options)=>smoke.has(name)?nativeTest(name,fn,options):undefined;

export function fixture(t) {
 const root=canonicalPath(mkdtempSync(join(tmpdir(),'pi-w2-')));
 t.after(()=>rmSync(root,{recursive:true,force:true}));
 const put=(path,data)=>{mkdirSync(join(root,path,'..'),{recursive:true});writeFileSync(join(root,path),data);};
 const git=(...args)=>execFileSync('git',['-C',root,...args],{encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
 git('init','-q');
 put('.gitignore','/.worktree/\n/.trellis/.runtime/\n/.pi/\n');
 put('.trellis/workflow.md','fixture workflow\n');
 put('code.txt','baseline\n');put('.trellis/spec/spec.md','committed specification\n');
 // Fixture task.py would produce a pointer if accidentally executed; S1 must never call it.
 put('.trellis/scripts/task.py',`import os,sys,json,pathlib
root=pathlib.Path.cwd()
token=os.environ['TRELLIS_CONTEXT_ID']
pointer=root/'.trellis/.runtime/sessions'/f'{token}.json'
if sys.argv[1]=='start':
 pointer.parent.mkdir(parents=True,exist_ok=True)
 pointer.write_text(json.dumps({'current_task':sys.argv[2]}))
 print('started')
else:
 task=json.loads(pointer.read_text())['current_task']
 print(json.dumps({'current_task':{'dir':task},'source':'session:'+token,'stale':False}))
`);
 installWorktreeCli(root);
 git('add','.');git('-c','user.name=Fixture','-c','user.email=fixture@example.invalid','-c','commit.gpgsign=false','commit','-qm','fixture');
 const task='.trellis/tasks/10-13-task';
 put(task+'/task.json',JSON.stringify({status:'in_progress',name:'10-13-task'}));
 put(task+'/prd.md','Requirements\n');put(task+'/research/topic.md','selected research\n');
 for(const role of ['implement','check']) put(task+'/'+role+'.jsonl',JSON.stringify({file:'.trellis/spec/spec.md'})+'\n'+JSON.stringify({file:task+'/research/topic.md'})+'\n');
 const run=(opts={})=>manageWorktree({action:'create',cwd:root,task,confirm:true,...opts});
 return {root,put,git,task,run};
}

test('prepare preview/confirm use source materials without task copies, start, hooks, pointers or Git changes',async t=>{
 const f=fixture(t),created=await f.run(),target=created.binding.worktreePath;
 writeExecution(created.binding,{bindingId:created.binding.bindingId,requestId:'orphan',state:'unknown',role:'trellis-check',ownerPid:2147483647,ownerToken:'old',createdAt:new Date().toISOString()});
 const recoveryPreview=await f.run({action:'recover',confirm:false});assert.equal(recoveryPreview.preview,true);const recovered=await f.run({action:'recover'});assert.equal(recovered.binding.preparationState,'unprepared');
 const sourceRecord=readFileSync(join(f.root,f.task,'task.json'));
 const targetGit=(...args)=>execFileSync('git',['-C',target,...args],{encoding:'utf8'});
 const snapshot=()=>[targetGit('status','--porcelain'),targetGit('diff'),targetGit('diff','--cached')];
 const before=snapshot();
 const preview=await f.run({action:'prepare',confirm:false});assert.equal(preview.preview,true);assert.match(preview.note,/No task copies/);
 assert.ok(!existsSync(join(target,f.task)));
 const ready=await f.run({action:'prepare'});assert.equal(ready.binding.preparationState,'ready');assert.equal(ready.binding.version,2);
 assert.deepEqual(snapshot(),before);assert.deepEqual(readFileSync(join(f.root,f.task,'task.json')),sourceRecord);
 assert.ok(!existsSync(join(target,f.task)));assert.ok(!existsSync(join(f.root,'.trellis/.runtime/sessions')));
 assert.ok(!existsSync(join(target,'.trellis/.runtime/sessions')));
 assert.equal(ready.materials.role,'implement');assert.equal(ready.materials.taskPath,join(f.root,f.task));
 assert.equal(ready.materials.specRoot,join(f.root,'.trellis/spec'));
 assert.ok(ready.materials.references.some(ref=>ref.path===join(f.root,f.task,'research/topic.md')));
 assert.equal(Object.hasOwn(ready.binding,'materials'),false);assert.equal(Object.hasOwn(ready.binding,'preparedFiles'),false);
 assert.equal((await f.run({action:'prepare'})).reused,true);
 const removalPreview=await f.run({action:'remove',confirm:false,integratedInto:'HEAD'});assert.equal(removalPreview.preview,true);assert.match(removalPreview.note,/Ignored files/);
 writeFileSync(join(target,'new.txt'),'unsaved');await assert.rejects(f.run({action:'remove',integratedInto:'HEAD'}),/untracked/);rmSync(join(target,'new.txt'));
 await f.run({action:'remove',integratedInto:'HEAD'});assert.ok(!existsSync(target));assert.equal(readBinding(f.root,f.task),undefined);assert.ok(f.git('rev-parse',`refs/heads/${created.binding.branch}`));
});

test('planning task and broken own references fail; uncommitted source specs are valid without target comparison',async t=>{
 const f=fixture(t);await f.run();
 f.put(f.task+'/task.json','{"status":"planning"}');await assert.rejects(f.run({action:'prepare'}),/normal workflow/);
 f.put(f.task+'/task.json','{"status":"in_progress"}');
 f.put(f.task+'/implement.jsonl',JSON.stringify({file:'.trellis/spec/missing.md'}));await assert.rejects(f.run({action:'prepare'}),/Source material/);
 f.put(f.task+'/implement.jsonl',JSON.stringify({file:'.trellis/spec/spec.md'}));
 f.put('.trellis/spec/spec.md','uncommitted spec');const result=await f.run({action:'prepare'});
 assert.equal(result.materials.references[0].path,join(f.root,'.trellis/spec/spec.md'));
});

test('existing target materials are irrelevant and never overwritten',async t=>{
 const f=fixture(t),created=await f.run();
 const dest=join(created.binding.worktreePath,f.task);mkdirSync(dest,{recursive:true});writeFileSync(join(dest,'prd.md'),'user target PRD');
 await f.run({action:'prepare'});
 assert.equal(readFileSync(join(dest,'prd.md'),'utf8'),'user target PRD');assert.equal(readBinding(f.root,f.task).preparationState,'ready');
 await assert.rejects(f.run({action:'remove',integratedInto:'HEAD'}),/untracked/);
 assert.equal(readFileSync(join(dest,'prd.md'),'utf8'),'user target PRD');
});

test('remove cannot delete current worktree or unknown execution; recover live owner refused',async t=>{
 const f=fixture(t),created=await f.run();
 await assert.rejects(f.run({action:'remove',cwd:created.binding.worktreePath,integratedInto:'HEAD'}),/current working/);
 writeExecution(created.binding,{bindingId:created.binding.bindingId,requestId:'r',state:'unknown',role:'trellis-check',ownerPid:process.pid,ownerToken:'token',createdAt:new Date().toISOString()});
 await assert.rejects(f.run({action:'remove',integratedInto:'HEAD'}),/active|unknown/);
 await assert.rejects(f.run({action:'recover'}),/still alive/);
});

test('committed target task metadata remains byte-identical, including source branch',async t=>{
 const f=fixture(t);f.put(f.task+'/task.json','{"status":"in_progress","branch":"source-branch"}');
 f.git('add',f.task);f.git('-c','user.name=Fixture','-c','user.email=fixture@example.invalid','-c','commit.gpgsign=false','commit','-qm','committed task');
 const created=await f.run(), before=readFileSync(join(created.binding.worktreePath,f.task,'task.json'));await f.run({action:'prepare'});
 assert.deepEqual(readFileSync(join(created.binding.worktreePath,f.task,'task.json')),before);
 assert.equal(JSON.parse(readFileSync(join(f.root,f.task,'task.json'))).branch,'source-branch');
});

test('remove rejects commits not preserved in the approved reference',async t=>{
 const f=fixture(t),created=await f.run();
 const target=created.binding.worktreePath;
 writeFileSync(join(target,'code.txt'),'new commit');
 execFileSync('git',['-C',target,'add','code.txt']);
 execFileSync('git',['-C',target,'-c','user.name=Fixture','-c','user.email=fixture@example.invalid','-c','commit.gpgsign=false','commit','-qm','unintegrated fixture']);
 await assert.rejects(f.run({action:'remove',integratedInto:f.git('rev-parse','HEAD')}),/merge-base/);
 assert.ok(existsSync(target));
});

test('stale target can be explicitly unbound without deleting branch',async t=>{
 const f=fixture(t),created=await f.run();rmSync(created.binding.worktreePath,{recursive:true});
 const result=await f.run({action:'remove'});assert.match(result.note,/Removed/);assert.equal(readBinding(f.root,f.task),undefined);
});

test('prepare preview/confirm reject running and unknown leases without material writes',async t=>{
 const f=fixture(t),created=await f.run();
 for(const state of ['running','unknown']){
  writeExecution(created.binding,{bindingId:created.binding.bindingId,requestId:'busy',state,role:'trellis-implement',ownerPid:process.pid,ownerToken:'x',createdAt:new Date().toISOString()});
  for(const confirm of [false,true])await assert.rejects(f.run({action:'prepare',confirm}),/active|unknown/);
  assert.equal(readBinding(f.root,f.task).preparationState,'unprepared');assert.ok(!existsSync(join(created.binding.worktreePath,f.task)));
 }
});
