import './host-env.mjs';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync, realpathSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import test from 'node:test';
import { __internals } from '../index.ts';

const { renderOverview } = __internals;
function fixture(t) {
 const root=realpathSync(mkdtempSync(join(tmpdir(),'pi protocol space ')));t.after(()=>rmSync(root,{recursive:true,force:true}));
 return root;
}
const managementLines=text=>text.split('\n').filter(l=>/^(Worktree management|Dispatch\/stop|Never use temporary|Before the first managed)/.test(l));

test('main overview offers four worktree lines and a readable bundled protocol path',t=>{
 const root=fixture(t);mkdirSync(join(root,'.trellis/scripts'),{recursive:true});writeFileSync(join(root,'.trellis/scripts/worktree.py'),'# deployed');
 const text=renderOverview(root,'key',{});
 assert.match(text,/Before the first managed operation, read protocol: .*protocol\/worktree-execution.md/);
 // The model-facing protocol path is a bundled product file, not a user document that may be absent.
 const protocol=/read protocol: (.*)$/m.exec(text)[1];assert.ok(existsSync(protocol),protocol);assert.match(readFileSync(protocol,'utf8'),/^# 托管 worktree 执行/);
 assert.equal(managementLines(text).length,4);assert.match(text,/Worktree management: python3 \.trellis\/scripts\/worktree\.py/);assert.ok(!text.includes('Trellis material revision'));
 const missing=renderOverview(root,'key',{},undefined,join(root,'missing protocol.md'));assert.match(missing,/protocol missing/);assert.doesNotMatch(missing,/automatically install/);
 rmSync(join(root,'.trellis/scripts/worktree.py'));assert.match(renderOverview(root,'key',{}),/Worktree CLI not deployed .*explicit install\/update required/);
});

test('role overview carries execution-role reading rules without worktree management or protocol lines',t=>{
 const root=fixture(t),target=join(root,'target');
 for(const role of ['trellis-implement','trellis-check']){
  const child=renderOverview(root,'child',{},role,undefined,target);
  assert.match(child,new RegExp(`Task execution role: ${role}`));assert.equal(managementLines(child).length,0);assert.doesNotMatch(child,/read protocol:/);
  assert.match(child,new RegExp(`Project root \\(source materials/CLI\\): ${root}\\n`));assert.match(child,new RegExp(`Execution root \\(product code/tests\\): ${target}\\n`));
  assert.match(child,/fully read source task artifacts, workflow, role JSONL and selected references/);
  assert.match(child,/paginate truncated reads/);assert.match(child,/not a complete-injection\/read proof/);
 }
});
