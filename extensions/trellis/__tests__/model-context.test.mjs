import './host-env.mjs';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync, readFileSync, statSync, utimesSync } from 'node:fs';
import { dirname, join } from 'node:path';
import test from 'node:test';
import trellis, { __internals } from '../index.ts';
import { hasTrellisStartup, latestTrellisState } from '../lib/model-context.ts';
import { copyRuntimeFixture } from './runtime-fixture.mjs';

function host(t, options={}) {
 const root=options.root??copyRuntimeFixture(t,{user:'SnapshotDeveloper'}), branch=options.branch??[];
 const handlers=new Map(), direct=[];
 trellis({on:(n,h)=>{handlers.set(n,h);return()=>handlers.delete(n);},registerCommand:()=>{},registerTool:()=>{},registerMessageRenderer:()=>{},
  events:{on:()=>()=>{},emit:()=>{}},sendMessage:m=>direct.push(m),getAllTools:()=>[]});
 const ctx={cwd:root,hasUI:options.full??false,ui:{},sessionManager:{getSessionId:()=>options.id??'startup-owner',getSessionFile:()=>undefined,getBranch:()=>branch}};
 const key=__internals.contextKey(root,ctx);
 const put=(p,text)=>{mkdirSync(dirname(join(root,p)),{recursive:true});writeFileSync(join(root,p),text);};
 const persist=result=>{if(result?.message)branch.push({type:'custom_message',id:String(branch.length+1),parentId:branch.at(-1)?.id??null,timestamp:new Date().toISOString(),...result.message});};
 const before=async(prompt='continue',persisted=true)=>{
  const sections={},result=await handlers.get('before_agent_start')({prompt,systemPromptOptions:{sections}},ctx);
  if(persisted)persist(result);assert.equal(direct.length,0,'before_agent_start must return an SDK-persisted message, not send a draft');
  return {sections,result};
 };
 const invalidate=()=>handlers.get('tool_result')({toolName:'bash',input:{command:'python3 .trellis/scripts/task.py current'}},ctx);
 const bind=(status='planning')=>{
  put('.trellis/tasks/context-test/task.json',JSON.stringify({id:'context-test',title:'Live task',status,children:[]}));
  put('.trellis/tasks/context-test/prd.md','Approved task material');
  put(`.trellis/.runtime/sessions/${key}.json`,JSON.stringify({current_task:'.trellis/tasks/context-test'}));
 };
 return {root,branch,handlers,ctx,put,persist,before,invalidate,bind};
}

 test('ordinary compact startup preserves original overview substance, omits main Git/identity and supplies only fixed system rules',async t=>{
  const f=host(t),first=await f.before();
  assert.deepEqual(Object.keys(first.sections),['trellis-rules']);
  assert.match(first.result.message.content,/<session-overview>[\s\S]*Journal:[\s\S]*(?:Active tasks at startup:|No active tasks at startup\.)[\s\S]*Trellis CLI/);
  assert.match(first.result.message.content,/Execution root \(product code\/tests\)/);
  assert.doesNotMatch(first.result.message.content,/Developer:|(?:Source )?Git:|<trellis-workflow>/);
  assert.doesNotMatch(first.sections['trellis-rules'],/SnapshotDeveloper|context-test|Journal:/);
  assert.ok(hasTrellisStartup(f.branch,f.root));assert.match(latestTrellisState(f.branch,f.root),/No active task/);
  const second=await f.before();assert.deepEqual(second.sections,first.sections);assert.equal(second.result,undefined);
 });

 test('full startup keeps filtered workflow text and its existing budget, without per-turn breadcrumb blocks in the snapshot',async t=>{
  const f=host(t,{full:true});
  f.put('.trellis/workflow.md','# Kept head\n[Codex]\nOTHER_PLATFORM\n[/Codex]\n[Pi]\nPI_CONTENT\n[/Pi]\n'+('Full workflow content\n'.repeat(1000))+'\n[workflow-state:no_task]\nSTATE_ONLY\n[/workflow-state:no_task]\n');
  const {sections,result}=await f.before(),content=result.message.content;
  assert.match(content,/<trellis-workflow>[\s\S]*Kept head[\s\S]*PI_CONTENT[\s\S]*truncated by pi-trellis/);
  assert.doesNotMatch(content,/OTHER_PLATFORM/);
  assert.match(content,/STATE_ONLY/);assert.equal(content.match(/STATE_ONLY/g).length,1);
  const workflow=content.split('<trellis-workflow>\n')[1].split('\n</trellis-workflow>')[0];
  assert.ok(workflow.length>=14000&&workflow.length<14600);assert.equal(sections['trellis-workflow'],undefined);
 });

 test('task/phase/error changes append only live state; CLI, Git, identity, journal and task-list changes cannot replace startup or system',async t=>{
  const f=host(t),first=await f.before(),original=JSON.stringify(f.branch[0]);
  f.put('.trellis/.developer','changed-identity');f.put('external-uncommitted.txt','new git state');
  f.put('.trellis/workspace/SnapshotDeveloper/journal-1.md','changed journal\n'.repeat(100));
  f.bind();await f.invalidate();const changed=await f.before();
  assert.deepEqual(changed.sections,first.sections);assert.match(changed.result.message.content,/Status: planning/);
  assert.doesNotMatch(changed.result.message.content,/<session-overview>|<trellis-workflow>|changed-identity|changed journal/);
  assert.equal(JSON.stringify(f.branch[0]),original);assert.equal((await f.before()).result,undefined);
  const file=join(f.root,'.trellis/workflow.md'),mtime=statSync(file).mtimeMs;
  f.put('.trellis/workflow.md',readFileSync(file,'utf8').replace('[workflow-state:planning]','[workflow-state:planning]\nNEW_BREADCRUMB'));
  utimesSync(file,new Date(),new Date(mtime+5000));await f.invalidate();const phase=await f.before();
  assert.match(phase.result.message.content,/NEW_BREADCRUMB/);assert.deepEqual(phase.sections,first.sections);
  f.put('.trellis/tasks/context-test/task.json',JSON.stringify({status:{invalid:true}}));await f.invalidate();
  const failure=await f.before();assert.match(failure.result.message.content,/task_error/);assert.deepEqual(failure.sections,first.sections);
  assert.equal((await f.before()).result,undefined);assert.equal(JSON.stringify(f.branch[0]),original);
 });

 test('returned unpersisted startup and live state drafts retry; branch records, not process memory, confirm delivery',async t=>{
  const f=host(t),a=await f.before('first',false),b=await f.before('retry',false);
  assert.equal(a.result.message.content,b.result.message.content);assert.equal(f.branch.length,0);
  f.persist(b.result);assert.equal((await f.before()).result,undefined);
  f.bind();await f.invalidate();const state=await f.before('state',false),retry=await f.before('retry-state',false);
  assert.equal(state.result.message.content,retry.result.message.content);assert.doesNotMatch(state.result.message.content,/<session-overview>/);
  f.persist(retry.result);assert.equal((await f.before()).result,undefined);
 });

 test('fresh factories, inherited forks and compaction preserve startup; an abandoned branch can initialize',async t=>{
  const f=host(t);await f.before();
  const reopened=host(t,{root:f.root,branch:f.branch});assert.equal((await reopened.before()).result,undefined);
  const inherited=host(t,{root:f.root,branch:[...f.branch],id:'fork-owner'});assert.equal((await inherited.before()).result,undefined);
  inherited.branch.push({type:'compaction',id:'compact',parentId:inherited.branch.at(-1).id,timestamp:new Date().toISOString(),summary:'Summary',firstKeptEntryId:'compact',tokensBefore:1});
  const compacted=host(t,{root:f.root,branch:inherited.branch,id:'fork-owner'});assert.equal((await compacted.before()).result,undefined);
  const abandoned=host(t,{root:f.root,branch:[],id:'before-startup'});assert.match((await abandoned.before()).result.message.content,/<session-overview>/);
 });

 test('legacy mixed system snapshots prevent duplication, but do not confirm task-state drafts or grant authority',async t=>{
  const f=host(t,{branch:[{type:'message',id:'legacy',parentId:null,timestamp:new Date().toISOString(),message:{role:'system',timestamp:0,sections:{'session-overview':'Legacy startup'}}}]});
  const first=await f.before();assert.doesNotMatch(first.result.message.content,/<session-overview>/);assert.match(first.result.message.content,/No active task/);
  assert.equal((await f.before()).result,undefined);
 });

 test('late startup after shutdown or session replacement cannot append or confirm a snapshot',async t=>{
  for(const boundary of ['session_shutdown','session_start']) {
   const f=host(t),pending=f.before();
   const replacement={...f.ctx,sessionManager:{...f.ctx.sessionManager,getSessionId:()=>boundary}};
   await f.handlers.get(boundary)({},replacement);
   const late=await pending;assert.equal(late.result,undefined);assert.equal(f.branch.length,0);assert.deepEqual(late.sections,{});
  }
 });
