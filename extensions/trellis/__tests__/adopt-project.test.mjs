import assert from 'node:assert/strict';
import { mkdtempSync,mkdirSync,writeFileSync,readFileSync,rmSync,existsSync,chmodSync,lstatSync,symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { join,dirname } from 'node:path';
import test from 'node:test';
import trellis from '../index.ts';
import { adoptPlan,applyAdoptPlan,adoptionSummary,adoptionDialog } from '../lib/initialization/adoption.ts';
import { inspect,verifyRuntime,digest } from '../lib/initialization/engine.ts';
function fixture(t) {
 const root=mkdtempSync(join(tmpdir(),'pi-adopt-'));t.after(()=>rmSync(root,{recursive:true,force:true}));
 const put=(p,s)=>{mkdirSync(dirname(join(root,p)),{recursive:true});writeFileSync(join(root,p),s);};
 put('.trellis/.developer','name=Old User\ninitialized_at=legacy\n');put('.trellis/scripts/task.py','legacy runtime');put('.trellis/scripts/extra.py','custom script');put('.trellis/.version','0.6.16');put('.trellis/workflow.md','custom workflow\r\n');put('.trellis/config.yaml','custom config');put('.trellis/tasks/old/task.json','history');put('.trellis/workspace/Old User/journal-1.md','journal');put('.pi/agents/trellis-check.md','old role document');put('AGENTS.md','prefix\r\n<!-- TRELLIS:START -->old<!-- TRELLIS:END -->\r\nsuffix');chmodSync(join(root,'AGENTS.md'),0o640);chmodSync(join(root,'.trellis/config.yaml'),0o600);
 return {root,put};
}
test('adopts legacy with exact runtime, preserved documents/modes, no backups/deletion/onboarding',t=>{
 const f=fixture(t),p=adoptPlan(f.root);assert.equal(inspect(f.root).state,'unsupported');assert.ok(!existsSync(join(f.root,'.trellis/.pi-trellis.json')));assert.match(adoptionSummary(p),/Legacy — left in place: .trellis\/scripts\/extra.py/);
 // Preview is read-only: no template is created and no legacy runtime/role byte is touched.
 assert.ok(!existsSync(join(f.root,'.trellis/spec/index.md')));assert.equal(readFileSync(join(f.root,'.trellis/scripts/task.py'),'utf8'),'legacy runtime');assert.equal(readFileSync(join(f.root,'.pi/agents/trellis-check.md'),'utf8'),'old role document');
 assert.deepEqual(p.rows.filter(r=>r.path==='AGENTS.md').map(r=>r.state),['Replace block']);
 assert.equal(applyAdoptPlan(p).state,'ready');const m=verifyRuntime(f.root);
 for(const [path,r] of Object.entries(m.files)){assert.equal(digest(readFileSync(join(f.root,path))),r.sha256);assert.equal(lstatSync(join(f.root,path)).mode&0o777,r.mode);}
 assert.notEqual(readFileSync(join(f.root,'.pi/agents/trellis-check.md'),'utf8'),'old role document');
 assert.equal(m.templates['.trellis/workflow.md'].origin,'preserved-project');assert.equal(m.templates['.trellis/spec/index.md'].origin,'package-default');
 // Preserved provenance records the actual bytes/mode and a diagnostic-only snapshot source.
 assert.deepEqual(m.templates['.trellis/config.yaml'],{origin:'preserved-project',sha256:digest('custom config'),mode:0o600,source:{kind:'project-snapshot',revision:null}});
 assert.equal(lstatSync(join(f.root,'.trellis/config.yaml')).mode&0o777,0o600);
 test('HOME is refused and the extension stops blocking runtime commands after adoption',t=>{
 const f=fixture(t),home=process.env.HOME;
 try { process.env.HOME=f.root;assert.throws(()=>adoptPlan(f.root),/HOME/); } finally { if(home===undefined)delete process.env.HOME;else process.env.HOME=home; }
 assert.equal(readFileSync(join(f.root,'.trellis/scripts/task.py'),'utf8'),'legacy runtime');
 const handlers=new Map();
 trellis({events:{on:()=>()=>{},emit:()=>{}},on:(n,h)=>handlers.set(n,h),registerTool:()=>{},registerCommand:()=>{},sendMessage:()=>{},getAllTools:()=>[{name:'subagent_run'}]});
 const ctx={cwd:f.root,hasUI:true,sessionManager:{getSessionId:()=>f.root,getSessionFile:()=>undefined},ui:{theme:{fg:(_c,s)=>s,bold:s=>s},setStatus:()=>{},setWidget:()=>{},notify:()=>{}}};
 const command='python3 .trellis/scripts/task.py current --json';
 const blocked=handlers.get('tool_call')({toolName:'bash',input:{command}},ctx);
 return Promise.resolve(blocked).then(async result=>{
  assert.equal(result.block,true);
  assert.equal(applyAdoptPlan(adoptPlan(f.root)).state,'ready');
  const input={command};assert.equal(await handlers.get('tool_call')({toolName:'bash',input},ctx),undefined);assert.match(input.command,/^export TRELLIS_CONTEXT_ID=/);
 });
});
for(const [path,text] of [['.trellis/workflow.md','custom workflow\r\n'],['.trellis/config.yaml','custom config'],['.trellis/tasks/old/task.json','history'],['.trellis/workspace/Old User/journal-1.md','journal'],['.trellis/scripts/extra.py','custom script'],['.trellis/.version','0.6.16']])assert.equal(readFileSync(join(f.root,path),'utf8'),text);
 const agents=readFileSync(join(f.root,'AGENTS.md'),'utf8');assert.ok(agents.startsWith('prefix\r\n'));assert.ok(agents.endsWith('\r\nsuffix'));assert.equal(lstatSync(join(f.root,'AGENTS.md')).mode&0o777,0o640);
 assert.ok(!existsSync(join(f.root,'.trellis/.runtime/adopt-backups')));assert.ok(!existsSync(join(f.root,'.trellis/.runtime/init-operation.json')));assert.ok(!existsSync(join(f.root,'.trellis/tasks/00-bootstrap-guidelines')));assert.throws(()=>adoptPlan(f.root));
});
test('missing identity adopts as supported and interrupted manifest-less adoption can be reconfirmed',t=>{
 const f=fixture(t);rmSync(join(f.root,'.trellis/.developer'));let written;
 assert.throws(()=>applyAdoptPlan(adoptPlan(f.root),{afterWrite:p=>{written=p;throw Error('interrupted');}}),/Partial files/);
 assert.ok(!existsSync(join(f.root,'.trellis/.pi-trellis.json')));assert.ok(!existsSync(join(f.root,'.trellis/.runtime/init.lock')));assert.equal(inspect(f.root).state,'unsupported');
 // Recovery without an operation record: the already-written file is reported as Current on re-preview.
 const again=adoptPlan(f.root);assert.deepEqual(again.rows.filter(r=>r.path===written).map(r=>r.state),['Current']);assert.ok(!again.changes.some(c=>c.path===written));
 assert.equal(applyAdoptPlan(again).state,'supported');
});
for(const [path,text] of [['.trellis/.runtime/init.lock','owner'],['.trellis/.runtime/init-operation.json','{}'],['.trellis/.pi-trellis.json','{}'],['.trellis/.runtime/pi-trellis/binding.json','{}'],['AGENTS.md','<!-- TRELLIS:START -->']])test(`reject ${path} before writes`,t=>{const f=fixture(t);f.put(path,text);assert.throws(()=>adoptPlan(f.root));assert.equal(readFileSync(join(f.root,'.trellis/scripts/task.py'),'utf8'),'legacy runtime');});
test('preserved provenance records the real project Git revision when HEAD exists',t=>{
 const f=fixture(t),git=a=>execFileSync('git',a,{cwd:f.root,env:{...process.env,GIT_CONFIG_GLOBAL:'/dev/null',GIT_CONFIG_SYSTEM:'/dev/null'},stdio:'ignore'});
 git(['init','-q','-b','main']);git(['-c','user.name=Fixture','-c','user.email=fixture@example.invalid','-c','commit.gpgsign=false','commit','-q','--allow-empty','-m','fixture']);
 const head=execFileSync('git',['rev-parse','HEAD'],{cwd:f.root,encoding:'utf8'}).trim();
 const m=applyAdoptPlan(adoptPlan(f.root)).manifest;
 assert.deepEqual(m.templates['.trellis/workflow.md'].source,{kind:'project-snapshot',revision:head});
 assert.match(head,/^[a-f0-9]{40}$/);assert.equal(m.templates['.trellis/spec/index.md'].origin,'package-default');
});
test('an existing root file without a managed block is appended, not replaced',t=>{
 const f=fixture(t);f.put('.gitignore','node_modules\n');f.put('.gitattributes','*.png binary\n');
 const p=adoptPlan(f.root);assert.deepEqual(p.rows.filter(r=>r.path==='.gitignore').map(r=>r.state),['Append block']);
 assert.equal(applyAdoptPlan(p).state,'ready');
 const ignore=readFileSync(join(f.root,'.gitignore'),'utf8'),attributes=readFileSync(join(f.root,'.gitattributes'),'utf8');
 assert.ok(ignore.startsWith('node_modules\n'));assert.match(ignore,/# pi-trellis:ignore:start[\s\S]*# pi-trellis:ignore:end/);
 assert.ok(attributes.startsWith('*.png binary\n'));assert.match(attributes,/journal-\*\.md merge=union/);
});
test('forged/stale plans and symlink targets reject without modifying legacy runtime',t=>{
 const f=fixture(t),p=adoptPlan(f.root);p.changes[0].data=Buffer.from('arbitrary');assert.throws(()=>applyAdoptPlan(p),/changed since/);const q=adoptPlan(f.root);f.put('.trellis/workflow.md','new edits');assert.throws(()=>applyAdoptPlan(q),/changed since/);assert.equal(readFileSync(join(f.root,'.trellis/scripts/task.py'),'utf8'),'legacy runtime');
 rmSync(join(f.root,'.trellis/scripts/task.py'));symlinkSync('/tmp/missing-adopt-victim',join(f.root,'.trellis/scripts/task.py'));assert.throws(()=>adoptPlan(f.root),/symlink/);
});
test('concurrent preserved-template edit during publication leaves manifest unpublished',t=>{const f=fixture(t);assert.throws(()=>applyAdoptPlan(adoptPlan(f.root),{afterWrite:()=>f.put('.trellis/workflow.md','concurrent')}),/Concurrent change/);assert.ok(!existsSync(join(f.root,'.trellis/.pi-trellis.json')));assert.equal(readFileSync(join(f.root,'.trellis/workflow.md'),'utf8'),'concurrent');});
// The preview runs before the lock; a plan can therefore reach publication with unmanaged bytes that
// appeared afterwards. Publication must stop under the lock with no partial skill content and no manifest.
test('unmanaged bytes appearing in a planned skill folder after the preview block adoption under the lock',t=>{
 const f=fixture(t),p=adoptPlan(f.root),folder=Object.keys(p.manifest.skills)[0].split('/').slice(0,3).join('/');
 assert.throws(()=>applyAdoptPlan(p,{underLock:()=>f.put(`${folder}/intruder.md`,'unmanaged')}),/Unmanaged content in skill folder/);
 assert.equal(readFileSync(join(f.root,`${folder}/intruder.md`),'utf8'),'unmanaged');
 assert.ok(!existsSync(join(f.root,'.trellis/.pi-trellis.json')));assert.ok(!existsSync(join(f.root,'.trellis/.runtime/init.lock')));
 assert.ok(!existsSync(join(f.root,`${folder}/SKILL.md`)));
 // Removing the unmanaged file lets the same preview publish unchanged.
 rmSync(join(f.root,`${folder}/intruder.md`));assert.equal(applyAdoptPlan(p).state,'ready');
});

test('counted adoption confirmation retains scope/preservation/destructive warnings without a full-list Check promise',t=>{
 const f=fixture(t),value=adoptPlan(f.root),dialog=adoptionDialog(value);
 assert.match(dialog,/^Confirm · Adopt project\nProject:/);assert.match(dialog,/Replace \d+/);assert.match(dialog,/Preserve \d+/);
 assert.match(dialog,/Backup: +none — runtime scripts, roles and managed root blocks are replaced; nothing is deleted/);assert.match(dialog,/Keeps: +workflow, config, spec, tasks, journals and identity/);
 assert.doesNotMatch(dialog,/--check|Full per-path list/);assert.ok(dialog.split('\n').length<=14);
 const large=adoptionDialog({...value,rows:Array.from({length:1000},(_,i)=>({state:i%2?'Replace':'Install',path:`path-${i}`})),legacy:Array.from({length:300},(_,i)=>`legacy-${i}`)});
 assert.match(large,/Install 500 · Replace 500/);assert.match(large,/Legacy: +300 paths left in place/);assert.match(large,/Backup: +none/);assert.ok(large.split('\n').length<=14);
});

test('adoption dialog renders multiline/control roots on one line without hiding no-backup warning',t=>{
 const f=fixture(t),value=adoptPlan(f.root);value.root+="\n".repeat(40)+'\x1b[31m';const dialog=adoptionDialog(value);
 assert.ok(dialog.split('\n').length<=14);assert.match(dialog,/Backup: +none/);assert.match(dialog,/Keeps: +workflow, config, spec, tasks, journals and identity/);assert.doesNotMatch(dialog,/\x1b/);
});
