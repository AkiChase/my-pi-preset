import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { canonicalPath } from '../lib/config.ts';
import { sourceExecutionFile, readSourceExecution, writeSourceExecution, sourceExecutionForAgent, sourceActive } from '../lib/source-executions.ts';
function fixture(t) {
 const root=canonicalPath(mkdtempSync(join(tmpdir(),'source-execution-')));t.after(()=>rmSync(root,{recursive:true,force:true}));
 const record={version:1,mode:'source',sourceRoot:root,repositoryIdentity:root,taskDir:'.trellis/tasks/test',requestId:'request',role:'trellis-implement',state:'running',ownerPid:process.pid,ownerToken:'token',createdAt:'today',agentId:'real-id'};
 return {root,record};
}
test('source records are per-task and support bounded real-id lookup',t=>{
 const {root,record}=fixture(t);assert.equal(readSourceExecution(record),undefined);writeSourceExecution(record);
 assert.equal(sourceActive(readSourceExecution(record)),true);assert.equal(sourceExecutionForAgent(root,root,'real-id').requestId,'request');
 assert.notEqual(sourceExecutionFile(record),sourceExecutionFile({...record,taskDir:'.trellis/tasks/other'}));
 writeSourceExecution({...record,state:'completed'});assert.equal(sourceExecutionForAgent(root,root,'real-id'),undefined);
});
test('source invalid JSON, owner, identity, null, oversized and symlink records fail closed',t=>{
 const {root,record}=fixture(t);const file=sourceExecutionFile(record);mkdirSync(join(file,'..'),{recursive:true});
 for(const raw of ['null','{',JSON.stringify({...record,ownerPid:0}),JSON.stringify({...record,taskDir:'.trellis/tasks/other'}),' '.repeat(65537)]) {
  writeFileSync(file,raw);assert.throws(()=>readSourceExecution(record));
 }
 rmSync(file);writeFileSync(join(root,'other'),'{}');symlinkSync(join(root,'other'),file);assert.throws(()=>readSourceExecution(record));assert.throws(()=>writeSourceExecution(record));
});
test('corrupt neighboring records do not block matching discovery and emit diagnostics',t=>{
 const {root,record}=fixture(t);writeSourceExecution(record);const directory=join(sourceExecutionFile(record),'..');
 writeFileSync(join(directory,'0'.repeat(64)+'.json'),'null');const notices=[];
 assert.equal(sourceExecutionForAgent(root,root,'real-id',message=>notices.push(message)).agentId,'real-id');assert.equal(notices.length,1);
 assert.equal(sourceExecutionForAgent(root,root,'real-id',()=>{}).requestId,'request');
});
test('source record ancestors cannot alias local or external directories',t=>{
 const {root,record}=fixture(t);mkdirSync(join(root,'.trellis/.runtime/pi-trellis'),{recursive:true});mkdirSync(join(root,'alias'));
 symlinkSync(join(root,'alias'),join(root,'.trellis/.runtime/pi-trellis/source-executions'));assert.throws(()=>sourceExecutionFile(record));
});
