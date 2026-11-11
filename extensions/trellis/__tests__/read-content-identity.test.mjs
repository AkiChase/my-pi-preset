import assert from 'node:assert/strict';
import test from 'node:test';
import fs, { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, realpathSync, chmodSync, lstatSync, utimesSync } from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import { readTaskRecord } from '../lib/task-context.ts';
import { DiagnosticReader } from '../lib/initialization/diagnostics.ts';

function fixture(t) {
 const root=realpathSync(mkdtempSync(join(tmpdir(),'trellis-read-content-'))),task='.trellis/tasks/read';
 t.after(()=>rmSync(root,{recursive:true,force:true}));
 mkdirSync(join(root,task),{recursive:true});
 const file=join(root,task,'task.json'),content='{"status":"planning"}';
 writeFileSync(file,content);chmodSync(file,0o644);
 return {root,task,file,content};
}
function patch(t,name,fn) {
 const original=fs[name];t.mock.method(fs,name,fn(original));syncBuiltinESMExports();
 t.after(()=>{t.mock.restoreAll();syncBuiltinESMExports();});
}
for(const reader of ['task','diagnostic']) for(const phase of ['open','read']) {
 test(`${reader} reader ignores chmod during ${phase} without losing byte identity`,t=>{
  const f=fixture(t);let changed=false;
  if(phase==='open') patch(t,'openSync',open=>(path,...args)=>{
   const fd=open(path,...args);if(String(path)===f.file&&!changed){changed=true;chmodSync(f.file,0o664);}return fd;
  });
  else {
   let tracked;
   patch(t,'openSync',open=>(path,...args)=>{const fd=open(path,...args);if(String(path)===f.file)tracked=fd;return fd;});
   patch(t,'readSync',read=>(fd,...args)=>{const count=read(fd,...args);if(fd===tracked&&count&&!changed){changed=true;chmodSync(f.file,0o664);}return count;});
  }
  if(reader==='task')assert.deepEqual(readTaskRecord(f.root,f.task),{status:'planning'});
  else {
   const result=new DiagnosticReader().file(f.root,f.task+'/task.json');
   assert.equal(result.text,f.content);assert.equal(result.sha256,createHash('sha256').update(f.content).digest('hex'));
   assert.equal(Object.hasOwn(result,'mode'),false);
  }
  assert.ok(changed);assert.equal(lstatSync(f.file).mode&0o777,0o664);assert.equal(readFileSync(f.file,'utf8'),f.content);
 });
}
for(const reader of ['task','diagnostic']) test(`${reader} reader still rejects same-size content writes during read`,t=>{
 const f=fixture(t),before=lstatSync(f.file);let tracked,changed=false;
 patch(t,'openSync',open=>(path,...args)=>{const fd=open(path,...args);if(String(path)===f.file)tracked=fd;return fd;});
 patch(t,'readSync',read=>(fd,...args)=>{
  const count=read(fd,...args);
  if(fd===tracked&&count&&!changed){changed=true;writeFileSync(f.file,'{"status":"complete"}');utimesSync(f.file,before.atime,new Date(before.mtimeMs+1000));}
  return count;
 });
 assert.equal(Buffer.byteLength(f.content),Buffer.byteLength('{"status":"complete"}'));
 assert.throws(()=>reader==='task'?readTaskRecord(f.root,f.task):new DiagnosticReader().file(f.root,f.task+'/task.json'),/changed during bounded read/);
 assert.ok(changed);assert.equal(readFileSync(f.file,'utf8'),'{"status":"complete"}');
});
for(const reader of ['task','diagnostic']) test(`${reader} reader still rejects descriptor/path replacement during read`,t=>{
 const f=fixture(t);let tracked,changed=false;
 patch(t,'openSync',open=>(path,...args)=>{const fd=open(path,...args);if(String(path)===f.file)tracked=fd;return fd;});
 patch(t,'readSync',read=>(fd,...args)=>{
  const count=read(fd,...args);
  if(fd===tracked&&count&&!changed){changed=true;fs.renameSync(f.file,f.file+'.saved');writeFileSync(f.file,f.content);}
  return count;
 });
 assert.throws(()=>reader==='task'?readTaskRecord(f.root,f.task):new DiagnosticReader().file(f.root,f.task+'/task.json'),/changed during|source path changed/);
 assert.ok(changed);assert.equal(readFileSync(f.file,'utf8'),f.content);
});
