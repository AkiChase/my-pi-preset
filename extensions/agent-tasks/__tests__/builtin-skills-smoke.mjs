// Real Pi host-loader/session resource path; only prompt/provider work is replaced.
import assert from "node:assert/strict";
import { cpSync, mkdirSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createAgentSession, DefaultResourceLoader, ModelRuntime, SessionManager, SettingsManager } from "@earendil-works/pi-coding-agent";

const { buildSystemPrompt } = await import(pathToFileURL(join(dirname(fileURLToPath(import.meta.resolve('@earendil-works/pi-coding-agent'))), 'core/system-prompt.js')).href);
const longMarkers = [/opts\?:/, /DEFAULT TO pipeline/, /const DIMENSIONS/, /const seen = new Set/, /budget\.remaining/, /100% cache hit/];
const counts = text => ({ chars: text.length, nonblankLines: text.split('\n').filter(line => line.trim()).length });
let indexCounts;
const root = fileURLToPath(new URL("../../../", import.meta.url));
const box = process.cwd();
const agentDir = process.env.PI_CODING_AGENT_DIR;
const runtime = await ModelRuntime.create({ authPath: join(agentDir, "auth.json"), modelsPath: null, modelsStorePath: join(agentDir, "models-store.json"), refreshOnCreate: false, allowModelNetwork: false });
const entry = join(box, "probe.ts");
writeFileSync(entry, `
import agentTasks, { runInChildSessionContext } from ${JSON.stringify(join(root, "extensions/agent-tasks/src/index.ts"))};
import { runAgent, shutdownChildSession } from ${JSON.stringify(join(root, "extensions/agent-tasks/src/agent-runner.ts"))};
import { registerAgents } from ${JSON.stringify(join(root, "extensions/agent-tasks/src/agent-types.ts"))};
import { createAgentSession } from "@earendil-works/pi-coding-agent";
export default function(pi) {
  agentTasks(pi);
  pi.registerCommand("child-resource-probe", { description: "Offline child probe", handler: async (_args, ctx) => {
    registerAgents(new Map([['resource-child', { name: 'resource-child', description: 'offline', extensions: ctx.extensions,
      excludeExtensions: ctx.excludeExtensions, skills: ctx.skills, builtinToolNames: ['read'],
      disallowedTools: ['subagent_run', 'subagent_workflow', 'subagent_message', 'agent_manage'],
      persistSession: false, systemPrompt: 'CHILD_ONLY', promptMode: 'replace' }]]));
    let loader;
    const result = await runAgent(ctx, 'resource-child', 'offline', { pi, isolated: ctx.isolated, nested: true }, {
      detectEnv: async () => ({ isGitRepo: false, platform: 'offline' }),
      createResourceLoader: opts => { loader = ctx.makeLoader(opts); return loader; },
      createAgentSession: async opts => {
        const created = await createAgentSession({ ...opts, modelRuntime: ctx.runtime });
        created.session.prompt = async () => {};
        return created;
      }
    });
    const report = { skills: loader.getSkills(), tools: result.session.getActiveToolNames(), prompt: result.session.systemPrompt,
      extensions: loader.getExtensions().extensions.map(e => ({ tools: [...e.tools.keys()], commands: [...e.commands.keys()], events: [...e.handlers.keys()] })) };
    await shutdownChildSession(result.session);
    return report;
  }});
  pi.registerCommand("load-child-factory", { description: "Offline factory guard", handler: async (_args, ctx) => runInChildSessionContext(ctx.load) });
}
`);
const settingsManager = SettingsManager.inMemory({ packages: [], extensions: [], skills: [] });
const makeLoader = (options = {}) => new DefaultResourceLoader({ cwd: box, agentDir, settingsManager, noPromptTemplates: true, noThemes: true, noContextFiles: true, ...options, additionalExtensionPaths: options.noExtensions ? [] : (options.additionalExtensionPaths ?? [entry]) });
async function open(options = {}) {
  const loader = makeLoader(options);
  await loader.reload();
  assert.deepEqual(loader.getExtensions().errors, []);
  const { session } = await createAgentSession({ cwd: box, agentDir, settingsManager, resourceLoader: loader, modelRuntime: runtime, sessionManager: SessionManager.inMemory(box), tools: ['read'] });
  const errors = [];
  await session.bindExtensions({ onError: error => errors.push(error) });
  assert.deepEqual(errors, []);
  return { loader, session };
}
const { loader, session } = await open({ noSkills: true });
const shutdown = async session => {
  await session.extensionRunner.emit({ type: 'session_shutdown', reason: 'quit' });
  session.dispose();
};
function assertSkill(loader, expectedRoot = root) {
  const { skills, diagnostics } = loader.getSkills();
  assert.deepEqual(diagnostics, []);
  const skill = skills.find(s => s.name === 'subagents');
  assert.ok(skill);
  assert.equal(skill.filePath, join(expectedRoot, 'extensions/agent-tasks/skills/subagents/SKILL.md'));
  assert.ok(isAbsolute(skill.filePath));
  assert.equal(skill.baseDir, dirname(skill.filePath));
  assert.equal(Object.hasOwn(skill, 'content'), false, 'SDK retains metadata, not body');
  const body = readFileSync(skill.filePath, 'utf8');
  for (const match of body.matchAll(/\]\((references\/[^)]+)\)/g)) {
    const reference = readFileSync(join(skill.baseDir, match[1]), 'utf8');
    assert.ok(reference.length > 1000);
    assert.doesNotMatch(reference, /[\u4e00-\u9fff]/);
  }
  return skill;
}
try {
  assertSkill(loader);
  assert.match(session.systemPrompt, /<name>subagents<\/name>/);
  assert.doesNotMatch(session.systemPrompt, /# Delegation and coordination|# Workflow API|# Orchestration patterns/);
  // Read body only via the actual permitted SDK read tool.
  const skill = assertSkill(loader);
  const entryText = readFileSync(skill.filePath, 'utf8');
  const referenceTexts = Object.fromEntries(['delegation', 'workflow-api', 'patterns'].map(name => [name, readFileSync(join(skill.baseDir, `references/${name}.md`), 'utf8')]));
  for (const marker of longMarkers) assert.doesNotMatch(entryText, marker, 'entry is routing, not tutorial');
  for (const hook of ['### agent', '### pipeline', '### parallel', '### log and phase', '### args', '### budget', '### workflow', '## Replay', '## Runtime boundaries']) assert.ok(referenceTexts['workflow-api'].includes(hook), hook);
  for (const option of ['label?', 'phase?', 'schema?', 'model?', 'effort?', 'isolation?', 'agentType?', 'gate?', 'resume?']) assert.ok(referenceTexts['workflow-api'].includes(option), option);
  for (const pattern of ['find-flaky-tests', 'PURE LITERAL', 'StructuredOutput', 'JSON.parse', '4096', '1000', 'max(1, min(16', 'child session settings/defaults', 'Explicit model takes precedence', 'Explicit effort takes precedence', 'eval and Function', 'workflow.jsonl']) assert.ok(referenceTexts['workflow-api'].includes(pattern), pattern);
  for (const example of ['const DIMENSIONS', 'dedupeByFileAndLine', 'while (bugs.length < 10)', "resume: 'fix'", 'const seen = new Set', 'dry < 2', "['correctness','security','repro']", 'Default to refuted=true', 'Judge panel', 'Multi-modal sweep', 'Completeness critic', 'No silent caps']) assert.ok(referenceTexts.patterns.includes(example), example);
  const indexPrompt = buildSystemPrompt({ cwd: box, selectedTools: ['read'], skills: [skill] });
  const index = indexPrompt.slice(indexPrompt.indexOf('<available_skills>'), indexPrompt.indexOf('</available_skills>') + '</available_skills>'.length);
  assert.match(index, /<name>subagents<\/name>/);
  for (const marker of longMarkers) assert.doesNotMatch(index, marker);
  indexCounts = counts(index);
  assert.doesNotMatch(buildSystemPrompt({ cwd: box, selectedTools: ['subagent_run'], skills: [skill] }), /<name>subagents<\/name>/);
  const disabled = { ...skill, disableModelInvocation: true };
  assert.doesNotMatch(buildSystemPrompt({ cwd: box, selectedTools: ['read'], skills: [disabled] }), /<name>subagents<\/name>/);
  const hiddenReader = buildSystemPrompt({ cwd: box, selectedTools: ['read'], hiddenTools: ['read'], skills: [skill] });
  assert.match(hiddenReader, /<name>subagents<\/name>/, 'permitted hidden reader keeps native index');
  const read = session.agent.state.tools.find(t => t.name === 'read');
  const result = await read.execute('read-manual', { path: skill.filePath });
  assert.match(result.content[0].text, /# Subagents/);
  assert.match(result.content[0].text, /references\/workflow-api.md/);
  const referenceResult = await read.execute('read-reference', { path: join(skill.baseDir, 'references/delegation.md') });
  assert.match(referenceResult.content[0].text, /# Delegation and coordination/);
  for (const name of ['workflow-api', 'patterns']) {
    const response = await read.execute(`read-${name}`, { path: join(skill.baseDir, `references/${name}.md`) });
    assert.ok(response.content[0].text.includes(referenceTexts[name].split('\n')[0]));
  }
  session.setActiveToolsByName([]);
  assert.doesNotMatch(session.systemPrompt, /<name>subagents<\/name>/, 'no reader means no skill index');
  session.setActiveToolsByName(['read']);
  assert.match(session.systemPrompt, /<name>subagents<\/name>/);
  const discovered = await session.extensionRunner.emitResourcesDiscover(box, 'startup');
  assert.equal(discovered.skillPaths[0].path, skill.filePath);
  await session.reload();
  assertSkill(loader);
  assert.equal((await session.extensionRunner.emitResourcesDiscover(box, 'reload')).skillPaths[0].path, skill.filePath);
  const ext = loader.getExtensions().extensions[0];
  const childProbe = ext.commands.get('child-resource-probe').handler;
  for (const policy of [
    { skills: true, extensions: true, present: true },
    { skills: false, extensions: true, present: true },
    { skills: ['unavailable-ordinary-skill'], extensions: true, present: true },
    { skills: true, extensions: [entry], present: true },
    { skills: true, extensions: false, present: false },
    { skills: true, extensions: true, excludeExtensions: ['probe'], present: false },
    { skills: true, extensions: true, isolated: true, present: false },
  ]) {
    const report = await childProbe('', { cwd: box, getSystemPrompt: () => 'PARENT', modelRegistry: { runtime },
      runtime, makeLoader, ...policy });
    assert.equal(report.skills.skills.some(s => s.name === 'subagents'), policy.present, JSON.stringify({ policy, skills: report.skills.skills.map(s => s.name), extensions: report.extensions }));
    assert.deepEqual(report.tools, ['read'], 'manual never enables delegation or management tools');
    for (const child of report.extensions) {
      assert.deepEqual(child.tools, []);
      assert.equal(child.commands.includes('agents'), false);
      assert.equal(child.events.includes('input'), false);
      assert.equal(child.events.includes('resources_discover'), true);
    }
  }
  const absent = await open({ noExtensions: true, noSkills: true });
  try {
    assert.deepEqual(absent.loader.getSkills().skills, []);
    assert.doesNotMatch(absent.session.systemPrompt, /<name>subagents<\/name>/);
  } finally { await shutdown(absent.session); }
  // Ordinary package skill filtering is likewise intentionally independent.
  const packageDir = join(box, 'package');
  mkdirSync(packageDir);
  writeFileSync(join(packageDir, 'package.json'), JSON.stringify({ name: 'fixture', pi: { extensions: ['entry.ts'], skills: [] } }));
  writeFileSync(join(packageDir, 'entry.ts'), `export { default } from ${JSON.stringify(join(root, 'extensions/agent-tasks/src/index.ts'))};`);
  const packaged = await open({ additionalExtensionPaths: [], settingsManager: SettingsManager.inMemory({ packages: [{ source: packageDir, skills: [] }] }) });
  try { assertSkill(packaged.loader); } finally { await shutdown(packaged.session); }
  // Native first-wins conflict diagnostic: no forced override of an ordinary same-name skill.
  const collision = join(box, 'collision.md');
  writeFileSync(collision, '---\nname: subagents\ndescription: User-owned collision\n---\nUSER_BODY');
  const colliding = await open({ noSkills: true, additionalSkillPaths: [collision] });
  try {
    assert.equal(colliding.loader.getSkills().skills.find(s => s.name === 'subagents').filePath, collision);
    assert.ok(colliding.loader.getSkills().diagnostics.some(d => d.type === 'collision'));
  } finally { await shutdown(colliding.session); }
  // Missing resource is not a loaded manual (native loader owns the diagnostic).
  const missing = makeLoader({ noExtensions: true, noSkills: true });
  await missing.reload();
  missing.extendResources({ skillPaths: [{ path: join(box, 'missing', 'SKILL.md'), metadata: { source: 'fixture', scope: 'temporary', origin: 'top-level' } }] });
  assert.deepEqual(missing.getSkills().skills, []);
  // Move the production module tree, not a rewritten path expression, through the real host loader.
  const movedRoot = join(box, 'moved');
  mkdirSync(movedRoot);
  cpSync(join(root, 'extensions'), join(movedRoot, 'extensions'), { recursive: true, filter: path => !path.includes('__tests__') });
  symlinkSync(join(root, 'node_modules'), join(movedRoot, 'node_modules'), 'dir');
  const movedEntry = join(movedRoot, 'entry.ts');
  writeFileSync(movedEntry, `export { default } from './extensions/agent-tasks/src/index.ts';`);
  const moved = await open({ noSkills: true, additionalExtensionPaths: [movedEntry] });
  try { assertSkill(moved.loader, movedRoot); } finally { await shutdown(moved.session); }
  console.log(JSON.stringify({ startup: true, reload: true, childPolicies: 7, noSkills: true, packageFilter: true, collision: true, missing: true, moved: true, nativeRead: true, referenceCoverage: true, readerGates: true, indexCounts }));
} finally { await shutdown(session); }
