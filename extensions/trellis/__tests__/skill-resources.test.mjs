import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync, readdirSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import test from 'node:test';
import { DefaultPackageManager, SettingsManager } from '@earendil-works/pi-coding-agent';
import { adapterConfigured } from '../lib/adapter-resources.ts';
import { packageRoot, digest } from '../lib/initialization/engine.ts';
import { entryPath, presetRoot } from '../lib/paths.ts';

const expected=['trellis-before-dev','trellis-brainstorm','trellis-break-loop','trellis-check','trellis-finish-work','trellis-meta','trellis-spec-bootstrap','trellis-start','trellis-update-spec'].sort();
function fixture(t) {
 const base=mkdtempSync(join(tmpdir(),'pi resources ')),root=join(base,'project'),agentDir=join(base,'agent');mkdirSync(root);mkdirSync(agentDir);t.after(()=>rmSync(base,{recursive:true,force:true}));
 const put=(path,data)=>{mkdirSync(dirname(path),{recursive:true});writeFileSync(path,JSON.stringify(data));};
 return {base,root,agentDir,put};
}

test('nine curated package skills and complete bounded reference set have accurate hashes and no excluded commands/paths',()=>{
 // The preset manifest never declares Trellis skills: /trellis-init deploys them as project copies.
 const manifest=JSON.parse(readFileSync(join(presetRoot,'package.json')));assert.equal(Object.hasOwn(manifest.pi,'skills'),false);assert.deepEqual(readdirSync(join(packageRoot,'skills')).sort(),expected);
 const baseline=JSON.parse(readFileSync(join(packageRoot,'resources/skill-baseline.json')));assert.equal(Object.keys(baseline.files).length,35);assert.equal(Object.hasOwn(baseline.files,'trellis-continue/SKILL.md'),false);
 for(const [path,record] of Object.entries(baseline.files)){const text=readFileSync(join(packageRoot,'skills',path),'utf8');assert.equal(digest(text),record.sha256,path);assert.equal(record.license,'AGPL-3.0-only');assert.doesNotMatch(text,/\.agents\/|trellis (?:init|update|channel|mem)|trellis_subagent|--platform codex|src\/templates|\{\{[A-Z_]+\}\}/,path);
  for(const match of text.matchAll(/\]\((references\/[^)]+)\)/g)){assert.ok(existsSync(resolve(dirname(join(packageRoot,'skills',path)),match[1])),`${path}: ${match[1]}`);}
  if(path.endsWith('/SKILL.md')){assert.match(text,/^---\nname: [a-z0-9-]+\ndescription: .+\n/m);}
 }
 assert.equal(Object.keys(baseline.files).filter(p=>p.startsWith('trellis-meta/references/')).length,22);assert.equal(Object.keys(baseline.files).filter(p=>p.startsWith('trellis-spec-bootstrap/references/')).length,4);
});

test('real Pi package resource filters and autoload:false project delta govern adapter readiness without installing missing packages',async t=>{
 const f=fixture(t),old=process.env.PI_CODING_AGENT_DIR;process.env.PI_CODING_AGENT_DIR=f.agentDir;t.after(()=>{if(old===undefined)delete process.env.PI_CODING_AGENT_DIR;else process.env.PI_CODING_AGENT_DIR=old;});
 const user=join(f.agentDir,'settings.json'),project=join(f.root,'.pi/settings.json');f.put(user,{packages:[presetRoot]});assert.equal(await adapterConfigured(f.root),true);
 f.put(project,{packages:[{source:presetRoot,autoload:false,skills:[]}]});assert.equal(await adapterConfigured(f.root),true);
 const resources=await new DefaultPackageManager({cwd:f.root,agentDir:f.agentDir,settingsManager:SettingsManager.create(f.root,f.agentDir,{projectTrusted:true})}).resolve(async()=>{throw Error('must not install');});assert.ok(resources.extensions.some(r=>r.enabled&&r.path.endsWith('/extensions/trellis.ts')));assert.equal(resources.skills.filter(r=>r.enabled&&(r.metadata.packageRoot===presetRoot||r.path.startsWith(packageRoot))).length,0);
 f.put(project,{packages:[{source:presetRoot,autoload:false,extensions:[]}]});assert.equal(await adapterConfigured(f.root),true);
 f.put(project,{packages:[{source:presetRoot,autoload:false,extensions:['-extensions/trellis.ts']}]});assert.equal(await adapterConfigured(f.root),false);
 f.put(project,{packages:[{source:presetRoot,extensions:['+extensions/trellis.ts']}]});assert.equal(await adapterConfigured(f.root),true);
 f.put(project,{packages:[{source:presetRoot,extensions:['!extensions/trellis.ts']}]});assert.equal(await adapterConfigured(f.root),false);
 // Top-level overrides filter top-level/autodiscovered entries, not this package resource.
 f.put(project,{extensions:['-'+entryPath]});assert.equal(await adapterConfigured(f.root),true);
 f.put(project,{packages:[{source:presetRoot,extensions:[]}]});const untrusted=SettingsManager.create(f.root,f.agentDir,{projectTrusted:false});const paths=await new DefaultPackageManager({cwd:f.root,agentDir:f.agentDir,settingsManager:untrusted}).resolve(async()=> 'skip');assert.ok(paths.extensions.some(r=>r.enabled&&r.metadata.scope==='user'&&r.path.endsWith('/extensions/trellis.ts')));
 f.put(user,{});f.put(project,{packages:['npm:pi-trellis-does-not-exist@0.0.0']});assert.equal(await adapterConfigured(f.root),false);assert.equal(existsSync(join(f.agentDir,'npm/node_modules/pi-trellis-does-not-exist')),false);
});

test('built-in resource closure is self-contained, regular and baseline-complete without project-only dependency',()=>{
 const walk=(root,prefix='')=>readdirSync(root,{withFileTypes:true}).flatMap(e=>{assert.ok(e.isDirectory()||e.isFile(),`${prefix}${e.name} must be a regular file or directory`);return e.isDirectory()?walk(join(root,e.name),prefix+e.name+'/'):[prefix+e.name];});
 const listed={};for(const folder of ['runtime','resources/templates','skills','agents','licenses'])listed[folder]=walk(join(packageRoot,folder)).sort();
 assert.ok(!listed.skills.some(p=>p.startsWith('trellis-continue/')));
 assert.deepEqual(listed.runtime,Object.keys(JSON.parse(readFileSync(join(packageRoot,'resources/runtime-baseline.json'))).files).sort());
 assert.deepEqual(listed.skills,Object.keys(JSON.parse(readFileSync(join(packageRoot,'resources/skill-baseline.json'))).files).sort());
 assert.deepEqual(listed.agents,['trellis-check.md','trellis-implement.md','trellis-research.md']);
 assert.deepEqual(listed.licenses,['pi-trellis-MIT.txt','trellis-AGPL-3.0.txt']);
 assert.match(readFileSync(join(packageRoot,'licenses/pi-trellis-MIT.txt'),'utf8'),/^MIT License\n\nCopyright \(c\) 2026 pi-trellis contributors/);
 assert.deepEqual(listed['resources/templates'],Object.keys(JSON.parse(readFileSync(join(packageRoot,'resources/template-baseline.json'))).files).sort());
});
