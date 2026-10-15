import assert from 'node:assert/strict';
import test from 'node:test';
import fs, { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, symlinkSync, chmodSync, readdirSync, lstatSync, readlinkSync, realpathSync } from 'node:fs';
import childProcess from 'node:child_process';
import { syncBuiltinESMExports } from 'node:module';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { DIAGNOSTIC_BOOTSTRAP } from '../lib/initialization/diagnostic-bootstrap.ts';
import { collectDiagnostics, formatDiagnostics, DIAGNOSTIC_LIMITS } from '../lib/initialization/diagnostics.ts';
import { installRuntimeFixture, copyRuntimeFixture } from './runtime-fixture.mjs';
import { verifyRuntime, packageRoot } from '../lib/initialization/engine.ts';

// An initialized project costs about a second to build; every supported case copies one shared build.
// copyRuntimeFixture re-roots and re-hashes the completed record, so Check validates this project's own
// plan envelope rather than failing an unrelated assertion on a record that still names the template root.
function fixture(t, supported=false) {
 const root=supported?copyRuntimeFixture(t):realpathSync(mkdtempSync(join(tmpdir(),'trellis-diagnostic-')));
 if(!supported)t.after(()=>rmSync(root,{recursive:true,force:true}));
 const put=(path,value)=>{mkdirSync(dirname(join(root,path)),{recursive:true});writeFileSync(join(root,path),typeof value==='object'&&!Buffer.isBuffer(value)?JSON.stringify(value):value);};
 const task=(ref='.trellis/tasks/own',record={id:'own',status:'planning'})=>{put(ref+'/task.json',record);return ref;};
 const pointer=(value,key='own')=>put(`.trellis/.runtime/sessions/${key}.json`,{current_task:value});
 const check=(scope={})=>collectDiagnostics({cwd:root,...scope});
 return {root,put,task,pointer,check};
}
const item=(result,id)=>result.items.find(row=>row.id===id);
function snapshot(root) {
 const out={};
 const walk=dir=>{for(const name of readdirSync(dir)){const path=join(dir,name),s=lstatSync(path);out[path.slice(root.length)]=[s.mode,s.isSymbolicLink()?readlinkSync(path):s.isDirectory()?'directory':s.isFile()?readFileSync(path).toString('base64'):'special'];if(s.isDirectory())walk(path);}};
 walk(root);return out;
}
function guards(t,{forbidden=[],allowDiagnostic=false}={}) {
 const calls=[],reads=[],open=fs.openSync,spawn=childProcess.spawn;
 for(const name of ['exec','execSync','execFile','execFileSync','spawn','spawnSync','fork'])t.mock.method(childProcess,name,(...args)=>{if(allowDiagnostic&&name==='spawn'){assert.deepEqual(args[1],['-I','-S','-B','-X','utf8','-c',DIAGNOSTIC_BOOTSTRAP]);assert.equal(args[2].shell,false);assert.equal(args[2].env.TMPDIR,undefined);return spawn(...args);}calls.push(name);assert.fail(`Forbidden subprocess: ${name}`);});
 for(const name of ['writeFileSync','mkdirSync','unlinkSync','renameSync','rmSync','chmodSync','fchmodSync','appendFileSync','truncateSync','symlinkSync'])t.mock.method(fs,name,()=>{calls.push(name);assert.fail(`Forbidden write: ${name}`);});
 t.mock.method(fs,'openSync',(path,flags,...args)=>{assert.equal(typeof flags,'number');assert.equal(flags&(fs.constants.O_WRONLY|fs.constants.O_RDWR|fs.constants.O_CREAT|fs.constants.O_TRUNC|fs.constants.O_APPEND),0);const text=String(path);reads.push(text);assert.ok(!forbidden.some(p=>text===p||text.startsWith(p+'/')),`Forbidden read: ${text}`);return open(path,flags,...args);});
 t.mock.method(fs,'readdirSync',()=>assert.fail('No task/session/history/material or directory enumeration'));
 syncBuiltinESMExports();
 const restore=()=>{t.mock.restoreAll();syncBuiltinESMExports();};t.after(restore);
 return {calls,reads,restore};
}

test('supported static report is short, no normal hashes/file inventory and no runtime health claim',t=>{
 const f=fixture(t,true);f.pointer(f.task());assert.ok(verifyRuntime(f.root));const before=snapshot(f.root),g=guards(t,{forbidden:[join(f.root,'.trellis/.runtime/sessions'),join(f.root,'.trellis/tasks')]});
 const r=f.check(),report=formatDiagnostics(r);g.restore();
 assert.equal(item(r,'package').status,'pass');assert.equal(item(r,'manifest').status,'pass');assert.equal(item(r,'inventory:runtime').status,'pass');assert.equal(item(r,'documents').status,'pass');assert.equal(item(r,'current-task'),undefined);assert.doesNotMatch(report,/current task|session/i);assert.match(report,/Scope: Trellis deployment in this project/);
 assert.equal(item(r,'runtime-probe').status,'blocked');assert.equal(item(r,'effective-config').status,'skipped');assert.equal(item(r,'worktree-probe'),undefined);assert.doesNotMatch(report,/All checks passed|allHealthy|[a-f0-9]{64}|scripts\/task\.py/);assert.ok(Buffer.byteLength(report)<5000);assert.equal(report.match(/Check project ·/g).length,1);assert.deepEqual(g.calls,[]);assert.deepEqual(snapshot(f.root),before);
});

test('fresh project stops at nearest Git and does not report every missing runtime file',t=>{
 const f=fixture(t);mkdirSync(join(f.root,'.git'));const child=join(f.root,'nested');mkdirSync(child);const g=guards(t);const r=f.check({cwd:child});g.restore();
 assert.equal(r.scope.executionRoot,f.root);assert.equal(item(r,'project').summary,'Not initialized');assert.ok(!r.items.some(i=>i.id.startsWith('inventory:')));assert.doesNotMatch(formatDiagnostics(r),/Missing:|not initialized.*failure/i);assert.deepEqual(g.calls,[]);
});

test('malformed manifest and invalid JSON config accumulate independently; session/task state is never read',t=>{
 const f=fixture(t,true);f.put('.trellis/.pi-trellis.json','{bad');f.put('.pi/settings.json','{"secret":"do-not-echo",bad}');f.put('.trellis/.runtime/sessions/own.json','broken');f.put('.git/index',Buffer.from([0,255,1]));f.pointer(f.task('.trellis/tasks/foreign'),'foreign');
 const before=snapshot(f.root),g=guards(t,{forbidden:[join(f.root,'.trellis/.runtime/sessions'),join(f.root,'.trellis/tasks')]});const r=f.check();g.restore();
 assert.equal(item(r,'manifest').status,'issue');assert.equal(item(r,`config:${f.root}:.pi/settings.json`).status,'issue');assert.equal(item(r,'inventory:runtime').status,'pass');assert.doesNotMatch(formatDiagnostics(r),/do-not-echo/);assert.deepEqual(g.calls,[]);assert.deepEqual(snapshot(f.root),before);
});

for(const path of ['.pi/settings.json','.trellis/config.yaml'])test(`symlink ${path} rejects external reads and preserves victim`,t=>{
 const f=fixture(t,true),victim=fixture(t);victim.put('target',{});mkdirSync(dirname(join(f.root,path)),{recursive:true});rmSync(join(f.root,path),{force:true});symlinkSync(join(victim.root,'target'),join(f.root,path));
 const before=snapshot(victim.root),g=guards(t,{forbidden:[victim.root]});const r=f.check();g.restore();assert.ok(r.items.some(i=>i.status==='issue'&&i.evidence.some(e=>e.includes(path))));assert.deepEqual(snapshot(victim.root),before);
});

test('special/directory and denied descriptors fail explicitly, independent configuration still runs',t=>{
 const f=fixture(t,true);mkdirSync(join(f.root,'.pi/settings.json'),{recursive:true});let r=f.check();assert.equal(item(r,`config:${f.root}:.pi/settings.json`).status,'issue');assert.equal(item(r,'inventory:runtime').status,'pass');
 const open=fs.openSync;t.mock.method(fs,'openSync',(path,...args)=>{if(String(path).endsWith('/.trellis/.developer'))throw Object.assign(Error('Permission denied'),{code:'EACCES'});return open(path,...args);});syncBuiltinESMExports();t.after(()=>{t.mock.restoreAll();syncBuiltinESMExports();});r=f.check();assert.equal(item(r,'developer').status,'issue');assert.match(item(r,'developer').summary,/Permission denied/);
});

test('runtime missing/hash/mode, missing role and required docs collect fixed inventory while customization stays legal',t=>{
 const f=fixture(t,true);f.put('.trellis/workflow.md','custom workflow');f.put('.trellis/spec/index.md','custom spec');assert.equal(item(f.check(),'documents').status,'pass');
 rmSync(join(f.root,'.trellis/scripts/task.py'));f.put('.trellis/scripts/get_context.py','changed');chmodSync(join(f.root,'.trellis/scripts/get_developer.py'),0o600);rmSync(join(f.root,'.pi/agents/trellis-check.md'));rmSync(join(f.root,'.trellis/spec/guides/index.md'));
 const r=f.check(),report=formatDiagnostics(r);assert.match(report,/Missing: .trellis\/scripts\/task.py/);assert.match(report,/Hash mismatch: .trellis\/scripts\/get_context.py/);assert.match(report,/Mode mismatch: .trellis\/scripts\/get_developer.py/);assert.equal(item(r,'inventory:agent').status,'issue');assert.equal(item(r,'documents').status,'issue');assert.equal(item(r,'runtime-probe').status,'blocked');
});

test('legal empty resource lock and completed audit never execute recovery or re-read historical task',t=>{
 const f=fixture(t,true);f.put('.trellis/.runtime/init.lock','');const r=f.check();assert.match(item(r,'lock').summary,/legal empty lock/);assert.doesNotMatch(item(r,'lock').summary,/JSON/);assert.equal(item(r,'operation').status,'pass');
 // Completed init record references the removed bootstrap task; no historical file is opened.
 const g=guards(t,{forbidden:[join(f.root,'.trellis/tasks/00-bootstrap-guidelines')]});assert.equal(item(f.check(),'operation').status,'pass');g.restore();
 const op=JSON.parse(readFileSync(join(f.root,'.trellis/.runtime/init-operation.json')));op.status='incomplete';f.put('.trellis/.runtime/init-operation.json',op);assert.equal(item(f.check(),'operation').status,'issue');op.plan.root='/foreign';f.put('.trellis/.runtime/init-operation.json',op);assert.equal(item(f.check(),'operation').status,'issue');
});

test('package descriptor malformed source inventory is separate from project errors and never reads unlisted victim paths',t=>{
 const f=fixture(t,true),read=fs.readSync,open=fs.openSync,fds=new Set();
 t.mock.method(fs,'openSync',(path,...args)=>{const fd=open(path,...args);if(String(path)===join(packageRoot,'resources/runtime-baseline.json'))fds.add(fd);return fd;});
 t.mock.method(fs,'readSync',(fd,buffer,offset,length,position)=>{if(fds.has(fd)){fds.delete(fd);const count=read(fd,buffer,offset,length,position);const fake=Buffer.from('{"schemaVersion":1,"pythonMinimum":"3.10","releaseId":"x","files":{}}');buffer.fill(32,offset,offset+count);fake.copy(buffer,offset);return count;}return read(fd,buffer,offset,length,position);});syncBuiltinESMExports();t.after(()=>{t.mock.restoreAll();syncBuiltinESMExports();});
 f.put('.pi/settings.json','{');const r=f.check();assert.equal(item(r,'package').status,'issue');assert.match(item(r,'package').summary,/Unsupported package runtime baseline/);assert.equal(item(r,`config:${f.root}:.pi/settings.json`).status,'issue');assert.equal(item(r,'runtime-probe').status,'blocked');
});

test('cooperative cancelled input and bounded formatter retain honest omission/runtime boundaries',t=>{
 const f=fixture(t,true),controller=new AbortController();controller.abort();const r=collectDiagnostics({cwd:f.root},{signal:controller.signal});assert.ok(r.items.some(i=>i.status==='cancelled'));assert.match(formatDiagnostics(r),/Cancelled/);
 const item={id:'bad',category:'configuration',status:'issue',severity:'error',summary:'bad\x1b[31m\n'+ '字'.repeat(500),evidence:['字'.repeat(500)],impact:'字'.repeat(500),advice:'字'.repeat(500)};
 const report=formatDiagnostics({...r,items:Array.from({length:64},()=>item),omitted:2});assert.ok(Buffer.byteLength(report)<=DIAGNOSTIC_LIMITS.report);assert.match(report,/omitted by the report budget/);assert.match(report,/Read-only: no files were changed/);assert.doesNotMatch(report,/\x1b/);
});

for(const mutation of [m=>{m.schemaVersion=1;},m=>{delete m.files['.trellis/scripts/task.py'];},m=>{m.files['.trellis/scripts/evil.py']=m.files['.trellis/scripts/task.py'];delete m.files['.trellis/scripts/task.py'];},m=>{m.files['.trellis/scripts/task.py'].source='../victim';},m=>{m.templates['.trellis/workflow.md'].origin='preserved-project';m.templates['.trellis/workflow.md'].source={kind:'project-snapshot',revision:'/victim'};},m=>{m.extra=true;}])test('static manifest projection rejects strict engine provenance attack without authorizing execution',t=>{
 const f=fixture(t,true),manifest=JSON.parse(readFileSync(join(f.root,'.trellis/.pi-trellis.json')));mutation(manifest);f.put('.trellis/.pi-trellis.json',manifest);assert.throws(()=>verifyRuntime(f.root));const r=f.check();assert.equal(item(r,'manifest').status,'issue');assert.equal(item(r,'runtime-probe').status,'blocked');assert.equal(item(r,'inventory:runtime').status,'pass');
});

test('old release is distinct from missing/empty manifest and never grants current execution',t=>{
 const f=fixture(t,true),manifest=JSON.parse(readFileSync(join(f.root,'.trellis/.pi-trellis.json')));manifest.runtimeReleaseId='pi-trellis-runtime-v1-'+ 'a'.repeat(64);f.put('.trellis/.pi-trellis.json',manifest);const r=f.check();assert.match(item(r,'manifest').summary,/Unsupported project runtime release/);assert.equal(item(r,'runtime-probe').status,'blocked');
});

test('older release may lack package-added rows; current-release gaps and unknown rows stay invalid',t=>{
 const f=fixture(t,true),path='.trellis/.pi-trellis.json',added='.trellis/scripts/diagnostics.py',base=JSON.parse(readFileSync(join(f.root,path)));
 const check=mutate=>{const m=structuredClone(base);mutate(m);f.put(path,m);return item(f.check(),'manifest');};
 const older=check(m=>{m.runtimeReleaseId='pi-trellis-runtime-v1-'+'a'.repeat(64);delete m.files[added];});
 assert.doesNotMatch(older.summary,/Incomplete or unknown managed resource entries/);assert.match(older.summary,/Unsupported project runtime release/);
 assert.match(check(m=>{delete m.files[added];}).summary,/Incomplete or unknown managed resource entries/);
 assert.match(check(m=>{m.runtimeReleaseId='pi-trellis-runtime-v1-'+'a'.repeat(64);m.files['.trellis/scripts/unknown.py']=m.files['.trellis/scripts/task.py'];}).summary,/Incomplete or unknown managed resource entries/);
});

test('FIFO and descriptor replacement cannot hang or authorize reads',t=>{
 if(process.platform==='win32'){t.skip('POSIX FIFO fixture');return;}
 const f=fixture(t,true),file=join(f.root,'.pi/settings.json'),id=`config:${f.root}:.pi/settings.json`;mkdirSync(dirname(file),{recursive:true});childProcess.execFileSync('mkfifo',[file]);let g=guards(t);assert.equal(item(f.check(),id).status,'issue');g.restore();
 rmSync(file);f.put('.pi/settings.json','{}');const open=fs.openSync;let swapped=false;
 t.mock.method(fs,'openSync',(path,...args)=>{if(String(path)===file&&!swapped){swapped=true;rmSync(file);childProcess.execFileSync('mkfifo',[file]);}return open(path,...args);});syncBuiltinESMExports();t.after(()=>{t.mock.restoreAll();syncBuiltinESMExports();});assert.equal(item(f.check(),id).status,'issue');assert.ok(swapped);
});

test('text/config read totals are shared without broadening scope',t=>{
 const f=fixture(t,true);f.put('.trellis/config.yaml','x'.repeat(DIAGNOSTIC_LIMITS.file));f.put('.pi/pi-trellis.json',' '.repeat(DIAGNOSTIC_LIMITS.file-2)+'{}');f.put('.pi/settings.json','{}');const r=f.check();assert.ok(r.items.some(i=>/byte budget exceeded/.test(i.summary)));assert.equal(item(r,'runtime-probe').status,'blocked');
});

test('package runtime byte drift is detected separately through the bounded descriptor reader',t=>{
 const f=fixture(t,true),open=fs.openSync,read=fs.readSync,fds=new Set();
 t.mock.method(fs,'openSync',(path,...args)=>{const fd=open(path,...args);if(String(path)===join(packageRoot,'runtime/task.py'))fds.add(fd);return fd;});
 t.mock.method(fs,'readSync',(fd,buffer,...args)=>{const count=read(fd,buffer,...args);if(fds.has(fd)&&count){buffer[args[0]]^=1;fds.delete(fd);}return count;});syncBuiltinESMExports();t.after(()=>{t.mock.restoreAll();syncBuiltinESMExports();});const r=f.check();assert.equal(item(r,'package').status,'issue');assert.match(item(r,'package').summary,/Package runtime hash mismatch/);assert.equal(item(r,'manifest').status,'blocked');assert.equal(item(r,'runtime-probe').status,'blocked');
});

test('cancellation during fixed inventory never leaves a passed inventory item or escapes collector',t=>{
 const f=fixture(t,true),controller=new AbortController(),open=fs.openSync,read=fs.readSync;const fds=new Set();
 t.mock.method(fs,'openSync',(path,...args)=>{const fd=open(path,...args);if(String(path)===join(f.root,'.trellis/scripts/task.py'))fds.add(fd);return fd;});
 t.mock.method(fs,'readSync',(fd,...args)=>{const count=read(fd,...args);if(fds.has(fd)){controller.abort();fds.delete(fd);}return count;});syncBuiltinESMExports();t.after(()=>{t.mock.restoreAll();syncBuiltinESMExports();});const r=collectDiagnostics({cwd:f.root},{signal:controller.signal});assert.equal(item(r,'inventory:runtime').status,'cancelled');assert.equal(item(r,'inventory:agent').status,'cancelled');assert.ok(!r.items.some(i=>i.id==='inventory:runtime'&&i.status==='pass'));assert.match(formatDiagnostics(r),/Cancelled/);
});

test('managed task worktree marker is reported and blocks runtime probes from that checkout',t=>{
 const f=fixture(t,true),victim=fixture(t);mkdirSync(join(f.root,'.trellis/.runtime/pi-trellis'),{recursive:true});symlinkSync(join(victim.root,'missing'),join(f.root,'.trellis/.runtime/pi-trellis/binding.json'));const g=guards(t,{forbidden:[victim.root]});const r=f.check();g.restore();assert.equal(item(r,'marker').status,'issue');
 const m=fixture(t,true);m.put('.trellis/.runtime/pi-trellis/binding.json','{}');const r2=m.check();assert.equal(item(r2,'marker').status,'issue');assert.match(item(r2,'marker').summary,/managed task worktree/);
});

test('package failure never hides malformed manifest or missing required documents',t=>{
 const f=fixture(t,true);f.put('.trellis/.pi-trellis.json','{}');rmSync(join(f.root,'.trellis/workflow.md'));
 const open=fs.openSync;t.mock.method(fs,'openSync',(path,...args)=>{if(String(path)===join(packageRoot,'resources/runtime-baseline.json'))throw Error('Package descriptor unavailable');return open(path,...args);});syncBuiltinESMExports();t.after(()=>{t.mock.restoreAll();syncBuiltinESMExports();});
 const r=f.check();assert.equal(item(r,'package').status,'issue');assert.equal(item(r,'manifest').status,'issue');assert.equal(item(r,'documents').status,'issue');assert.equal(item(r,'inventory:runtime').status,'blocked');
});

test('unsafe non-required template route cannot masquerade as a valid runtime snapshot',t=>{
 const f=fixture(t,true),victim=fixture(t);rmSync(join(f.root,'.trellis/.gitignore'));symlinkSync(join(victim.root,'missing'),join(f.root,'.trellis/.gitignore'));
 assert.throws(()=>verifyRuntime(f.root));const g=guards(t,{forbidden:[victim.root]});const r=f.check();g.restore();assert.equal(item(r,'template-routes').status,'issue');assert.equal(r.facts.runtimeStaticValid,false);
});

test('malformed completed operation plan metadata cannot pass as a valid audit envelope',t=>{
 const f=fixture(t,true),op=JSON.parse(readFileSync(join(f.root,'.trellis/.runtime/init-operation.json')));delete op.plan.schemaVersion;op.plan.actions[0].mode='0644';f.put('.trellis/.runtime/init-operation.json',op);
 const r=f.check();assert.equal(item(r,'operation').status,'issue');assert.equal(r.facts.runtimeStaticValid,false);
});

test('ancestor replacement at descriptor open is rejected before victim bytes are read',t=>{
 const f=fixture(t,true),victim=fixture(t);f.put('.pi/settings.json','{}');const parent=join(f.root,'.pi'),backup=join(f.root,'saved-pi'),file=join(parent,'settings.json');fs.linkSync(file,join(victim.root,'settings.json'));let swapped=false,readVictim=false;const open=fs.openSync,read=fs.readSync,close=fs.closeSync;const victimFds=new Set();
 t.mock.method(fs,'openSync',(path,...args)=>{if(String(path)===file&&!swapped){swapped=true;fs.renameSync(parent,backup);symlinkSync(victim.root,parent);}const fd=open(path,...args);if(String(path)===file)victimFds.add(fd);return fd;});
 t.mock.method(fs,'closeSync',fd=>{victimFds.delete(fd);return close(fd);});t.mock.method(fs,'readSync',(fd,...args)=>{if(victimFds.has(fd))readVictim=true;return read(fd,...args);});syncBuiltinESMExports();t.after(()=>{t.mock.restoreAll();syncBuiltinESMExports();});
 const r=f.check();assert.ok(swapped);assert.equal(item(r,`config:${f.root}:.pi/settings.json`).status,'issue');assert.equal(readVictim,false);
});

test('exhausted text budget does not drain or suppress independent fixed inventory',t=>{
 const f=fixture(t,true);f.put('.trellis/config.yaml','x'.repeat(DIAGNOSTIC_LIMITS.file));f.put('.pi/pi-trellis.json',' '.repeat(DIAGNOSTIC_LIMITS.file-2)+'{}');f.put('.pi/settings.json','{}');
 const open=fs.openSync,close=fs.closeSync,read=fs.readSync,fds=new Map();let textBytes=0;
 t.mock.method(fs,'openSync',(path,...args)=>{const fd=open(path,...args);fds.set(fd,String(path));return fd;});t.mock.method(fs,'closeSync',fd=>{fds.delete(fd);return close(fd);});
 t.mock.method(fs,'readSync',(fd,...args)=>{const count=read(fd,...args),path=fds.get(fd);if(path&&!path.includes('/runtime/')&&!path.includes('/scripts/')&&!path.includes('/agents/')&&!path.includes('/skills/')&&!path.includes('/resources/templates/'))textBytes+=count;return count;});syncBuiltinESMExports();t.after(()=>{t.mock.restoreAll();syncBuiltinESMExports();});
 const r=f.check();assert.equal(item(r,'inventory:runtime').status,'pass');assert.ok(textBytes<=DIAGNOSTIC_LIMITS.text+1,`actual text bytes ${textBytes}`);assert.ok(r.items.some(i=>/byte budget exceeded/.test(i.summary)));
});

test('formatter identifies omitted categories without leaking category controls',t=>{
 const f=fixture(t),r=f.check();const row={id:'issue',category:'secret-category\u202e',status:'issue',severity:'error',summary:'字'.repeat(500),evidence:Array.from({length:12},()=> '字'.repeat(500)),impact:'impact',advice:'next'};
 const report=formatDiagnostics({...r,items:Array.from({length:64},()=>row)});assert.ok(Buffer.byteLength(report)<=DIAGNOSTIC_LIMITS.report);assert.match(report,/Omitted categories: secret-category/);assert.doesNotMatch(report,/\u202e/);
});
