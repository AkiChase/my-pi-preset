import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync, statSync, symlinkSync, cpSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';
import { canonicalPath } from '../lib/config.ts';
import { acquireBindingLock, readBinding, atomicRecord, bindingFile } from '../lib/bindings.ts';
import { readExecution, writeExecution, worktreeSnapshot } from '../lib/executions.ts';
import { installWorktreeCli } from './worktree-fixture.mjs';
import { fileURLToPath } from 'node:url';

// Trellis resource root; tests never depend on the process cwd.
const pkg = fileURLToPath(new URL('..', import.meta.url));
// S1 exercises the native role protocol directly; the host adapter is S2.
async function queryWorktree(root,task,ready=false,role='implement') {
 const result=execute([resolve(pkg,'runtime/query-worktree.py'),'--cwd',root,'--task',task,'--role',role,...(ready?['--ready']:[])]);
 const value=JSON.parse(result.stdout);if(result.status!==0)throw Error(value.error);return value;
}

const python = execFileSync('which',[process.env.TRELLIS_PYTHON || 'python3'],{encoding:'utf8'}).trim();
const execute = (args, options={}) => spawnSync(python, ['-B', ...args], { encoding:'utf8', env:{...process.env, PYTHONDONTWRITEBYTECODE:'1'}, ...options });
function fixture(t) {
 const root = canonicalPath(mkdtempSync(join(tmpdir(),'pi-native-'))); t.after(()=>rmSync(root,{recursive:true,force:true}));
 const put=(path,data)=>{mkdirSync(join(root,path,'..'),{recursive:true});writeFileSync(join(root,path),data);};
 const git=(...args)=>execFileSync('git',['-C',root,...args],{encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
 git('init','-q');put('.gitignore','/.worktree/\n/.trellis/.runtime/\n/.pi/\n');put('code.txt','base');put('.trellis/spec/spec.md','spec');put('.trellis/workflow.md','workflow');
 put('.trellis/scripts/task.py',`import pathlib,os,sys,json
p=pathlib.Path('.trellis/.runtime/sessions')/(os.environ['TRELLIS_CONTEXT_ID']+'.json')
if sys.argv[1]=='start':
 p.parent.mkdir(parents=True,exist_ok=True);p.write_text(json.dumps({'dir':sys.argv[2]}));print('hook progress')
else: print(json.dumps({'current_task':json.loads(p.read_text()),'source':'session:'+os.environ['TRELLIS_CONTEXT_ID']}))
`);
 installWorktreeCli(root);
 git('add','.');git('-c','user.name=Fixture','-c','user.email=fixture@example.invalid','-c','commit.gpgsign=false','commit','-qm','fixture');
 const task='.trellis/tasks/native';put(task+'/task.json','{"status":"in_progress"}');put(task+'/prd.md','需求');
 for(const role of ['implement','check'])put(task+'/'+role+'.jsonl',JSON.stringify({file:'.trellis/spec/spec.md'}));
 const cli=join(root,'.trellis/scripts/worktree.py');
 const run=(action, flags=[], options={})=>execute([cli,action,'--task',task,'--cwd',root,'--json',...flags],options);
 const ok=(action,flags=[],options={})=>{const r=run(action,flags,options);assert.equal(r.status,0,r.stderr);return JSON.parse(r.stdout);};
 return {root,task,put,git,cli,run,ok};
}

test('strict CLI help/operation arguments reject before writes, including duplicate flags and whitespace/control values',t=>{
 const f=fixture(t);
 const help=execute([f.cli,'--help']);assert.equal(help.status,0);assert.match(help.stdout,/create.*adopt.*status.*prepare.*recover.*remove/s);
 assert.doesNotMatch(help.stdout,/refresh|collect/);
 const prepareHelp=execute([f.cli,'prepare','--help']);assert.equal(prepareHelp.status,0);assert.match(prepareHelp.stdout,/existing user-approved scope/);assert.doesNotMatch(prepareHelp.stdout,/approval of preview/);
 for(const [action,flags] of [
  ['refresh',[]],['collect',[]],['prepare',['--file',f.task+'/prd.md']],['prepare',['--role','invalid']],['prepare',['--role','implement','--role','check']],['refresh',['--base','HEAD']],['refresh',['--file',f.task+'/prd.md']],['collect',['--file','']],['collect',['--all']],['collect',['--expect','token']],
  ['create',['--path','somewhere']],['status',['--confirm']],['prepare',['--base','HEAD']],['recover',['--branch','x']],
  ['adopt',[]],['create',['--unknown']],['create',['--br','x']],['create',['--task',f.task]],['create',['--json']],
  ['create',['--confirm','--confirm']],['create',['--base']],['create',['--base','']],['create',['--base','   ']],
  ['create',['--branch','bad\tname']],['remove',['--integrated-into','bad\nref']],['create',['--cwd','']],
 ]) {
  const r=f.run(action,flags);assert.notEqual(r.status,0,JSON.stringify([action,flags]));assert.equal(JSON.parse(r.stdout).ok,false);
  assert.ok(!existsSync(join(f.root,'.worktree')));assert.ok(!existsSync(join(f.root,'.trellis/.runtime')));
 }
});

test('deployed CLI runs from its fixed path with Node unavailable and inherited Git overrides isolated; prepare never executes target scripts',async t=>{
 const f=fixture(t), bin=join(f.root,'only-git');mkdirSync(bin);symlinkSync(execFileSync('which',['git'],{encoding:'utf8'}).trim(),join(bin,'git'));
 const env={...process.env,PATH:bin,TRELLIS_CONTEXT_ID:'parent-pin',GIT_DIR:join(f.root,'foreign'),GIT_INDEX_FILE:join(f.root,'wrong-index')};
 const preview=f.ok('create',[],{env});assert.equal(preview.preview,true);assert.ok(!existsSync(join(f.root,'.worktree')));
 const b=f.ok('create',['--confirm'],{env}).binding;
 f.put('.trellis/.runtime/sessions/parent-pin.json','{"current_task":"parent"}');
 const before=readFileSync(join(f.root,f.task,'task.json'));
 const prepared=f.run('prepare',['--confirm'],{env});assert.equal(prepared.status,0,prepared.stderr);assert.equal(prepared.stderr,'');
 assert.equal(JSON.parse(prepared.stdout).binding.preparationState,'ready');assert.deepEqual(readFileSync(join(f.root,f.task,'task.json')),before);
 assert.equal(readFileSync(join(f.root,'.trellis/.runtime/sessions/parent-pin.json'),'utf8'),'{"current_task":"parent"}');
 assert.ok(!existsSync(join(b.worktreePath,'.trellis/.runtime/sessions/parent-pin.json')));
 assert.ok(!existsSync(join(f.root,'wrong-index')));
 assert.equal((await queryWorktree(f.root,f.task,true)).binding.bindingId,b.bindingId);
 assert.equal(readBinding(f.root,f.task).version,2);
});

test('Python and host v2 binding/execution/lock interoperate without nested query deadlock',async t=>{
 const f=fixture(t),b=f.ok('create',['--confirm']).binding;f.ok('prepare',['--confirm']);
 const hostRecord={bindingId:b.bindingId,requestId:'host',role:'trellis-check',state:'unknown',ownerPid:process.pid,ownerToken:'host-token',createdAt:new Date().toISOString()};
 writeExecution(b,hostRecord);assert.equal(f.ok('status').execution.ownerPid,process.pid);
 assert.notEqual(f.run('recover').status,0);assert.equal(readExecution(b).state,'unknown');
 const release=acquireBindingLock(f.root);
 try { assert.equal((await queryWorktree(f.root,f.task,true)).binding.bindingId,b.bindingId);assert.match(f.run('recover',['--confirm']).stderr,/alive/); }
 finally {release();}
 writeExecution(b,{...hostRecord,ownerPid:2147483647});
 const release2=acquireBindingLock(f.root);
 try {assert.match(f.run('recover',['--confirm']).stderr,/locked/);}finally{release2();}
 assert.equal(f.ok('recover').preview,true);assert.equal(readExecution(b).state,'unknown');f.ok('recover',['--confirm']);assert.equal(readExecution(b).state,'stopped');
 // Host republishes unchanged v2 identities and Python reads without migration.
 const current=readBinding(f.root,f.task);atomicRecord(bindingFile(f.root,f.task),current);assert.equal(f.ok('create').reused,true);
});

test('readiness rejects empty/seed JSONL, invalid UTF-8/NUL, escaped/symlinked/directory refs and preserves target',t=>{
 const cases=[['',/No valid/],['{"reason":"seed"}',/No valid/],['{"file":"../../outside"}',/leaves|traversal/],['{"file":".trellis/tasks/native/research"}',/declare type/],['{"file":".trellis/tasks/native/research/binary"}',/UTF|utf|Binary/],['{"file":".trellis/tasks/native/research/link"}',/Symlink/]];
 const f=fixture(t);
 f.put(f.task+'/research/binary',Buffer.from([0xff,0x00]));f.put('external-file','outside');
 const link=join(f.root,f.task,'research/link');symlinkSync(join(f.root,'external-file'),link);
 const b=f.ok('create',['--confirm']).binding;
 for(const [manifest,expected] of cases){
  // Every failed prepare must leave the same unprepared binding untouched.
  // Restore the input link before changing only this variant's manifest.
  rmSync(link);symlinkSync(expected.source==='Symlink'?'/etc/hosts':join(f.root,'external-file'),link);
  f.put(f.task+'/implement.jsonl',manifest);
  const before=readFileSync(bindingFile(f.root,f.task));
  const r=f.run('prepare',['--confirm']);assert.notEqual(r.status,0);assert.match(r.stderr,expected);
  assert.deepEqual(readFileSync(bindingFile(f.root,f.task)),before);
  assert.ok(!existsSync(join(b.worktreePath,f.task)));assert.equal(readBinding(f.root,f.task).preparationState,'unprepared');
 }
});

test('directory expansion reads external top-level source task store; target task/spec absence is irrelevant',async t=>{
 const f=fixture(t);f.put(f.task+'/research/a.md','a');f.put(f.task+'/research/sub/b.md','b');f.put(f.task+'/unused.md','not selected');
 f.put(f.task+'/implement.jsonl',JSON.stringify({file:f.task+'/research',type:'directory'}));
 const store=join(f.root,'external-store');mkdirSync(store);cpSync(join(f.root,f.task),join(store,'native'),{recursive:true});rmSync(join(f.root,'.trellis/tasks'),{recursive:true});symlinkSync(store,join(f.root,'.trellis/tasks'));
 const b=f.ok('create',['--confirm']).binding;f.ok('prepare',['--confirm']);
 assert.ok(!existsSync(join(b.worktreePath,f.task)));rmSync(join(b.worktreePath,'.trellis/spec'),{recursive:true});
 const q=await queryWorktree(b.worktreePath,f.task,true);assert.equal(q.materials.taskPath,join(store,'native'));
 assert.ok(q.materials.references.some(ref=>ref.path===join(store,'native/research/sub/b.md')));
 assert.ok(!q.materials.references.some(ref=>ref.path.endsWith('unused.md')));
});

test('malicious target task.py and configured hooks are never executed by prepare/ready',async t=>{
 const f=fixture(t),b=f.ok('create',['--confirm']).binding;
 const script=join(b.worktreePath,'.trellis/scripts/task.py');
 writeFileSync(script,`import pathlib\npathlib.Path('executed-target').write_text('bad')\nraise RuntimeError('must never run')`);
 const before=readFileSync(script);f.ok('prepare',['--confirm']);await queryWorktree(f.root,f.task,true);
 assert.deepEqual(readFileSync(script),before);assert.ok(!existsSync(join(b.worktreePath,'executed-target')));
 assert.ok(!existsSync(join(b.worktreePath,f.task)));assert.ok(!existsSync(join(b.worktreePath,'.trellis/.runtime/sessions')));
});

test('deployed CLI with a missing native module refuses to run and never auto-repairs',t=>{
 const f=fixture(t),file=join(f.root,'.trellis/scripts/worktree.py');
 rmSync(join(f.root,'.trellis/scripts/pi_trellis_worktree/manager.py'));const missing=execute([file,'--help']);assert.notEqual(missing.status,0);assert.match(missing.stderr,/missing\/incompatible/);assert.ok(!existsSync(join(f.root,'.trellis/scripts/pi_trellis_worktree/manager.py')));
});
test('configuration validation/defaults/absolute locations and dangling links never infer empty defaults',t=>{
 const f=fixture(t);
 for(const config of ['null','[]','broken',JSON.stringify({worktree:null}),JSON.stringify({worktree:{directory:''}}),JSON.stringify({worktree:{directory:'  '}}),JSON.stringify({worktree:{directory:'a\tb'}}),JSON.stringify({worktree:{directory:42}}),JSON.stringify({worktree:{directory:'..'}})]) {
  f.put('.pi/pi-trellis.json',config);assert.notEqual(f.run('create').status,0);assert.ok(!existsSync(join(f.root,'.worktree')));
 }
 f.put('.pi/pi-trellis.json',JSON.stringify({worktree:{directory:join(f.root,'absolute')}}));f.put('.gitignore','/absolute/\n/.trellis/.runtime/\n/.pi/\n');
 assert.equal(f.ok('create').plan.worktreePath,join(f.root,'absolute/native'));
 symlinkSync(join(f.root,'missing'),join(f.root,'link'));f.put('.pi/pi-trellis.json',JSON.stringify({worktree:{directory:'link'}}));assert.notEqual(f.run('create').status,0);assert.ok(!existsSync(join(f.root,'missing')));
});

test('remove without preserving reference/adopt conflicts refuse without erasing directory or records; target native modules required',t=>{
 const f=fixture(t),b=f.ok('create',['--confirm']).binding;
 for(const flags of [[],['--integrated-into','missing-ref']]){assert.notEqual(f.run('remove',flags).status,0);assert.ok(existsSync(b.worktreePath));assert.equal(readBinding(f.root,f.task).bindingId,b.bindingId);}
 assert.notEqual(f.run('adopt',['--path',b.worktreePath,'--branch','wrong']).status,0);assert.notEqual(f.run('adopt',['--path',f.root]).status,0);
 rmSync(join(b.worktreePath,'.trellis/scripts/pi_trellis_worktree/manager.py'));const r=f.run('prepare',['--confirm']);assert.notEqual(r.status,0);assert.match(r.stderr,/no automatic deployment/);assert.ok(!existsSync(join(b.worktreePath,f.task)));
});

test('native Git operations isolate inherited redirection; null records fail without erasing state',t=>{
 const f=fixture(t),b=f.ok('create',['--confirm']).binding;
 f.ok('prepare',['--confirm'],{env:{...process.env,GIT_DIR:join(f.root,'.git'),GIT_WORK_TREE:f.root,GIT_INDEX_FILE:join(f.root,'bad-index')}});
 assert.ok(!existsSync(join(f.root,'bad-index')));
 const file=join(f.root,'.trellis/.runtime/pi-trellis',`execution-${b.bindingId}.json`);writeFileSync(file,'null');
 assert.notEqual(f.run('recover',['--confirm']).status,0);
 assert.equal(readFileSync(file,'utf8'),'null');assert.equal(readBinding(f.root,f.task).preparationState,'ready');
 const bindingPath=bindingFile(f.root,f.task);writeFileSync(bindingPath,'null');
 assert.notEqual(f.run('create',['--confirm']).status,0);assert.equal(readFileSync(bindingPath,'utf8'),'null');assert.ok(existsSync(b.worktreePath));
});

test('explicit --cwd cannot hide the actual process cwd from removal',t=>{
 const f=fixture(t),b=f.ok('create',['--confirm']).binding;
 const r=f.run('remove',['--confirm','--integrated-into','HEAD'],{cwd:b.worktreePath});
 assert.notEqual(r.status,0);assert.match(r.stderr,/current working directory/);
 assert.ok(existsSync(b.worktreePath));assert.equal(readBinding(f.root,f.task).bindingId,b.bindingId);
});

test('Python status compares host snapshot and current source check fingerprint, ignoring other role changes',async t=>{
 const f=fixture(t),b=f.ok('create',['--confirm']).binding;
 for(const name of ['\uE000.md','🙂.md'])writeFileSync(join(b.worktreePath,name),'snapshot content');
 f.ok('prepare',['--confirm']);const prepared=await queryWorktree(f.root,f.task,true,'check');
 writeExecution(b,{bindingId:b.bindingId,requestId:'unicode',role:'trellis-check',state:'completed',ownerPid:process.pid,ownerToken:'token',createdAt:new Date().toISOString(),sourceFingerprint:prepared.materials.sourceFingerprint,finalSnapshot:worktreeSnapshot(b)});
 assert.match(f.ok('status').note,/check ended on current snapshot/);
 f.put(f.task+'/implement.jsonl','broken unrelated role');assert.match(f.ok('status').note,/check ended on current snapshot/);
 f.put(f.task+'/prd.md','source revised');assert.match(f.ok('status').note,/stale/);
 f.put(f.task+'/prd.md','需求');assert.match(f.ok('status').note,/check ended on current snapshot/);
 writeFileSync(join(b.worktreePath,'🙂.md'),'changed');assert.match(f.ok('status').note,/stale/);
});

test('host atomic record writes reject a final symlink instead of silently replacing user state',t=>{
 const f=fixture(t),b=f.ok('create',['--confirm']).binding;
 const outside=join(f.root,'user-state.json'),marker=join(b.worktreePath,'.trellis/.runtime/pi-trellis/binding.json');writeFileSync(outside,'user state');rmSync(marker);symlinkSync(outside,marker);
 assert.throws(()=>atomicRecord(marker,b),/regular file/);
 assert.equal(readFileSync(outside,'utf8'),'user state');assert.ok(statSync(marker).isFile());assert.equal(readFileSync(marker,'utf8'),'user state');
});

test('role-specific preparation/query isolates invalid manifests and emits exact structured diagnostics',async t=>{
 const f=fixture(t),b=f.ok('create',['--confirm']).binding;
 f.put(f.task+'/check.jsonl','\n{"reason":"seed"}\n{"file":".trellis/spec/missing.md"}');
 f.ok('prepare',['--confirm','--role','implement']);
 const implement=await queryWorktree(f.root,f.task,true,'implement');assert.equal(implement.materials.role,'implement');
 assert.equal(implement.materials.sourceFingerprint,implement.materials.revision);
 await assert.rejects(queryWorktree(f.root,f.task,true,'check'),/missing/);
 const status=f.ok('status');assert.equal(status.materials.implement.state,'valid');assert.equal(status.materials.check.state,'invalid');assert.equal(status.materials.research.state,'valid');
 const issue=status.materials.check.issues[0];assert.equal(issue.code,'material_missing');assert.equal(issue.line,3);assert.equal(issue.role,'check');assert.equal(issue.manifest,join(f.root,f.task,'check.jsonl'));assert.equal(issue.path,join(f.root,'.trellis/spec/missing.md'));assert.ok(issue.nextAction.includes('repair the source manifest'));
 const native=execute([resolve(pkg,'runtime/query-worktree.py'),'--cwd',f.root,'--task',f.task,'--ready']);
 assert.notEqual(native.status,0);assert.equal(JSON.parse(native.stdout).issues[0].code,'invalid_role');
 rmSync(join(f.root,f.task,'implement.jsonl'));rmSync(join(f.root,f.task,'check.jsonl'));
 const research=await queryWorktree(f.root,f.task,true,'research');assert.equal(research.materials.manifest,null);assert.deepEqual(research.materials.references,[]);
 assert.ok(!existsSync(join(b.worktreePath,f.task)));
});

test('version1/unknown binding fields are rejected without conversion or deletion',t=>{
 const f=fixture(t),b=f.ok('create',['--confirm']).binding,file=bindingFile(f.root,f.task);
 for(const bad of [{...b,version:1},{...b,materials:{}},{...b,preparedFiles:{}},{...b,authority:'target'}]){
  const data=JSON.stringify(bad);writeFileSync(file,data);const result=f.run('prepare',['--confirm']);assert.notEqual(result.status,0);
  assert.equal(JSON.parse(result.stdout).issues[0].code,'binding_invalid');assert.equal(readFileSync(file,'utf8'),data);
  assert.ok(existsSync(b.worktreePath));assert.ok(!existsSync(join(b.worktreePath,f.task)));
 }
});
