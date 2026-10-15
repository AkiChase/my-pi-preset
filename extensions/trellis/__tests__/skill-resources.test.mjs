import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync, readdirSync, existsSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import test from 'node:test';
import { DefaultPackageManager, SettingsManager } from '@earendil-works/pi-coding-agent';
import { adapterConfigured, projectSkillPaths } from '../lib/adapter-resources.ts';
import { packageRoot, digest } from '../lib/initialization/engine.ts';
import { entryPath, presetRoot } from '../lib/paths.ts';

const expected=['trellis-before-dev','trellis-brainstorm','trellis-break-loop','trellis-check','trellis-finish-work','trellis-meta','trellis-spec-bootstrap','trellis-start','trellis-update-spec'].sort();
function fixture(t) {
 const base=mkdtempSync(join(tmpdir(),'pi resources ')),root=join(base,'project'),agentDir=join(base,'agent');mkdirSync(root);mkdirSync(agentDir);t.after(()=>rmSync(base,{recursive:true,force:true}));
 const put=(path,data)=>{mkdirSync(dirname(path),{recursive:true});writeFileSync(path,JSON.stringify(data));};
 return {base,root,agentDir,put};
}

test('nine curated package skills and complete bounded reference set have accurate hashes and no excluded commands/paths',()=>{
 // The preset manifest never declares Trellis skills statically; they stay conditional project resources.
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
 const resources=await new DefaultPackageManager({cwd:f.root,agentDir:f.agentDir,settingsManager:SettingsManager.create(f.root,f.agentDir,{projectTrusted:true})}).resolve(async()=>{throw Error('must not install');});assert.ok(resources.extensions.some(r=>r.enabled&&r.path.endsWith('/extensions/trellis.ts')));assert.equal(resources.skills.filter(r=>r.enabled&&(r.metadata.packageRoot===presetRoot||r.path.startsWith(packageRoot))).length,0);assert.equal((await projectSkillPaths(f.root,true,f.agentDir)).length,9);
 f.put(project,{packages:[{source:presetRoot,autoload:false,extensions:[]}]});assert.equal(await adapterConfigured(f.root),true);
 f.put(project,{packages:[{source:presetRoot,autoload:false,extensions:['-extensions/trellis.ts']}]});assert.equal(await adapterConfigured(f.root),false);
 f.put(project,{packages:[{source:presetRoot,extensions:['+extensions/trellis.ts']}]});assert.equal(await adapterConfigured(f.root),true);
 f.put(project,{packages:[{source:presetRoot,extensions:['!extensions/trellis.ts']}]});assert.equal(await adapterConfigured(f.root),false);
 // Top-level overrides filter top-level/autodiscovered entries, not this package resource.
 f.put(project,{extensions:['-'+entryPath]});assert.equal(await adapterConfigured(f.root),true);
 f.put(project,{packages:[{source:presetRoot,extensions:[]}]});const untrusted=SettingsManager.create(f.root,f.agentDir,{projectTrusted:false});const paths=await new DefaultPackageManager({cwd:f.root,agentDir:f.agentDir,settingsManager:untrusted}).resolve(async()=> 'skip');assert.ok(paths.extensions.some(r=>r.enabled&&r.metadata.scope==='user'&&r.path.endsWith('/extensions/trellis.ts')));
 f.put(user,{});f.put(project,{packages:['npm:pi-trellis-does-not-exist@0.0.0']});assert.equal(await adapterConfigured(f.root),false);assert.equal(existsSync(join(f.agentDir,'npm/node_modules/pi-trellis-does-not-exist')),false);
});

test('conditional defaults select installed package identity and scope, never a different same-spelling local package',async t=>{
 const f=fixture(t),source='package',other=join(f.root,'.pi',source);mkdirSync(other,{recursive:true});symlinkSync(presetRoot,join(f.agentDir,source),'dir');
 f.put(join(other,'package.json'),{name:'unrelated-package',pi:{skills:[]}});
 f.put(join(f.agentDir,'settings.json'),{packages:[source]});f.put(join(f.root,'.pi/settings.json'),{packages:[source]});
 const user=readFileSync(join(f.agentDir,'settings.json')),project=readFileSync(join(f.root,'.pi/settings.json'));
 let virtual;const fromStorage=SettingsManager.fromStorage;
 t.mock.method(SettingsManager,'fromStorage',function(...args){const result=fromStorage.apply(this,args);virtual=result;return result;});
 assert.equal((await projectSkillPaths(f.root,true,f.agentDir)).length,9);
 // Own declarations are rebased onto the Trellis resource root; other packages are not resolved.
 assert.deepEqual(virtual.getGlobalSettings().packages,[{source:packageRoot,skills:['skills/**/SKILL.md']}]);
 assert.deepEqual(virtual.getProjectSettings().packages,[]);
 assert.deepEqual(readFileSync(join(f.agentDir,'settings.json')),user);assert.deepEqual(readFileSync(join(f.root,'.pi/settings.json')),project);
});

for(const source of ['npm:my-pi-preset@0.1.0','git:github.com/AkiChase/my-pi-preset@main'])test(`public installedPath identity preserves filters for ${source} without installing`,async t=>{
 const f=fixture(t);f.put(join(f.agentDir,'settings.json'),{packages:[{source,skills:['extensions/trellis/skills/trellis-check/SKILL.md']}]});
 const installed=source.startsWith('npm:')?join(f.agentDir,'npm/node_modules/my-pi-preset'):join(f.agentDir,'git/github.com/AkiChase/my-pi-preset');mkdirSync(dirname(installed),{recursive:true});symlinkSync(presetRoot,installed,'dir');
 const manager=new DefaultPackageManager({cwd:f.root,agentDir:f.agentDir,settingsManager:SettingsManager.create(f.root,f.agentDir,{projectTrusted:true})});assert.equal(manager.listConfiguredPackages()[0].installedPath,installed);
 const paths=await projectSkillPaths(f.root,true,f.agentDir);assert.equal(paths.length,1);assert.ok(paths[0].endsWith('/trellis-check/SKILL.md'));
 f.put(join(f.agentDir,'settings.json'),{packages:[source]});assert.equal((await projectSkillPaths(f.root,true,f.agentDir)).length,9);
});

test('transitional conditional discovery rebases native default/empty/delta/whitelist/additive/trust filters of this preset',async t=>{
 const f=fixture(t),project=join(f.root,'.pi/settings.json'),skill='extensions/trellis/skills/trellis-check/SKILL.md';f.put(join(f.agentDir,'settings.json'),{packages:[presetRoot]});
 const cases=[[{source:presetRoot,skills:[]},0],[{source:presetRoot,autoload:false,skills:[]},9],[{source:presetRoot,autoload:false,skills:['-'+skill]},8],[{source:presetRoot,skills:[skill]},1],[{source:presetRoot,skills:['./'+skill]},1],[{source:presetRoot,skills:['+'+skill]},9],[{source:presetRoot,skills:['skills/trellis-check/SKILL.md']},0],[{source:presetRoot,extensions:['-extensions/memory.ts']},9]];
 for(const [entry,n] of cases){f.put(project,{packages:[entry]});const before=readFileSync(project);assert.equal((await projectSkillPaths(f.root,true,f.agentDir)).length,n,JSON.stringify(entry));assert.deepEqual(readFileSync(project),before);}
 f.put(project,{packages:[{source:presetRoot,skills:[]}]});assert.equal((await projectSkillPaths(f.root,false,f.agentDir)).length,9);
});

test('invalid settings fail discovery without overwriting bytes or installing',async t=>{
 const f=fixture(t),path=join(f.agentDir,'settings.json');writeFileSync(path,'{ broken');
 await assert.rejects(projectSkillPaths(f.root,true,f.agentDir),/settings are unreadable or invalid/);assert.equal(readFileSync(path,'utf8'),'{ broken');assert.equal(existsSync(join(f.agentDir,'npm')),false);
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
