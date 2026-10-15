import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync, existsSync, readdirSync, lstatSync, symlinkSync, chmodSync } from 'node:fs';
import fs from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import { join, dirname, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import test from 'node:test';
import { plan, apply, digest, defaultTemplates, verifyRuntime, packageRoot } from '../lib/initialization/engine.ts';
import { templatePlan, applyTemplatePlan, resourcePlan, applyResourcePlan } from '../lib/initialization/resources.ts';
function fixture(t) {
 const root=mkdtempSync(join(tmpdir(),'pi-template-'));t.after(()=>rmSync(root,{recursive:true,force:true}));apply(plan(root,'Dev'));
 const put=(p,s)=>{mkdirSync(dirname(join(root,p)),{recursive:true});writeFileSync(join(root,p),s);};
 const snapshot=(dir=root)=>Object.fromEntries(readdirSync(dir,{withFileTypes:true}).sort((a,b)=>a.name.localeCompare(b.name)).flatMap(e=>{const p=join(dir,e.name),rel=p.slice(root.length+1);return e.isDirectory()?[[rel,'directory'],...Object.entries(snapshot(p))]:[[rel,e.isSymbolicLink()?'symlink':`${lstatSync(p).mode&0o777}:${readFileSync(p).toString('base64')}`]];}));
 return {root,put,snapshot};
}
test('preview is read-only and both adopts exactly five files with backups and honest provenance',t=>{
 const f=fixture(t),manifestPath='.trellis/.pi-trellis.json',m=JSON.parse(readFileSync(join(f.root,manifestPath)));
 f.put('.trellis/workflow.md','custom workflow');chmodSync(join(f.root,'.trellis/workflow.md'),0o640);
 m.templates['.trellis/workflow.md']={origin:'preserved-project',sha256:digest('custom workflow'),mode:0o640,source:{kind:'project-snapshot',revision:null}};
 f.put(manifestPath,JSON.stringify(m));f.put('.trellis/spec/index.md','custom index');rmSync(join(f.root,'.trellis/spec/guides/index.md'));
 f.put('.trellis/spec/own/rules.md','project rules');f.put('.trellis/.runtime/sessions/foreign.json','{"current_task":null}');
 const before=f.snapshot(),p=templatePlan(f.root,'both');assert.deepEqual(f.snapshot(),before);assert.equal(p.rows.length,5);
 assert.deepEqual(p.rows.map(r=>r.state),['Replace','Replace','Create','Same','Same']);
 const backup=applyTemplatePlan(p);assert.ok(backup);
 assert.equal(readFileSync(join(f.root,backup,'.trellis/workflow.md'),'utf8'),'custom workflow');assert.equal(lstatSync(join(f.root,backup,'.trellis/workflow.md')).mode&0o777,0o640);
 assert.equal(readFileSync(join(f.root,backup,manifestPath),'utf8'),JSON.stringify(m));
 assert.ok(verifyRuntime(f.root));const after=f.snapshot();
 for(const [path,value] of Object.entries(before))if(!p.rows.some(r=>r.path===path)&&path!==manifestPath)assert.equal(after[path],value,path);
 const next=JSON.parse(readFileSync(join(f.root,manifestPath)));for(const row of p.rows)assert.deepEqual(next.templates[row.path],defaultTemplates()[row.path]);
 assert.deepEqual(next.files,m.files);assert.deepEqual(next.templates['.trellis/config.yaml'],m.templates['.trellis/config.yaml']);
 const ready=f.snapshot();assert.equal(applyTemplatePlan(templatePlan(f.root,'both')),undefined);assert.deepEqual(f.snapshot(),ready);
 assert.ok(!resourcePlan(f.root,'update').changes.some(c=>p.rows.some(r=>r.path===c.path)));
});
test('workflow/spec scopes preserve all unselected files, including custom documents',t=>{
 for(const scope of ['workflow','spec']){const f=fixture(t);f.put('.trellis/workflow.md','custom workflow');f.put('.trellis/spec/index.md','custom spec');
 const p=templatePlan(f.root,scope);assert.equal(p.rows.length,scope==='workflow'?1:4);applyTemplatePlan(p);
 assert.equal(readFileSync(join(f.root,scope==='workflow'?'.trellis/spec/index.md':'.trellis/workflow.md'),'utf8'),scope==='workflow'?'custom spec':'custom workflow');}
});
test('missing preserved workflow is explicitly restored by adoption, not safe update',t=>{
 const f=fixture(t),file=join(f.root,'.trellis/.pi-trellis.json'),m=JSON.parse(readFileSync(file));
 m.templates['.trellis/workflow.md']={origin:'preserved-project',sha256:null,mode:null,source:{kind:'project-snapshot',revision:null}};writeFileSync(file,JSON.stringify(m));rmSync(join(f.root,'.trellis/workflow.md'));
 assert.ok(!resourcePlan(f.root,'update').changes.some(c=>c.path==='.trellis/workflow.md'));
 const p=templatePlan(f.root,'workflow');assert.equal(p.rows[0].state,'Create');applyTemplatePlan(p);assert.ok(verifyRuntime(f.root));
 rmSync(join(f.root,'.trellis/workflow.md'));applyResourcePlan(resourcePlan(f.root,'update'));assert.ok(existsSync(join(f.root,'.trellis/workflow.md')));
});
test('changed selected file, Same file, manifest or forged plan refuses stale confirmation without writes',t=>{
 for(const route of ['change','same','manifest','forged']){const f=fixture(t);f.put('.trellis/workflow.md','old');const p=templatePlan(f.root,'both');
 if(route==='change')f.put('.trellis/workflow.md','concurrent');
 if(route==='same')f.put('.trellis/spec/guides/index.md','concurrent');
 if(route==='manifest')f.put('.trellis/.pi-trellis.json',JSON.stringify({...p.manifest,templates:{...p.manifest.templates,'.trellis/workflow.md':{origin:'preserved-project',sha256:null,mode:null,source:{kind:'project-snapshot',revision:null}}}}));
 if(route==='forged')p.changes[0].path='victim.txt';
 const before=f.snapshot();assert.throws(()=>applyTemplatePlan(p),/changed since template preview/);assert.deepEqual(f.snapshot(),before);}
});
test('unsupported/missing/modified runtime, unsafe scope, managed worktree and lock refuse application',t=>{
 for(const route of ['runtime','missing','release','scope','worktree','lock']){const f=fixture(t);f.put('.trellis/workflow.md','custom');
 const p=templatePlan(f.root,'workflow');
 if(route==='runtime')f.put('.trellis/scripts/task.py','custom');
 if(route==='missing')rmSync(join(f.root,'.trellis/scripts/task.py'));
 if(route==='release'){const m=JSON.parse(readFileSync(join(f.root,'.trellis/.pi-trellis.json')));m.runtimeReleaseId='pi-trellis-runtime-v1-'+'a'.repeat(64);f.put('.trellis/.pi-trellis.json',JSON.stringify(m));}
 if(route==='scope')p.scope='all';
 if(route==='worktree')f.put('.trellis/.runtime/pi-trellis/binding.json','{}');
 if(route==='lock')f.put('.trellis/.runtime/init.lock','owner');
 const before=f.snapshot();assert.throws(()=>applyTemplatePlan(p));assert.deepEqual(f.snapshot(),before);}
});
test('symlink document, backup ancestor and manifest reject without changing victims',t=>{
 for(const route of ['.trellis/workflow.md','.trellis/.runtime/template-backups','.trellis/.pi-trellis.json']){
 const f=fixture(t),outside=mkdtempSync(join(tmpdir(),'pi-template-victim-'));t.after(()=>rmSync(outside,{recursive:true,force:true}));
 f.put('.trellis/workflow.md','custom');const p=templatePlan(f.root,'workflow');
 if(route!=='.trellis/.runtime/template-backups')rmSync(join(f.root,route));
 const victim=join(outside,'victim');writeFileSync(victim,'victim');symlinkSync(route.endsWith('template-backups')?outside:victim,join(f.root,route));
 const before=f.snapshot();assert.throws(()=>applyTemplatePlan(p));assert.deepEqual(f.snapshot(),before);assert.equal(readFileSync(victim,'utf8'),'victim');assert.deepEqual(readdirSync(outside),['victim']);}
});
test('invalid initialization record after preview prevents writes and backup creation',t=>{
 const f=fixture(t);f.put('.trellis/workflow.md','custom');const p=templatePlan(f.root,'workflow');
 f.put('.trellis/.runtime/init-operation.json','{"status":"complete"}');const before=f.snapshot();
 assert.throws(()=>applyTemplatePlan(p),/initialization operation schema/);assert.deepEqual(f.snapshot(),before);
});
test('valid changed initialization record still invalidates preview',t=>{
 const f=fixture(t);f.put('.trellis/workflow.md','custom');const p=templatePlan(f.root,'workflow');
 const file='.trellis/.runtime/init-operation.json',op=JSON.parse(readFileSync(join(f.root,file)));op.completed=[];f.put(file,JSON.stringify(op));const before=f.snapshot();
 assert.throws(()=>applyTemplatePlan(p),/changed since template preview/);assert.deepEqual(f.snapshot(),before);
});
test('package template drift during publication preserves backups and original manifest',t=>{
 const f=fixture(t);f.put('.trellis/workflow.md','custom');const file=join(f.root,'.trellis/.pi-trellis.json'),m=JSON.parse(readFileSync(file));
 m.templates['.trellis/workflow.md']={origin:'preserved-project',sha256:digest('custom'),mode:0o644,source:{kind:'project-snapshot',revision:null}};writeFileSync(file,JSON.stringify(m));
 const original=readFileSync(file),p=templatePlan(f.root,'workflow');
 const template=join(packageRoot,'resources/templates/workflow.md'),baseline=join(packageRoot,'resources/template-baseline.json'),data=Buffer.from('changed package workflow');
 const metadata=JSON.parse(readFileSync(baseline));metadata.files['workflow.md'].sha256=digest(data);
 const realRead=fs.readFileSync;let changed=false,error;
 fs.readFileSync=(path,...args)=>{
  let value;if(changed && resolve(String(path))===template)value=data;
  if(changed && resolve(String(path))===baseline)value=Buffer.from(JSON.stringify(metadata));
  if(!value)return realRead(path,...args);
  const encoding=typeof args[0]==='string'?args[0]:args[0]?.encoding;
  return encoding?value.toString(encoding):value;
 };syncBuiltinESMExports();
 try{applyTemplatePlan(p,{afterWrite:()=>{changed=true;}});}catch(e){error=String(e);}finally{fs.readFileSync=realRead;syncBuiltinESMExports();}
 assert.match(error,/Project or package changed during template publication/);assert.deepEqual(readFileSync(file),original);
 const backup=error.split('Template backup: ')[1].split('. Partial')[0];assert.equal(readFileSync(join(f.root,backup,'.trellis/workflow.md'),'utf8'),'custom');
});
test('partial publication preserves complete backups and original manifest, without auto rollback',t=>{
 const f=fixture(t);f.put('.trellis/workflow.md','old workflow');f.put('.trellis/spec/index.md','old spec');const original=readFileSync(join(f.root,'.trellis/.pi-trellis.json'));
 let error;try{applyTemplatePlan(templatePlan(f.root,'both'),{afterWrite:()=>{throw Error('forced');}});}catch(e){error=String(e);}
 assert.match(error,/Template backup:/);const backup=error.split('Template backup: ')[1].split('. Partial')[0];
 assert.equal(readFileSync(join(f.root,backup,'.trellis/workflow.md'),'utf8'),'old workflow');assert.equal(readFileSync(join(f.root,backup,'.trellis/spec/index.md'),'utf8'),'old spec');
 assert.equal(readFileSync(join(f.root,'.trellis/spec/index.md'),'utf8'),'old spec');assert.deepEqual(readFileSync(join(f.root,'.trellis/.pi-trellis.json')),original);assert.ok(!existsSync(join(f.root,'.trellis/.runtime/init.lock')));
});
