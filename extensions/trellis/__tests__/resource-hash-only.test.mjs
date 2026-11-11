import assert from 'node:assert/strict';
import test from 'node:test';
import fs, { chmodSync, lstatSync, readFileSync, writeFileSync, rmSync, mkdtempSync, realpathSync } from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { apply, plan, inspect, verifyRuntime, digest, packageRoot, packageResources, packageSkills, validateManifest, normalizeManifest } from '../lib/initialization/engine.ts';
import { resourcePlan, applyResourcePlan, templatePlan, applyTemplatePlan, atomicFile, stamp } from '../lib/initialization/resources.ts';
import { adoptPlan, applyAdoptPlan } from '../lib/initialization/adoption.ts';
import { collectDiagnostics } from '../lib/initialization/diagnostics.ts';
import { runDiagnostics } from '../lib/initialization/diagnostic-runtime.ts';
import { copyRuntimeFixture, legacyManifest, legacyOperation } from './runtime-fixture.mjs';

const MANIFEST='.trellis/.pi-trellis.json', OPERATION='.trellis/.runtime/init-operation.json';
const item=(result,id)=>result.items.find(row=>row.id===id);
const put=(root,path,value)=>writeFileSync(join(root,path),typeof value==='string'?value:JSON.stringify(value));
const json=(root,path)=>JSON.parse(readFileSync(join(root,path)));
const noMode=value=>assert.doesNotMatch(JSON.stringify(value),/"mode":/);
function fresh(t) { const root=realpathSync(mkdtempSync(join(tmpdir(),'trellis-hash-only-')));t.after(()=>rmSync(root,{recursive:true,force:true}));return root; }

for (const schema of [2,3]) test(`legal schema ${schema} normalizes all rows; upgrade writes no unchanged resource bytes`,t=>{
 const root=copyRuntimeFixture(t), original=json(root,MANIFEST), legacy=legacyManifest(original,schema);
 // Exercise deep-copy preserved and unchanged skill rows as well as runtime defaults.
 legacy.templates['.trellis/config.yaml']={origin:'preserved-project',sha256:digest(readFileSync(join(root,'.trellis/config.yaml'))),mode:0o600,source:{kind:'project-snapshot',revision:null}};
 put(root,MANIFEST,legacy);
 const resources=Object.keys({...original.files,...original.templates,...original.skills});
 for(const path of resources) chmodSync(join(root,path),0o664);
 const before=Object.fromEntries(resources.map(path=>[path,lstatSync(join(root,path)).ino]));
 const m=verifyRuntime(root);assert.equal(m.schemaVersion,4);noMode(m);assert.deepEqual(json(root,MANIFEST),legacy);
 assert.equal(inspect(root).state,'ready');assert.equal(item(collectDiagnostics({cwd:root}),'manifest').status,'pass');
 const p=resourcePlan(root,'update');assert.equal(p.unchanged,false);assert.deepEqual(p.changes,[]);assert.deepEqual(p.report.conflicts,[]);noMode(p.manifest);
 assert.ok(p.report.rows.some(row=>row.path==='.trellis/workflow.md'&&row.state==='Current template'));
 assert.ok(p.report.rows.filter(row=>row.path.startsWith('.pi/skills/')).every(row=>row.state==='Current'));
 applyResourcePlan(p);assert.equal(json(root,MANIFEST).schemaVersion,4);noMode(json(root,MANIFEST));
 for(const path of resources){assert.equal(lstatSync(join(root,path)).ino,before[path]);assert.equal(lstatSync(join(root,path)).mode&0o777,0o664);}
 assert.equal(resourcePlan(root,'update').unchanged,true);
});

test('schema4 rejects permission fields; malformed legacy fields remain invalid before normalization',t=>{
 const root=copyRuntimeFixture(t), base=json(root,MANIFEST);
 for(const category of ['files','templates','skills']) {
  const value=structuredClone(base),row=Object.values(value[category])[0];row.mode=0o644;
  assert.throws(()=>validateManifest(value));assert.throws(()=>normalizeManifest(value));
 }
 for(const category of ['files','templates','skills']) {
  const value=structuredClone(base),row=Object.values(value[category])[0];
  Object.defineProperty(value[category],'__proto__',{value:row,enumerable:true});
  assert.throws(()=>validateManifest(JSON.parse(JSON.stringify(value))));
 }
 for(const mode of [null,'0644',-1,1.5,0o1000]) {
  const value=legacyManifest(base);Object.values(value.files)[0].mode=mode;assert.throws(()=>normalizeManifest(value));
 }
 const value=legacyManifest(base);value.templates['.trellis/workflow.md'].sha256=null;assert.throws(()=>normalizeManifest(value));
 value.templates['.trellis/workflow.md']={origin:'preserved-project',sha256:null,mode:null,source:{kind:'project-snapshot',revision:null}};
 assert.equal(normalizeManifest(value).templates['.trellis/workflow.md'].sha256,null);
});

test('unknown __proto__ rows survive normalization and are refused by runtime, Update and diagnostics',t=>{
 const root=copyRuntimeFixture(t),current=json(root,MANIFEST);
 for(const base of [current,legacyManifest(current)])for(const category of ['files','templates','skills']) {
  const value=structuredClone(base),[path,row]=Object.entries(value[category])[0];
  delete value[category][path];Object.defineProperty(value[category],'__proto__',{value:row,enumerable:true});
  const raw=JSON.stringify(value),normalized=normalizeManifest(JSON.parse(raw));
  assert.equal(Object.hasOwn(normalized[category],'__proto__'),true);put(root,MANIFEST,raw);
  assert.throws(()=>verifyRuntime(root));assert.throws(()=>resourcePlan(root,'update'));
  assert.equal(item(collectDiagnostics({cwd:root}),'manifest').status,'issue');
  assert.equal(readFileSync(join(root,MANIFEST),'utf8'),raw);
 }
});

test('completed legacy operation hashes original shape, not normalized/new canonical outputs; never live recovery authority',t=>{
 const root=copyRuntimeFixture(t), legacy=legacyOperation(json(root,OPERATION));
 // Historical output can describe the old release and canonical manifest bytes.
 legacy.plan.releaseId='pi-trellis-runtime-v1-'+'a'.repeat(64);
 const {planHash,...body}=legacy.plan;legacy.plan.planHash=digest(JSON.stringify(body));
 put(root,OPERATION,legacy);put(root,MANIFEST,legacyManifest(json(root,MANIFEST)));
 assert.ok(verifyRuntime(root));assert.equal(inspect(root).state,'ready');assert.equal(item(collectDiagnostics({cwd:root}),'operation').status,'pass');
 assert.equal(plan(root,'Fixture'),undefined);noMode(verifyRuntime(root));
 const invalid=structuredClone(legacy);invalid.plan.actions[0].mode=0o600;put(root,OPERATION,invalid);
 assert.throws(()=>verifyRuntime(root),/hash/);assert.equal(inspect(root).state,'conflict');assert.equal(item(collectDiagnostics({cwd:root}),'operation').status,'issue');assert.throws(()=>resourcePlan(root,'update'),/hash/);
 // A valid hash does not authorize execution/migration of an incomplete legacy plan.
 legacy.status='incomplete';put(root,OPERATION,legacy);const before=readFileSync(join(root,OPERATION));
 assert.throws(()=>verifyRuntime(root),/Legacy incomplete/);assert.throws(()=>plan(root,'Fixture'),/Legacy incomplete/);assert.throws(()=>resourcePlan(root,'update'),/Legacy incomplete/);
 assert.deepEqual(readFileSync(join(root,OPERATION)),before);
});

test('completed operation history rejects empty actions even with a valid original plan hash',t=>{
 const root=copyRuntimeFixture(t), current=json(root,OPERATION);
 for (const value of [current,legacyOperation(current)]) {
  value.plan.actions=[];value.plan.guards={};value.completed=[];
  const {planHash,...body}=value.plan;value.plan.planHash=digest(JSON.stringify(body));
  put(root,OPERATION,value);const before=readFileSync(join(root,OPERATION));
  assert.throws(()=>verifyRuntime(root),/Invalid initialization plan envelope/);
  assert.equal(inspect(root).state,'conflict');assert.equal(item(collectDiagnostics({cwd:root}),'operation').status,'issue');
  assert.throws(()=>resourcePlan(root,'update'),/Invalid initialization plan envelope/);
  assert.deepEqual(readFileSync(join(root,OPERATION)),before);
 }
});

test('completed historical metadata and lexical path validation remain strict without reading historical outputs',t=>{
 const root=copyRuntimeFixture(t),current=json(root,OPERATION);
 const mutations=[
  value=>{value.plan.workspaceReused='false';},value=>{value.plan.taskReused=1;},
  value=>{value.plan.releaseId+='\n';},value=>{value.plan.task='.trellis/tasks/../foreign';},
  value=>{value.completed.pop();},value=>{value.completed.push(value.completed[0]);},
  ...['/absolute','../foreign','bad\\route','bad\u0000route','bad\u202eroute','bad\ud800route','bad\u2028route'].map(path=>value=>{value.plan.guards[path]=null;}),
 ];
 for(const base of [current,legacyOperation(current)])for(const mutate of mutations) {
  const value=structuredClone(base);mutate(value);
  const {planHash,...body}=value.plan;value.plan.planHash=digest(JSON.stringify(body));
  put(root,OPERATION,value);const before=readFileSync(join(root,OPERATION));
  assert.throws(()=>verifyRuntime(root));assert.equal(inspect(root).state,'conflict');
  assert.throws(()=>resourcePlan(root,'update'));assert.equal(item(collectDiagnostics({cwd:root}),'operation').status,'issue');
  assert.deepEqual(readFileSync(join(root,OPERATION)),before);
 }
});

test('valid Unicode private-use developer paths initialize and diagnose consistently',t=>{
 const root=fresh(t),user='Dev\uE000';
 const value=plan(root,user);assert.equal(apply(value).state,'ready');
 assert.equal(inspect(root).developer,user);assert.ok(verifyRuntime(root));
 const result=collectDiagnostics({cwd:root});
 for(const id of ['operation','developer','workspace'])assert.equal(item(result,id).status,'pass',id);
 assert.equal(resourcePlan(root,'update').unchanged,true);
});

test('chmod-only preview drift and current initialization retry ignore permissions but reject changed bytes',t=>{
 const root=fresh(t);put(root,'AGENTS.md','project instructions\n');chmodSync(join(root,'AGENTS.md'),0o600);
 const p=plan(root,'Dev');assert.equal(p.schemaVersion,2);noMode(p);
 chmodSync(join(root,'AGENTS.md'),0o664);
 assert.throws(()=>apply(p,{afterWrite:(path,n)=>{chmodSync(join(root,path),0o664);if(n===7)throw Error('interrupted');}}),/interrupted/);
 assert.equal(inspect(root).state,'incomplete');const retry=plan(root,'Dev');assert.equal(retry.planHash,p.planHash);noMode(retry);assert.equal(apply(retry).state,'ready');
 assert.equal(lstatSync(join(root,p.actions[0].path)).mode&0o777,0o664);
 assert.equal(lstatSync(join(root,'AGENTS.md')).mode&0o777,0o644);
 const other=fresh(t),q=plan(other,'Dev');assert.throws(()=>apply(q,{afterWrite:()=>{throw Error('interrupted');}}));put(other,q.actions[0].path,'modified');assert.throws(()=>plan(other,'Dev'),/changed since preview/);
});

test('restrictive umask and package executable bits do not change fingerprints or default publication',t=>{
 const root=fresh(t), oldUmask=process.umask(0o077), stat=fs.lstatSync;
 // Test-only package stat seam; never chmod the package or a personal install.
 fs.lstatSync=(path,...args)=>{const value=stat(path,...args);if(String(path).startsWith(packageRoot+'/'))value.mode=(value.mode&~0o777)|0o755;return value;};syncBuiltinESMExports();
 try {
  noMode(packageResources());noMode(packageSkills());const p=plan(root,'Dev');noMode(p);assert.equal(apply(p).state,'ready');
  const m=verifyRuntime(root);for(const path of Object.keys({...m.files,...m.templates,...m.skills}))assert.equal(stat(join(root,path)).mode&0o777,0o644,path);
  assert.equal(stat(join(root,OPERATION)).mode&0o777,0o600);
 } finally { fs.lstatSync=stat;syncBuiltinESMExports();process.umask(oldUmask); }
});

test('chmod-only templates/skills/current roots stay Current and do not rewrite; content races still refuse',t=>{
 const root=copyRuntimeFixture(t),m=json(root,MANIFEST),paths=Object.keys({...m.files,...m.templates,...m.skills});
 const p=resourcePlan(root,'update');for(const path of [...paths,'AGENTS.md','.gitignore',MANIFEST])chmodSync(join(root,path),0o664);
 const before=Object.fromEntries(paths.map(path=>[path,lstatSync(join(root,path)).ino]));
 assert.deepEqual(resourcePlan(root,'repair').changes,[]);assert.equal(resourcePlan(root,'update').unchanged,true);
 applyResourcePlan(p);const tp=templatePlan(root,'both');assert.ok(tp.rows.every(row=>row.state==='Same'));assert.equal(applyTemplatePlan(tp),undefined);
 for(const path of paths)assert.equal(lstatSync(join(root,path)).ino,before[path]);
 put(root,'.trellis/.runtime/init.lock','external owner');assert.throws(()=>applyResourcePlan(resourcePlan(root,'update')),/EEXIST/);rmSync(join(root,'.trellis/.runtime/init.lock'));
 const stale=resourcePlan(root,'update');put(root,'.pi/skills/trellis-check/SKILL.md','custom skill');assert.throws(()=>applyResourcePlan(stale),/changed since preview|Modified managed files/);assert.ok(resourcePlan(root,'update').report.conflicts.includes('.pi/skills/trellis-check/SKILL.md'));
 const guard=stamp(root,'AGENTS.md');put(root,'AGENTS.md','concurrent');assert.throws(()=>atomicFile(root,'AGENTS.md',Buffer.from('overwrite'),0o644,guard),/Concurrent change/);assert.equal(readFileSync(join(root,'AGENTS.md'),'utf8'),'concurrent');
});

test('legacy preserved unselected template and unchanged skills lose modes on Apply template publication; backups are content-only/private',t=>{
 const root=copyRuntimeFixture(t),legacy=legacyManifest(json(root,MANIFEST));
 legacy.templates['.trellis/config.yaml']={origin:'preserved-project',sha256:digest('custom config'),mode:0o640,source:{kind:'project-snapshot',revision:null}};
 put(root,'.trellis/config.yaml','custom config');put(root,'.trellis/workflow.md','custom workflow');put(root,MANIFEST,legacy);
 chmodSync(join(root,'.trellis/workflow.md'),0o777);const p=templatePlan(root,'workflow');chmodSync(join(root,'.trellis/workflow.md'),0o600);
 const mask=process.umask(0o077);let backup;
 try { backup=applyTemplatePlan(p); } finally { process.umask(mask); }
 assert.equal(readFileSync(join(root,backup,'.trellis/workflow.md'),'utf8'),'custom workflow');assert.equal(lstatSync(join(root,backup,'.trellis/workflow.md')).mode&0o777,0o600);
 assert.equal(lstatSync(join(root,'.trellis/workflow.md')).mode&0o777,0o644);noMode(json(root,MANIFEST));assert.equal(json(root,MANIFEST).schemaVersion,4);
 assert.equal(json(root,MANIFEST).templates['.trellis/config.yaml'].origin,'preserved-project');assert.equal(readFileSync(join(root,'.trellis/config.yaml'),'utf8'),'custom config');
});

test('adoption preserves chmod-only exact skills and root bytes without inheriting permissions',t=>{
 const root=copyRuntimeFixture(t),m=json(root,MANIFEST);rmSync(join(root,MANIFEST));rmSync(join(root,OPERATION));
 const entry='.pi/skills/trellis-check/SKILL.md';chmodSync(join(root,entry),0o755);const inode=lstatSync(join(root,entry)).ino;
 put(root,'AGENTS.md','user root\n');chmodSync(join(root,'AGENTS.md'),0o600);
 const p=adoptPlan(root);assert.ok(!p.changes.some(c=>c.path===entry));noMode(p);applyAdoptPlan(p);
 assert.equal(lstatSync(join(root,entry)).ino,inode);assert.equal(lstatSync(join(root,entry)).mode&0o777,0o755);assert.equal(lstatSync(join(root,'AGENTS.md')).mode&0o777,0o644);noMode(json(root,MANIFEST));assert.equal(Object.keys(json(root,MANIFEST).skills).length,Object.keys(m.skills).length);
});

test('pure chmod deployment passes static/worker/bootstrap/recheck diagnostics with no writes',async t=>{
 const root=copyRuntimeFixture(t),m=json(root,MANIFEST);
 for(const path of Object.keys({...m.files,...m.templates,...m.skills}))chmodSync(join(root,path),0o664);
 const legacy=legacyManifest(m);put(root,MANIFEST,legacy);put(root,OPERATION,legacyOperation(json(root,OPERATION)));
 const before=readFileSync(join(root,MANIFEST));const staticResult=collectDiagnostics({cwd:root});
 for(const id of ['manifest','operation','inventory:runtime','inventory:agent','inventory:skill'])assert.equal(item(staticResult,id).status,'pass',id);
 const result=await runDiagnostics({cwd:root});assert.equal(item(result,'runtime-probe').status,'pass');assert.equal(item(result,'effective-config').status,'pass');assert.deepEqual(readFileSync(join(root,MANIFEST)),before);
});
