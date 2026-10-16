import assert from 'node:assert/strict';
import { unlinkSync, writeFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { verifyRuntime, digest } from '../lib/initialization/engine.ts';
import { resourcePlan, applyResourcePlan, resourceStatus } from '../lib/initialization/resources.ts';
import { copyRuntimeFixture } from './runtime-fixture.mjs';
function fixture(t){return copyRuntimeFixture(t,{user:'Dev'});}
test('resource status describes files and repair restores missing runtime without changing history',t=>{
 const root=fixture(t),identity=readFileSync(join(root,'.trellis/.developer')),history=readFileSync(join(root,'.trellis/workspace/Dev/index.md'));
 unlinkSync(join(root,'.trellis/scripts/task.py'));
 assert.match(resourceStatus(root),/Missing — will restore: .trellis\/scripts\/task.py/);
 applyResourcePlan(resourcePlan(root,'repair'));assert.ok(verifyRuntime(root));
 assert.deepEqual(readFileSync(join(root,'.trellis/.developer')),identity);assert.deepEqual(readFileSync(join(root,'.trellis/workspace/Dev/index.md')),history);
});
test('modified executable conflicts and custom template preserved while missing default template repaired',t=>{
 const root=fixture(t);writeFileSync(join(root,'.trellis/scripts/task.py'),'custom');
 assert.throws(()=>applyResourcePlan(resourcePlan(root,'update')),/Modified/);assert.equal(readFileSync(join(root,'.trellis/scripts/task.py'),'utf8'),'custom');
});
test('update safely refreshes recorded old bytes and preserves custom documents',t=>{
 const root=fixture(t),file=join(root,'.trellis/.pi-trellis.json');const m=JSON.parse(readFileSync(file));
 const path='.trellis/scripts/get_developer.py';writeFileSync(join(root,path),'old recorded version');
 m.files[path].sha256=digest('old recorded version');m.runtimeReleaseId='pi-trellis-runtime-v1-'+'a'.repeat(64);writeFileSync(file,JSON.stringify(m));
 writeFileSync(join(root,'.trellis/workflow.md'),'custom workflow');
 const p=resourcePlan(root,'update');assert.ok(p.changes.some(c=>c.path===path));applyResourcePlan(p);
 assert.ok(verifyRuntime(root));assert.equal(readFileSync(join(root,'.trellis/workflow.md'),'utf8'),'custom workflow');
});
test('older manifest lacking package-added files restores them; unknown or current-release gaps stay unsupported',t=>{
 const root=fixture(t),file=join(root,'.trellis/.pi-trellis.json'),original=readFileSync(file),added='.trellis/scripts/diagnostics.py';
 const m=JSON.parse(original);delete m.files[added];unlinkSync(join(root,added));writeFileSync(file,JSON.stringify(m));
 assert.throws(()=>resourcePlan(root,'update'),/Unsupported resource inventory/);
 m.runtimeReleaseId='pi-trellis-runtime-v1-'+'a'.repeat(64);writeFileSync(file,JSON.stringify(m));
 const p=resourcePlan(root,'update');assert.deepEqual(p.report.conflicts,[]);assert.ok(p.report.rows.some(r=>r.path===added&&r.state==='Missing — will restore'));
 applyResourcePlan(p);assert.ok(verifyRuntime(root));assert.ok(JSON.parse(readFileSync(file)).files[added]);
 writeFileSync(join(root,added),'untracked');const n=JSON.parse(readFileSync(file));delete n.files[added];n.runtimeReleaseId='pi-trellis-runtime-v1-'+'a'.repeat(64);writeFileSync(file,JSON.stringify(n));
 assert.ok(resourcePlan(root,'update').report.conflicts.includes(added));
 n.files['.trellis/scripts/unknown.py']=n.files['.trellis/scripts/task.py'];writeFileSync(file,JSON.stringify(n));
 assert.throws(()=>resourcePlan(root,'update'),/Unsupported resource inventory/);
});
