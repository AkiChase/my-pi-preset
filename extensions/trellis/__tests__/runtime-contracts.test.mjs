import './host-env.mjs';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import trellis, { __internals } from '../index.ts';
import {assembleDispatchPrompt} from '../lib/task-context.ts';
import {queryWorktree,requireMaterials} from '../lib/worktree-query.ts';
import { installRuntimeFixture } from './runtime-fixture.mjs';


// Trellis resource root; tests never depend on the process cwd.
const pkg=fileURLToPath(new URL('..',import.meta.url));

const python = execFileSync('which', [process.env.TRELLIS_PYTHON || 'python3'], {encoding:'utf8'}).trim();
function fixture(t) {
 const root=realpathSync(mkdtempSync(join(tmpdir(),'pi-real-runtime-'))); t.after(()=>rmSync(root,{recursive:true,force:true}));
 const put=(path,data)=>{mkdirSync(join(root,path,'..'),{recursive:true});writeFileSync(join(root,path),typeof data==='string'?data:JSON.stringify(data));};
 cpSync(resolve(pkg,'runtime'),join(root,'.trellis/scripts'),{recursive:true});
 const env={...process.env,PYTHONDONTWRITEBYTECODE:'1',TRELLIS_CONTEXT_ID:'own'};
 for(const key of Object.keys(env))if(key.startsWith('GIT_') || /SESSION_ID|THREAD_ID|CONVERSATION_ID|TRANSCRIPT_PATH|TRELLIS_DEVELOPER/.test(key))delete env[key];
 const run=(entry,args=[],extra={})=>spawnSync(python,[join(root,'.trellis/scripts',entry),...args],{cwd:root,env:{...env,...extra},encoding:'utf8'});
 const probe=code=>spawnSync(python,['-B','-c',`import sys,os,json\nfrom pathlib import Path\nsys.path.insert(0,str(Path.cwd()/'.trellis/scripts'))\nroot=Path.cwd()\n${code}`],{cwd:root,env,encoding:'utf8'});
 const git=(...args)=>execFileSync('git',['-C',root,...args],{encoding:'utf8',env,stdio:['ignore','pipe','pipe']}).trim();
 git('init','-q');git('config','user.name','Runtime Fixture');git('config','user.email','fixture@example.invalid');git('config','commit.gpgsign','false');git('config','core.quotePath','false');
 put('.gitignore','/.trellis/.runtime/\n/.trellis/.developer\n');
 const task=(name='own',overrides={})=>{const path='.trellis/tasks/'+name;put(path+'/task.json',{id:name,title:name,description:'Task description',status:'planning',children:[],...overrides});put(path+'/prd.md','Requirements');return path;};
 const pointer=(key,ref)=>put('.trellis/.runtime/sessions/'+key+'.json',{current_task:ref});
 const ok=(entry,args=[],extra={})=>{const r=run(entry,args,extra);assert.equal(r.status,0,r.stderr+'\n'+r.stdout);return r;};
 return {root,put,env,run,probe,git,task,pointer,ok};
}
const start=(f,path)=>f.run('task.py',['start',path,'--allow-empty-context']);

test('real runtime never infers foreign task, including explicit compatibility flag, absence, empty and child clear',t=>{
 const f=fixture(t), foreign=f.task('parent');f.pointer('parent',foreign);
 for(const pin of ['own','']){const r=f.run('task.py',['current','--json'],{TRELLIS_CONTEXT_ID:pin});assert.notEqual(r.status,0);assert.equal(JSON.parse(r.stdout).current_task,null);}
 const r=f.probe(`from common.active_task import resolve_active_task\nassert resolve_active_task(root,allow_single_session_fallback=True).task_path is None\nfrom common.paths import get_current_task\nassert get_current_task(root) is None`);assert.equal(r.status,0,r.stderr);
 f.pointer('own',null);f.ok('task.py',['deactivate']);assert.ok(existsSync(join(f.root,'.trellis/.runtime/sessions/parent.json')));
 const child=f.task('child');assert.equal(start(f,child).status,0);f.ok('task.py',['deactivate']);f.ok('task.py',['deactivate']);assert.notEqual(f.run('task.py',['current','--json']).status,0);assert.ok(existsSync(join(f.root,'.trellis/.runtime/sessions/parent.json')));
});

test('active binds only its session without lifecycle effects, shares tasks and is idempotent',t=>{
 const f=fixture(t),path=f.task('shared'),other=f.task('other',{status:'in_progress'});
 f.put(path+'/implement.jsonl','');f.put(path+'/check.jsonl','');
 f.put('.trellis/config.yaml','hooks:\n  after_start:\n    - echo started >> hook-marker\n  after_deactivate:\n    - echo cleared >> hook-marker\n');
 const record=readFileSync(join(f.root,path,'task.json')),otherRecord=readFileSync(join(f.root,other,'task.json')),git=f.git('status','--porcelain');
 f.ok('task.py',['active',path],{TRELLIS_CONTEXT_ID:'foreign'});f.ok('task.py',['active',path],{TRELLIS_CONTEXT_ID:'pi-child-fixture'});
 const foreign=readFileSync(join(f.root,'.trellis/.runtime/sessions/foreign.json')),child=readFileSync(join(f.root,'.trellis/.runtime/sessions/pi-child-fixture.json'));
 f.ok('task.py',['active',path]);assert.equal(JSON.parse(f.ok('task.py',['current','--json']).stdout).current_task.dir,path);
 const own=readFileSync(join(f.root,'.trellis/.runtime/sessions/own.json'));
 assert.match(f.ok('task.py',['active','shared']).stdout,/Already active/);
 assert.deepEqual(readFileSync(join(f.root,'.trellis/.runtime/sessions/own.json')),own);
 f.ok('task.py',['active',join(f.root,other)]);
 assert.equal(JSON.parse(f.ok('task.py',['current','--json']).stdout).current_task.dir,other);
 assert.deepEqual(readFileSync(join(f.root,'.trellis/.runtime/sessions/foreign.json')),foreign);
 assert.deepEqual(readFileSync(join(f.root,'.trellis/.runtime/sessions/pi-child-fixture.json')),child);
 assert.deepEqual(readFileSync(join(f.root,path,'task.json')),record);assert.deepEqual(readFileSync(join(f.root,other,'task.json')),otherRecord);
 assert.equal(f.git('status','--porcelain'),git);assert.ok(!existsSync(join(f.root,'hook-marker')));assert.ok(!existsSync(join(f.root,'.trellis/workspace')));
 assert.deepEqual(readdirSync(join(f.root,'.trellis/.runtime')).sort(),['sessions']);
 assert.deepEqual(readdirSync(join(f.root,'.trellis/.runtime/sessions')).sort(),['foreign.json','own.json','pi-child-fixture.json']);
 assert.match(f.ok('task.py',['active','--help']).stdout,/Does not change task status or\s+branch,\s+run hooks, or affect other sessions/);
 assert.equal(f.run('task.py',['active',path,'--takeover']).status,2);
});

test('active rejects invalid identity, task and caller pointer, preserving all existing bytes',t=>{
 const f=fixture(t),path=f.task(),target=f.task('target');f.pointer('own',path);f.pointer('foreign',target);
 const own=readFileSync(join(f.root,'.trellis/.runtime/sessions/own.json')),foreign=readFileSync(join(f.root,'.trellis/.runtime/sessions/foreign.json')),record=readFileSync(join(f.root,target,'task.json'));
 for(const pin of ['', 'own!', 'own/../own', 'x'.repeat(129)])assert.notEqual(f.run('task.py',['active',target],{TRELLIS_CONTEXT_ID:pin}).status,0);
 for(const ref of ['missing','../victim','.trellis/tasks/../../victim',f.root])assert.notEqual(f.run('task.py',['active',ref]).status,0);
 assert.deepEqual(readFileSync(join(f.root,'.trellis/.runtime/sessions/own.json')),own);
 for(const content of ['broken','[]','{"current_task":42}',JSON.stringify({current_task:'.trellis/tasks/missing'})]){
  f.put('.trellis/.runtime/sessions/own.json',content);assert.notEqual(f.run('task.py',['active',target]).status,0);
  assert.equal(readFileSync(join(f.root,'.trellis/.runtime/sessions/own.json'),'utf8'),content);
 }
 writeFileSync(join(f.root,'.trellis/.runtime/sessions/own.json'),own);
 for(const content of ['broken','[]','{}','{"status":{}}']){
  f.put(target+'/task.json',content);assert.notEqual(f.run('task.py',['active',target]).status,0);
  assert.deepEqual(readFileSync(join(f.root,'.trellis/.runtime/sessions/own.json')),own);
 }
 writeFileSync(join(f.root,target,'task.json'),record);
 const failed=f.probe(`from unittest.mock import patch\nimport argparse,task\nwith patch('common.active_task._write_json',return_value=False), patch.object(task,'run_task_hooks') as hooks:\n assert task.cmd_active(argparse.Namespace(dir='${target}')) == 1\n hooks.assert_not_called()`);
 assert.equal(failed.status,0,failed.stderr);assert.deepEqual(readFileSync(join(f.root,'.trellis/.runtime/sessions/own.json')),own);
 for(const fault of ['tempfile.mkstemp','os.replace']){
  const result=f.probe(`from unittest.mock import patch\nimport argparse,task\nwith patch('common.io.${fault}',side_effect=OSError('injected')) as failure, patch.object(task,'run_task_hooks') as hooks:\n assert task.cmd_active(argparse.Namespace(dir='${target}')) == 1\n failure.assert_called_once()\n hooks.assert_not_called()`);
  assert.equal(result.status,0,result.stderr);assert.deepEqual(readFileSync(join(f.root,'.trellis/.runtime/sessions/own.json')),own);
  assert.deepEqual(readdirSync(join(f.root,'.trellis/.runtime/sessions')).sort(),['foreign.json','own.json']);
 }
 assert.deepEqual(readFileSync(join(f.root,'.trellis/.runtime/sessions/foreign.json')),foreign);assert.deepEqual(readFileSync(join(f.root,target,'task.json')),record);
 const victim=join(f.root,'victim.json');writeFileSync(victim,own);rmSync(join(f.root,'.trellis/.runtime/sessions/own.json'));symlinkSync(victim,join(f.root,'.trellis/.runtime/sessions/own.json'));
 assert.notEqual(f.run('task.py',['active',target]).status,0);assert.deepEqual(readFileSync(victim),own);
});

test('start without identity fails before status and hooks; invalid and nonexistent records refuse binding',t=>{
 const f=fixture(t), path=f.task();f.put('.trellis/config.yaml','hooks:\n  after_start:\n    - echo touched >> hook-marker\n');
 const before=readFileSync(join(f.root,path,'task.json'));assert.notEqual(f.run('task.py',['start',path,'--allow-empty-context'],{TRELLIS_CONTEXT_ID:''}).status,0);assert.deepEqual(readFileSync(join(f.root,path,'task.json')),before);assert.ok(!existsSync(join(f.root,'hook-marker')));
 for(const data of ['broken','[]','{}','{"status":{}}','{"title":42}','{"status":"'+ 'a'.repeat(9000)+'"}']){f.put(path+'/task.json',data);assert.notEqual(start(f,path).status,0,data);assert.ok(!existsSync(join(f.root,'.trellis/.runtime/sessions/own.json')));}
 rmSync(join(f.root,path,'task.json'));assert.notEqual(start(f,path).status,0);assert.notEqual(start(f,'.trellis/tasks/absent').status,0);assert.ok(!existsSync(join(f.root,'hook-marker')));
});

test('invalid raw refs cannot authorize reads, context, package, journal or deactivation hooks',t=>{
 const f=fixture(t);f.ok('init_developer.py',['Dev']);const outside=join(f.root,'victim');f.put('victim/task.json',{id:'SECRET',title:'SECRET',status:'in_progress',package:'evil',branch:'SECRET'});f.put('victim/prd.md','SECRET');
 f.put('.trellis/config.yaml','session_auto_commit: false\npackages:\n  safe:\n    path: safe\n  evil:\n    path: evil\nsession:\n  spec_scope: active_task\nhooks:\n  after_deactivate:\n    - echo touched >> hook-marker\n');
 for(const ref of ['victim',outside,'.trellis/tasks/../../victim','.trellis/tasks/missing']){
  f.pointer('own',ref);const r=f.run('task.py',['current','--json']);assert.notEqual(r.status,0);const data=JSON.parse(r.stdout);assert.equal(data.current_task,null);assert.ok(data.error);assert.equal(data.raw_ref,ref);
  const p=f.probe(`from common.paths import get_current_task, get_current_task_abs\nassert get_current_task(root) is None and get_current_task_abs(root) is None`);assert.equal(p.status,0,p.stderr);
  for(const args of [['--json'],['--mode','record','--json'],['--mode','packages','--json']]){const result=f.run('get_context.py',args);assert.notEqual(result.status,0);assert.doesNotMatch(result.stdout,/SECRET/);}
  const journal=f.run('add_session.py',['--title','invalid task','--no-commit']);assert.notEqual(journal.status,0);assert.doesNotMatch(readFileSync(join(f.root,'.trellis/workspace/Dev/journal-1.md'),'utf8'),/invalid task|SECRET/);
  f.ok('task.py',['deactivate']);assert.ok(!existsSync(join(f.root,'hook-marker')));assert.ok(!existsSync(join(f.root,'.trellis/.runtime/sessions/own.json')));
 }
});

test('pointer corruption distinguished from no task; invalid override cannot sanitize into another key',t=>{
 const f=fixture(t),path=f.task();f.pointer('own',path);
 for(const content of ['broken','[]','{"current_task":42}']){f.put('.trellis/.runtime/sessions/own.json',content);const r=f.run('task.py',['current','--json']);assert.notEqual(r.status,0);assert.ok(JSON.parse(r.stdout).error);f.ok('task.py',['deactivate']);}
 for(const pin of ['own/../own','own!','a'.repeat(129)]){const r=f.run('task.py',['current','--json'],{TRELLIS_CONTEXT_ID:pin});assert.notEqual(r.status,0);assert.ok(JSON.parse(r.stdout).error);}
});

test('deactivation hooks only once for successfully cleared valid task, never after unlink failure',t=>{
 const f=fixture(t),path=f.task();f.put('.trellis/config.yaml','hooks:\n  after_deactivate:\n    - echo finished >> hook-marker\n');assert.equal(start(f,path).status,0);
 const failed=f.probe(`from unittest.mock import patch\nimport argparse\nimport task\nwith patch.object(Path,'unlink',side_effect=PermissionError('denied')), patch.object(task,'run_task_hooks') as hooks:\n assert task.cmd_deactivate(argparse.Namespace()) == 1\n hooks.assert_not_called()`);assert.equal(failed.status,0,failed.stderr);assert.ok(existsSync(join(f.root,'.trellis/.runtime/sessions/own.json')));assert.ok(!existsSync(join(f.root,'hook-marker')));
 f.ok('task.py',['deactivate']);f.ok('task.py',['deactivate']);assert.equal(readFileSync(join(f.root,'hook-marker'),'utf8'),'finished\n');
});

test('deactivate is the only unbind command; old command/hook do not mutate state or run',t=>{
 const f=fixture(t),path=f.task(),foreign=f.task('foreign');f.pointer('foreign',foreign);
 f.put('.trellis/config.yaml','hooks:\n  after_finish:\n    - echo old >> old-hook-marker\n  after_deactivate:\n    - echo new >> new-hook-marker\n');
 assert.equal(start(f,path).status,0);
 const record=readFileSync(join(f.root,path,'task.json')),pointer=readFileSync(join(f.root,'.trellis/.runtime/sessions/own.json')),other=readFileSync(join(f.root,'.trellis/.runtime/sessions/foreign.json'));
 const help=f.ok('task.py',['--help']).stdout;
 assert.match(help,/deactivate/);assert.doesNotMatch(help,/\bfinish\b/);
 assert.match(f.ok('task.py',['deactivate','--help']).stdout,/Does not complete or archive the task,\s+or record a journal/);
 const removed=f.run('task.py',['finish']);assert.equal(removed.status,2);
 assert.deepEqual(readFileSync(join(f.root,'.trellis/.runtime/sessions/own.json')),pointer);
 assert.ok(!existsSync(join(f.root,'old-hook-marker')));assert.ok(!existsSync(join(f.root,'new-hook-marker')));
 f.ok('task.py',['deactivate']);f.ok('task.py',['deactivate']);
 assert.deepEqual(readFileSync(join(f.root,path,'task.json')),record);
 assert.deepEqual(readFileSync(join(f.root,'.trellis/.runtime/sessions/foreign.json')),other);
 assert.ok(existsSync(join(f.root,path,'prd.md')));assert.ok(!existsSync(join(f.root,'.trellis/tasks/archive')));assert.ok(!existsSync(join(f.root,'.trellis/workspace')));
 assert.ok(!existsSync(join(f.root,'old-hook-marker')));assert.equal(readFileSync(join(f.root,'new-hook-marker'),'utf8'),'new\n');
});

test('external source task-store parity and lexical/record escape refusals',t=>{
 const f=fixture(t),path=f.task();const store=mkdtempSync(join(tmpdir(),'pi-external-store-'));t.after(()=>rmSync(store,{recursive:true,force:true}));cpSync(join(f.root,'.trellis/tasks'),store,{recursive:true});rmSync(join(f.root,'.trellis/tasks'),{recursive:true});symlinkSync(store,join(f.root,'.trellis/tasks'));
 assert.equal(start(f,path).status,0);assert.equal(JSON.parse(f.ok('task.py',['current','--json']).stdout).current_task.dir,path);
 f.ok('task.py',['deactivate']);f.ok('task.py',['active',path]);assert.equal(JSON.parse(f.ok('task.py',['current','--json']).stdout).current_task.dir,path);
 f.put('victim/task.json',{status:'in_progress'});symlinkSync(join(f.root,'victim'),join(store,'escape'));assert.notEqual(start(f,'.trellis/tasks/escape').status,0);
 const external=join(store,'..','record-'+Date.now()+'.json');writeFileSync(external,'{"status":"in_progress"}');t.after(()=>rmSync(external,{force:true}));rmSync(join(store,'own/task.json'));symlinkSync(external,join(store,'own/task.json'));assert.notEqual(f.run('task.py',['current','--json']).status,0);assert.notEqual(start(f,path).status,0);
});

test('malformed optional children projection is tolerant and bounded across real current/list/context',t=>{
 const f=fixture(t);f.ok('init_developer.py',['Dev']);const path=f.task('own',{children:[null,42,{},'../victim','good',...Array(600).fill('child')],parent:[],package:{},assignee:42});f.pointer('own',path);
 const current=JSON.parse(f.ok('task.py',['current','--json']).stdout).current_task;assert.ok(current.children.length<=512);assert.ok(current.children.every(x=>typeof x==='string'&&!x.includes('/')));
 for(const [entry,args] of [['task.py',['list','--json']],['get_context.py',['--json']],['get_context.py',['--mode','record','--json']]])f.ok(entry,args);
});

test('journal commits exact archived task path, not active basename victim, preserving unrelated index',t=>{
 const f=fixture(t);f.ok('init_developer.py',['Dev']);f.task('same');const archived=f.task('archive/2000-01/same');f.git('add','.');f.git('commit','-qm','baseline');
 f.put('.trellis/tasks/same/victim.txt','unrelated');f.put(archived+'/evidence.md','selected');f.put('staged.txt','preserve');f.git('add','staged.txt');const staged=f.git('show',':staged.txt');f.pointer('own',archived);
 f.ok('add_session.py',['--title','Exact journal scope']);const committed=f.git('diff-tree','--no-commit-id','--name-only','-r','HEAD');assert.match(committed,/archive\/2000-01\/same\/evidence/);assert.doesNotMatch(committed,/victim|staged/);assert.equal(f.git('show',':staged.txt'),staged);assert.match(f.git('status','--porcelain'),/staged.txt/);
});

test('archive commits only exact moved destination, source deletes and edited child task.json, not old archive/child artifacts',t=>{
 const f=fixture(t),path=f.task('parent',{children:['child']}),child=f.task('child',{parent:'parent'});f.task('archive/1999-01/old');f.git('add','.');f.git('commit','-qm','baseline');
 f.put('.trellis/tasks/archive/1999-01/old/dirty.md','unrelated old archive');f.put(child+'/dirty.md','unrelated child');f.put('staged.txt','preserve');f.git('add','staged.txt');
 f.ok('task.py',['archive',path,'--skip-branch-validation']);const committed=f.git('diff-tree','--no-commit-id','--name-only','-r','HEAD');assert.match(committed,/archive\/\d{4}-\d{2}\/parent/);assert.match(committed,/child\/task.json/);assert.doesNotMatch(committed,/1999|dirty|staged/);assert.match(f.git('status','--porcelain'),/staged.txt/);assert.equal(f.git('ls-files',path),'');
});

test('developer single-segment Unicode/spaces, unsafe names no writes, existing identity and history preserved',t=>{
 const f=fixture(t);
 for(const name of ['..','.','../victim','a/b','a\\b','bad\nname','edge\n','\tbad','bad\u0000name','   ']){if(name.includes('\0')){const r=f.probe(`from common.developer import init_developer\nassert not init_developer('bad\\x00name',root)`);assert.equal(r.status,0,r.stderr);}else assert.notEqual(f.run('init_developer.py',[name]).status,0,name);assert.ok(!existsSync(join(f.root,'.trellis/.developer')));}
 f.put('.trellis/workspace/李 小明/journal-1.md','history');f.put('.trellis/workspace/李 小明/index.md','history index');f.ok('init_developer.py',['李 小明']);const identity=readFileSync(join(f.root,'.trellis/.developer'));assert.equal(readFileSync(join(f.root,'.trellis/workspace/李 小明/journal-1.md'),'utf8'),'history');
 f.ok('init_developer.py',['李 小明']);const different=f.run('init_developer.py',['Someone else']);assert.notEqual(different.status,0);assert.match(different.stdout+different.stderr,/李 小明/);assert.deepEqual(readFileSync(join(f.root,'.trellis/.developer')),identity);assert.ok(!existsSync(join(f.root,'.trellis/workspace/Someone else')));
 for(const name of ['../victim','edge\n','\tbad'])assert.notEqual(f.run('get_developer.py',[],{TRELLIS_DEVELOPER:name}).status,0);
});

test('supported entrypoints run without trellis and suppress all bytecode/update-marker writes',t=>{
 const f=fixture(t);const bin=join(f.root,'only-git');mkdirSync(bin);symlinkSync(execFileSync('which',['git'],{encoding:'utf8'}).trim(),join(bin,'git'));const env={PATH:bin,PYTHONDONTWRITEBYTECODE:''};
 f.ok('init_developer.py',['Dev'],env);f.ok('get_developer.py',[],env);const path=f.task();f.pointer('own',path);f.put('.trellis/.version','0.0.1');
 for(const entry of ['task.py','get_context.py','add_session.py'])f.ok(entry,['--help'],env);
 f.ok('get_context.py',['--json'],env);f.ok('get_context.py',[],env);f.ok('task.py',['current','--json'],env);f.ok('add_session.py',['--title','Offline','--no-commit'],env);
 const walk=dir=>readdirSync(dir,{withFileTypes:true}).flatMap(e=>e.isDirectory()?[e.name,...walk(join(dir,e.name))]:[e.name]);assert.ok(!walk(join(f.root,'.trellis')).some(n=>n==='__pycache__'||n.startsWith('update-check-')));
});

test('real runtime child binding/deactivate cannot resurrect from repeated dispatch header; failed binding never borrows parent',async t=>{
 const f=fixture(t);rmSync(join(f.root,'.trellis'),{recursive:true});installRuntimeFixture(f.root);const path=f.task('own',{status:'in_progress'});f.put(path+'/implement.jsonl','{"file":"'+path+'/prd.md"}');const handlers=new Map(),messages=[];
 trellis({registerMessageRenderer:()=>{},events:{on:()=>()=>{},emit:()=>{}},registerCommand: () => {}, registerTool:()=>{},on:(name,fn)=>handlers.set(name,fn),sendMessage:m=>messages.push(m),getAllTools:()=>[]});
 const ctx=name=>({cwd:f.root,hasUI:false,sessionManager:{getSessionId:()=>name,getSessionFile:()=>undefined},ui:{}});
 const parent=ctx('runtime-parent'),child=ctx('runtime-child'),parentKey=__internals.contextKey(f.root,parent);f.pointer(parentKey,path);
 const prompt=assembleDispatchPrompt({prompt:'Implement',contextId:'runtime-child',role:'trellis-implement',executionRoot:f.root,materials:requireMaterials(await queryWorktree(f.root,path,false,undefined,false,'implement'))});
 await handlers.get('before_agent_start')({prompt,systemPromptOptions:{sections:{}}},child);
 const childKey=__internals.contextKey(f.root,child);assert.notEqual(childKey,parentKey);assert.equal(JSON.parse(f.ok('task.py',['current','--json'],{TRELLIS_CONTEXT_ID:childKey}).stdout).current_task.dir,path);
 f.ok('task.py',['deactivate'],{TRELLIS_CONTEXT_ID:childKey});await handlers.get('tool_result')({toolName:'bash',input:{command:'task.py deactivate'}},child);
 await handlers.get('before_agent_start')({prompt,systemPromptOptions:{sections:{}}},child);assert.ok(!existsSync(join(f.root,`.trellis/.runtime/sessions/${childKey}.json`)));assert.match(messages.at(-1).content,/No active task/i);
 const failed=ctx('runtime-failed');await handlers.get('before_agent_start')({prompt:prompt.replace(path,'.trellis/tasks/missing'),systemPromptOptions:{sections:{}}},failed);const failedKey=__internals.contextKey(f.root,failed);assert.notEqual(failedKey,parentKey);assert.notEqual(f.run('task.py',['current','--json'],{TRELLIS_CONTEXT_ID:failedKey}).status,0);
 assert.equal(JSON.parse(f.ok('task.py',['current','--json'],{TRELLIS_CONTEXT_ID:parentKey}).stdout).current_task.dir,path);
});

test('real runtime rejects oversized/nonregular task records and direct library readers retain diagnostics',t=>{
 const f=fixture(t),path=f.task();f.pointer('own',path);f.put(path+'/task.json','{"title":"'+ 'x'.repeat(1024*1024)+'"}');assert.notEqual(start(f,path).status,0);assert.notEqual(f.run('task.py',['current','--json']).status,0);
 const r=f.probe(`from common.session_context import get_context_json, get_context_record_json\nfrom common.packages_context import get_context_packages_json\nassert get_context_json(root).get('task_error')\nassert get_context_record_json(root).get('task_error')\nassert get_context_packages_json(root).get('task_error')`);assert.equal(r.status,0,r.stderr);
 rmSync(join(f.root,path,'task.json'));mkdirSync(join(f.root,path,'task.json'));assert.notEqual(start(f,path).status,0);
});

test('external allowed store journal never guesses a local task basename or commits external files',t=>{
 const f=fixture(t);f.ok('init_developer.py',['Dev']);const path=f.task('same');const store=mkdtempSync(join(tmpdir(),'pi-journal-store-'));t.after(()=>rmSync(store,{recursive:true,force:true}));cpSync(join(f.root,'.trellis/tasks'),store,{recursive:true});rmSync(join(f.root,'.trellis/tasks'),{recursive:true});symlinkSync(store,join(f.root,'.trellis/tasks'));f.git('add','.');f.git('commit','-qm','baseline');
 writeFileSync(join(store,'same/output.md'),'external output');f.pointer('own',path);f.ok('add_session.py',['--title','External store']);assert.doesNotMatch(f.git('diff-tree','--no-commit-id','--name-only','-r','HEAD'),/tasks|output/);assert.equal(readFileSync(join(store,'same/output.md'),'utf8'),'external output');
});

test('runtime baseline hashes, import closure, unchanged native move and Python 3.10 syntax are reproducible',t=>{
 const metadata=JSON.parse(readFileSync(resolve(pkg,'resources/runtime-baseline.json'),'utf8'));
 const digest=data=>createHash('sha256').update(data).digest('hex');
 for(const [name,entry] of Object.entries(metadata.files)){assert.equal(digest(readFileSync(resolve(pkg,'runtime',name))),entry.sha256,name);if(entry.origin==='trellis-0.6.16')assert.equal(entry.sourceSha256,metadata.upstream.sourceHashes[name]);}
 const body={schemaVersion:metadata.schemaVersion,files:Object.fromEntries(Object.keys(metadata.files).sort().map(name=>[name,metadata.files[name].sha256]))};
 // Python sorted keys and compact separators define release identity (ASCII paths).
 const canonical=`{"files":${JSON.stringify(body.files)},"schemaVersion":${body.schemaVersion}}`;
 assert.equal(metadata.releaseId,'pi-trellis-runtime-v1-'+digest(canonical));
 assert.equal(Object.keys(metadata.upstream.sourceHashes).length,28);assert.equal(metadata.upstream.version,'0.6.16');assert.equal(metadata.pythonMinimum,'3.10');assert.ok(!existsSync(resolve(pkg,'python')));
 const r=spawnSync(python,['-B','-c',`import ast,json\nfrom pathlib import Path\nroot=Path('runtime')\nseen=set();pending=['task.py','get_context.py','add_session.py','init_developer.py','get_developer.py','common/__init__.py']\nwhile pending:\n name=pending.pop()\n if name in seen: continue\n seen.add(name)\n tree=ast.parse((root/name).read_text(),feature_version=(3,10))\n compile(tree,name,'exec')\n for n in ast.walk(tree):\n  if not isinstance(n,ast.ImportFrom): continue\n  module=n.module or ''\n  if n.level: module='common.'+module\n  if module=='common': module='common.__init__'\n  if module.startswith('common.'):\n   target=module.replace('.','/')+'.py'\n   assert (root/target).is_file(),target\n   pending.append(target)\nfor path in root.rglob('*.py'):\n ast.parse(path.read_text(),feature_version=(3,10))\n compile(path.read_text(),str(path),'exec')\nassert {p.relative_to(root).as_posix() for p in (root/'common').glob('*.py')} <= seen\nprint(len(seen))`],{cwd:pkg,encoding:'utf8'});assert.equal(r.status,0,r.stderr);assert.ok(Number(r.stdout)>=24);
 // Built into this preset: the resource closure is the plugin directory itself, not a separately packed package.
 for(const path of ['resources/runtime-baseline.json','licenses/trellis-AGPL-3.0.txt','licenses/pi-trellis-MIT.txt'])assert.ok(existsSync(resolve(pkg,path)),path);
});

test('all supported record mutations refuse external task.json redirects and preserve victim bytes',t=>{
 const f=fixture(t),path=f.task();f.put('victim/task.json',{status:'planning',title:'victim'});const file=join(f.root,path,'task.json'),victim=join(f.root,'victim/task.json');rmSync(file);symlinkSync(victim,file);const before=readFileSync(victim);
 for(const args of [['set-branch',path,'new-branch'],['set-base-branch',path,'new-base'],['set-scope',path,'scope'],['set-meta',path,'key','value'],['archive',path,'--no-commit','--skip-branch-validation']]){assert.notEqual(f.run('task.py',args).status,0,args.join(' '));assert.deepEqual(readFileSync(victim),before);}
});

test('trimmed dot developer names fail before identity or workspace writes',t=>{
 const f=fixture(t);
 for(const name of [' . ',' .. ','\u3000.\u3000','\u00a0..\u00a0']){
  assert.notEqual(f.run('init_developer.py',[name]).status,0,name);
  assert.ok(!existsSync(join(f.root,'.trellis/.developer')));
  assert.ok(!existsSync(join(f.root,'.trellis/workspace')));
 }
});

test('session directory and final pointer symlinks never authorize reads, deactivate or start',t=>{
 const f=fixture(t),path=f.task();const external=mkdtempSync(join(tmpdir(),'pi-pointer-victim-'));t.after(()=>rmSync(external,{recursive:true,force:true}));
 const victim=join(external,'own.json');writeFileSync(victim,JSON.stringify({current_task:path}));const before=readFileSync(victim);
 f.put('.trellis/config.yaml','hooks:\n  after_start:\n    - echo started >> hook-marker\n  after_deactivate:\n    - echo finished >> hook-marker\n');
 const unchanged=readFileSync(join(f.root,path,'task.json'));
 for(const route of ['.trellis/.runtime','.trellis/.runtime/sessions','.trellis/.runtime/sessions/own.json']){
  rmSync(join(f.root,'.trellis/.runtime'),{recursive:true,force:true});mkdirSync(join(f.root,route,'..'),{recursive:true});symlinkSync(route.endsWith('.json')?victim:external,join(f.root,route));
  const current=f.run('task.py',['current','--json']);assert.notEqual(current.status,0);assert.ok(JSON.parse(current.stdout).error);
  assert.notEqual(start(f,path).status,0);assert.notEqual(f.run('task.py',['active',path]).status,0);assert.deepEqual(readFileSync(join(f.root,path,'task.json')),unchanged);
  const finish=f.run('task.py',['deactivate']);if(route.endsWith('.json'))assert.equal(finish.status,0);else assert.notEqual(finish.status,0);
  assert.deepEqual(readFileSync(victim),before);assert.ok(!existsSync(join(f.root,'hook-marker')));
 }
});

test('archive destination links/collisions fail before status, child or session mutation',t=>{
 const f=fixture(t),path=f.task('parent',{children:['child']}),child=f.task('child',{parent:'parent'});f.pointer('own',path);
 const external=mkdtempSync(join(tmpdir(),'pi-archive-victim-'));t.after(()=>rmSync(external,{recursive:true,force:true}));
 const before=readFileSync(join(f.root,path,'task.json')), childBefore=readFileSync(join(f.root,child,'task.json')),pointerBefore=readFileSync(join(f.root,'.trellis/.runtime/sessions/own.json'));
 const month=new Date().getFullYear()+'-'+String(new Date().getMonth()+1).padStart(2,'0');
 for(const route of ['archive',`archive/${month}`,`archive/${month}/parent`]){
  rmSync(join(f.root,'.trellis/tasks/archive'),{recursive:true,force:true});mkdirSync(join(f.root,'.trellis/tasks',route,'..'),{recursive:true});symlinkSync(join(external,route.endsWith('parent')?'missing':'') ,join(f.root,'.trellis/tasks',route));
  assert.notEqual(f.run('task.py',['archive',path,'--skip-branch-validation','--no-commit']).status,0,route);
  assert.deepEqual(readFileSync(join(f.root,path,'task.json')),before);assert.deepEqual(readFileSync(join(f.root,child,'task.json')),childBefore);assert.deepEqual(readFileSync(join(f.root,'.trellis/.runtime/sessions/own.json')),pointerBefore);assert.deepEqual(readdirSync(external),[]);
 }
 rmSync(join(f.root,'.trellis/tasks/archive'),{recursive:true,force:true});mkdirSync(join(f.root,`.trellis/tasks/archive/${month}/parent`),{recursive:true});
 assert.notEqual(f.run('task.py',['archive',path,'--skip-branch-validation','--no-commit']).status,0);
 assert.deepEqual(readFileSync(join(f.root,path,'task.json')),before);assert.deepEqual(readFileSync(join(f.root,'.trellis/.runtime/sessions/own.json')),pointerBefore);
});

test('developer identity/workspace symlinks preserve external identity and history',t=>{
 const f=fixture(t),external=mkdtempSync(join(tmpdir(),'pi-identity-victim-'));t.after(()=>rmSync(external,{recursive:true,force:true}));
 const identity=join(external,'identity');writeFileSync(identity,'name=Dev\n');symlinkSync(identity,join(f.root,'.trellis/.developer'));
 assert.notEqual(f.run('get_developer.py').status,0);assert.notEqual(f.run('init_developer.py',['Dev']).status,0);assert.equal(readFileSync(identity,'utf8'),'name=Dev\n');assert.ok(!existsSync(join(f.root,'.trellis/workspace')));
 rmSync(join(f.root,'.trellis/.developer'));
 for(const route of ['.trellis/workspace','.trellis/workspace/Dev']){
  rmSync(join(f.root,'.trellis/workspace'),{recursive:true,force:true});mkdirSync(join(f.root,route,'..'),{recursive:true});symlinkSync(external,join(f.root,route));assert.notEqual(f.run('init_developer.py',['Dev']).status,0);assert.ok(!existsSync(join(f.root,'.trellis/.developer')));assert.deepEqual(readdirSync(external),['identity']);
 }
});

test('recorded native provenance keeps its historical source record and derived sources retain AGPL notices',()=>{
 const metadata=JSON.parse(readFileSync(resolve(pkg,'resources/runtime-baseline.json'),'utf8'));const digest=data=>createHash('sha256').update(data).digest('hex');
 for(const [name,row] of Object.entries(metadata.files)){
  const bytes=readFileSync(resolve(pkg,'runtime',name));
  if(row.origin==='pi-trellis' && row.sourcePath===null){
   assert.equal(row.sourceSha256,null);assert.equal(row.license,'MIT');assert.equal(digest(bytes),row.sha256,name);
  }else if(row.origin==='pi-trellis'){
   // Historical originals live in the former standalone repository's Git history and are not
   // migrated; the recorded revision/path/hash remain provenance metadata, checked for consistency.
   assert.match(row.sourceRevision,/^[0-9a-f]{40}$/,name);assert.match(row.sourcePath,/^python\//,name);assert.match(row.sourceSha256,/^[0-9a-f]{64}$/,name);
   assert.equal(digest(bytes),row.sha256,name);if(row.modified)assert.notEqual(row.sourceSha256,row.sha256,name);else assert.equal(row.sourceSha256,row.sha256,name);assert.equal(row.license,'MIT');
  }else{
   assert.equal(row.license,'AGPL-3.0-only',name);assert.match(bytes.toString(),/SPDX-License-Identifier: AGPL-3\.0-only/,name);
   if(row.origin==='trellis-0.6.16')assert.match(bytes.toString(),/Derived from @mindfoldhq\/trellis 0\.6\.16 \(Mindfold LLC\)/,name);
  }
 }
});

test('actual create/start/current/deactivate lifecycle and malformed hooks remain observable without global trellis',t=>{
 const f=fixture(t);f.ok('init_developer.py',['Dev']);f.put('.pi/settings.json','{}');f.put('.trellis/config.yaml','hooks:\n  after_start:\n    - printf "%s\\n" "$TASK_JSON_PATH" >> hook-paths\n  after_deactivate: invalid scalar\n');
 const created=f.ok('task.py',['create','Lifecycle','--description','Actual CLI lifecycle','--slug','lifecycle','--no-start']);const path=created.stdout.trim().split('\n').at(-1);
 assert.match(path,/^\.trellis\/tasks\/\d{2}-\d{2}-lifecycle$/);assert.ok(existsSync(join(f.root,path,'implement.jsonl')));assert.ok(!existsSync(join(f.root,'.trellis/.runtime/sessions/own.json')));
 assert.notEqual(f.run('task.py',['start',path]).status,0);f.put(path+'/implement.jsonl',JSON.stringify({file:path+'/prd.md'})+'\n');f.put(path+'/check.jsonl',JSON.stringify({file:path+'/prd.md'})+'\n');f.ok('task.py',['validate',path]);f.ok('task.py',['start',path]);
 assert.equal(JSON.parse(f.ok('task.py',['current','--json']).stdout).current_task.status,'in_progress');assert.equal(realpathSync(readFileSync(join(f.root,'hook-paths'),'utf8').trim()),realpathSync(join(f.root,path,'task.json')));
 const finish=f.ok('task.py',['deactivate']);assert.match(finish.stderr,/ignoring hook.*after_deactivate/);assert.ok(!existsSync(join(f.root,'.trellis/.runtime/sessions/own.json')));
});

test('context validation refuses invalid task records rather than raw external or nonobject metadata',t=>{
 const f=fixture(t),path=f.task();f.put(path+'/implement.jsonl',JSON.stringify({file:path+'/prd.md'})+'\n');f.put(path+'/check.jsonl',JSON.stringify({file:path+'/prd.md'})+'\n');
 for(const record of ['[]','broken','{}']){f.put(path+'/task.json',record);const result=f.run('task.py',['validate',path]);assert.notEqual(result.status,0);assert.doesNotMatch(result.stderr,/Traceback/);}
 f.put(path+'/task.json',{status:'planning',branch:{invalid:1}});f.ok('task.py',['validate',path]);
 f.put('victim/task.json',{status:'planning'});rmSync(join(f.root,path,'task.json'));symlinkSync(join(f.root,'victim/task.json'),join(f.root,path,'task.json'));assert.notEqual(f.run('task.py',['validate',path]).status,0);
});
