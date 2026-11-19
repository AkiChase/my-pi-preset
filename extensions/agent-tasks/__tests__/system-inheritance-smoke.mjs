// Unshimmed installed SDK + production Pi loader/runner. All resources are isolated.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createAssistantMessageEventStream, getCurrentSystemMessage, getCurrentSystemPrompt, getSystemMessageText } from '@earendil-works/pi-ai';
import { createAgentSession, DefaultResourceLoader, ModelRuntime, SessionManager, SettingsManager } from '@earendil-works/pi-coding-agent';
const root = fileURLToPath(new URL('../../../', import.meta.url));
const box = process.cwd(), agentDir = process.env.PI_CODING_AGENT_DIR;
const projectMemory = join(box, '.pi/agent-memory/prefix-child');
mkdirSync(projectMemory, { recursive: true });
mkdirSync(join(box, '.pi/skills/full'), { recursive: true });
const memoryPath = join(projectMemory, 'MEMORY.md'), skillPath = join(box, '.pi/skills/full/SKILL.md');
writeFileSync(memoryPath, Array.from({ length: 201 }, (_, i) => `MEMORY_LINE_${i + 1}`).join('\n'));
writeFileSync(skillPath, '---\nname: full\ndescription: fixture\n---\nFULL_SKILL_BODY\nFULL_SKILL_END');
execFileSync('git', ['init', '-b', 'fixture-startup'], { cwd: box, stdio: 'ignore' });
const entry = join(box, 'probe.ts');
writeFileSync(entry, `
import { Type } from 'typebox';
import { mkdirSync, rmSync } from 'node:fs';
import { getCurrentSystemMessage, getSystemMessageText } from '@earendil-works/pi-ai';
import { runAgent, resumeAgent, shutdownChildSession, isChildSessionClosed } from ${JSON.stringify(join(root, 'extensions/agent-tasks/src/agent-runner.ts'))};
import { inheritAgentSystem } from ${JSON.stringify(join(root, 'extensions/agent-tasks/src/system-inheritance.ts'))};
import { registerAgents } from ${JSON.stringify(join(root, 'extensions/agent-tasks/src/agent-types.ts'))};
import { MEMORY_RULES } from ${JSON.stringify(join(root, 'extensions/memory/prompt.ts'))};
import { startupDetails } from ${JSON.stringify(join(root, 'extensions/shared/model-context/startup.ts'))};
export default function(pi) {
  let child, childFile, capturedPartial, mode = 'append';
  const ownedSessions = new Set();
  const report = { agreement: [], runs: [], refused: false, baseDiffers: false, cancelledClosed: false, saveFailureRollback: false };
  const configure = () => registerAgents(new Map([['prefix-child', { name: 'prefix-child', description: 'fixture',
    promptMode: mode === 'replace' ? 'replace' : 'append', systemPrompt: 'CHILD_ROLE_CONTRACT',
    builtinToolNames: ['read'], disallowedTools: ['write','edit'], memory: 'project', extensions: false,
    skills: ['full','missing','../unsafe'] }]]));
  pi.on('before_agent_start', event => {
    event.systemPromptOptions.sections['session-overview'] = 'Trellis-managed project. Snapshot taken when this session started;\\nPARENT_CLI_IDENTITY\\nPARENT_EXECUTION_ROOT';
    event.systemPromptOptions.sections['trellis-workflow'] = 'FULL_WORKFLOW_BODY';
    event.systemPromptOptions.sections['project_memory'] = MEMORY_RULES.replace('the startup snapshot contains metadata only and is not refreshed automatically', 'the index below contains metadata only') + '\\n\\n<!-- pi-project-memory: derived index; refresh to rebuild -->\\nMemories: 1; shown: 1.\\n- [topic](topic.md) (project): ORIGINAL_INDEX\\nOPAQUE_MEMORY_CONTRACT';
    event.systemPromptOptions.sections.third_party = 'OPAQUE_THIRD_PARTY_CONTRACT';
    if (event.prompt === 'root:forced') event.systemPromptOptions.forceSystemPrompt = 'FORCED_OPAQUE_CONTRACT';
  });
  pi.registerCommand('read-probe', { description: 'Fixture report', handler: (_args, ctx) => {
    report.baseDiffers = !Object.hasOwn(ctx.getSystemPromptOptions().sections, 'third_party');
    return report;
  }});
  pi.registerTool({ name: 'launch', label: 'launch', description: 'Offline child probe', parameters: Type.Object({ mode: Type.String() }),
    execute: async (_id, params, _signal, _update, ctx) => {
      mode = params.mode; configure();
      const current = getCurrentSystemMessage(ctx.sessionManager.getBranch().filter(e => e.type === 'message').map(e => e.message));
      report.agreement.push(getSystemMessageText(current) === ctx.getSystemPrompt());
      try {
        if (mode === 'live-resume') {
          await resumeAgent(child, 'child-resume');
        } else {
          if (mode === 'disk-resume') await shutdownChildSession(child);
          const controller = new AbortController();
          const result = await runAgent(ctx, 'prefix-child', 'child-task', { pi, isolated: mode === 'isolated', inheritContext: mode === 'context',
            signal: controller.signal, onSessionOwned: session => { ownedSessions.add(session); },
            onSessionCreated: session => {
              if (mode === 'cancelled') { capturedPartial = session; controller.abort(); }
              if (mode === 'save-failure') {
                capturedPartial = session;
                session.sessionManager.appendMessage({ role: 'user', content: 'fixture persistence seed', timestamp: 0 });
                rmSync(session.sessionFile); mkdirSync(session.sessionFile);
              }
            },
            ...(mode === 'disk-resume' ? { resumeSessionFile: childFile } : {}) });
          child = result.session; childFile = child.sessionFile;
        }
        report.runs.push({ mode, system: child.systemPrompt, file: childFile, branch: child.sessionManager.getBranch() });
      } catch (error) {
        if (mode === 'cancelled') {
          if (!String(error).includes('cancelled') || !isChildSessionClosed(capturedPartial)) throw error;
          report.cancelledClosed = true;
        } else if (mode === 'save-failure') {
          if (!String(error).includes('EISDIR') || !isChildSessionClosed(capturedPartial)) throw error;
          if (capturedPartial.sessionManager.getBranch().some(e => e.type === 'custom_message')) throw Error('failed append survived rollback');
          report.saveFailureRollback = true;
        } else {
          if (mode !== 'forced') throw error;
          assertUnsupported(String(error)); report.refused = true;
        }
      }
      return { content: [{ type: 'text', text: 'probe done' }], details: undefined };
    }
  });
  function assertUnsupported(message) { if (!message.includes('Unsupported parent system source')) throw Error(message); }
  pi.on('session_shutdown', async () => { for (const session of ownedSessions) await shutdownChildSession(session); registerAgents(new Map()); });
}
`);
const runtime = await ModelRuntime.create({ authPath: join(agentDir, 'auth.json'), modelsPath: null, modelsStorePath: join(agentDir, 'models-store.json'), refreshOnCreate: false, allowModelNetwork: false });
const requests = [];
const content = message => typeof message.content === 'string' ? message.content : (message.content ?? []).map(p => p.text ?? '').join('');
const usage = { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } };
runtime.registerProvider('prefix-fixture', { api: 'openai-responses', baseUrl: 'http://offline.invalid', apiKey: 'offline',
  models: [{ id: 'fixture', name: 'fixture', reasoning: false, input: ['text'], contextWindow: 400000, maxTokens: 8192, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } }],
  streamSimple: (_model, context) => {
    requests.push(structuredClone(context.messages));
    const latest = context.messages.at(-1), text = content(latest);
    const launch = latest.role === 'user' && text.startsWith('root:');
    const message = { role: 'assistant', api: 'openai-responses', provider: 'prefix-fixture', model: 'fixture', timestamp: Date.now(), usage,
      content: launch ? [{ type: 'toolCall', id: `launch-${requests.length}`, name: 'launch', arguments: { mode: text.slice(5) } }] : [{ type: 'text', text: 'done' }], stopReason: launch ? 'toolUse' : 'stop' };
    const stream = createAssistantMessageEventStream();
    queueMicrotask(() => { stream.push({ type: 'done', reason: launch ? 'toolUse' : 'stop', message }); stream.end(message); });
    return stream;
  }
});
const settings = SettingsManager.inMemory({ packages: [], extensions: [], skills: [], compaction: { enabled: false }, retry: { enabled: false } });
const loader = new DefaultResourceLoader({ cwd: box, agentDir, settingsManager: settings, noExtensions: false, additionalExtensionPaths: [entry], noSkills: true, noThemes: true, noPromptTemplates: true, noContextFiles: true, systemPrompt: 'PARENT_OPAQUE_PREAMBLE' });
await loader.reload();
assert.deepEqual(loader.getExtensions().errors, []);
const { session } = await createAgentSession({ cwd: box, agentDir, modelRuntime: runtime, model: runtime.getModel('prefix-fixture', 'fixture'), resourceLoader: loader, settingsManager: settings, sessionManager: SessionManager.create(box, join(box, 'sessions')), tools: ['launch'] });
const errors = [];
await session.bindExtensions({ onError: error => errors.push(error) });
session.setActiveToolsByName(['launch']);
try {
  for (const mode of ['append', 'live-resume', 'disk-resume', 'replace', 'isolated', 'context', 'cancelled', 'save-failure', 'forced']) {
    if (mode === 'live-resume') {
      writeFileSync(memoryPath, 'CHANGED_MEMORY_BODY'); writeFileSync(skillPath, 'CHANGED_SKILL_BODY');
      execFileSync('git', ['symbolic-ref', 'HEAD', 'refs/heads/changed-after-startup'], { cwd: box });
    }
    await session.prompt(`root:${mode}`);
    const last = session.messages.at(-1);
    assert.equal(last.stopReason, 'stop', JSON.stringify(last));
    const results = session.messages.filter(m => m.role === 'toolResult');
    assert.equal(results.at(-1).isError, false, content(results.at(-1)));
  }
  const report = await loader.getExtensions().extensions[0].commands.get('read-probe').handler('', session.extensionRunner.createCommandContext());
  assert.deepEqual(errors, []);
  assert.ok(report.agreement.slice(0, -1).every(Boolean), 'ordinary actual tool-run ctx agrees with replay');
  assert.equal(report.agreement.at(-1), false, 'forced effective text is not the structured replay');
  assert.equal(report.baseDiffers, true, 'public command options are base inputs, not latest effective sections');
  assert.equal(report.refused, true);
  assert.equal(report.cancelledClosed, true); assert.equal(report.saveFailureRollback, true);
  const [fresh, live, disk, replaced, isolated, inherited] = report.runs;
  const dataMarkers = /MEMORY_LINE_1|ORIGINAL_INDEX|FULL_SKILL_BODY|PARENT_CLI_IDENTITY|FULL_WORKFLOW_BODY|fixture-startup/;
  assert.doesNotMatch(fresh.system, dataMarkers);
  for (const marker of ['CHILD_ROLE_CONTRACT', 'OPAQUE_THIRD_PARTY_CONTRACT', 'OPAQUE_MEMORY_CONTRACT', 'Use project memory']) assert.ok(fresh.system.includes(marker), marker);
  const startup = fresh.branch.find(e => e.type === 'custom_message' && e.customType === 'agent-startup-context');
  assert.ok(startup && startup.display === false);
  for (const marker of ['Branch: fixture-startup', 'Platform:', 'MEMORY_LINE_200', 'FULL_SKILL_END', 'not found', 'path traversal']) assert.ok(startup.content.includes(marker), marker);
  assert.ok(!startup.content.includes('MEMORY_LINE_201'));
  assert.ok(fresh.branch.some(e => e.customType === 'agent-inherited-startup-context' && e.content.includes('PARENT_CLI_IDENTITY')));
  assert.ok(!fresh.branch.some(e => e.customType === 'trellis-task-state'), 'parent Trellis handled identity never transferred');
  const memory = fresh.branch.find(e => e.customType === 'project-memory-startup');
  assert.ok(memory.content.includes('ORIGINAL_INDEX'));
  for (const resumed of [live, disk]) {
    assert.equal(resumed.branch.filter(e => e.customType === 'agent-startup-context').length, 1);
    assert.equal(resumed.system, fresh.system);
    assert.ok(!JSON.stringify(resumed.branch).includes('CHANGED_MEMORY_BODY'));
    assert.ok(!JSON.stringify(resumed.branch).includes('CHANGED_SKILL_BODY'));
  }
  assert.doesNotMatch(replaced.system, /PARENT_OPAQUE_PREAMBLE|OPAQUE_THIRD_PARTY|OPAQUE_MEMORY/);
  assert.ok(!replaced.branch.some(e => e.customType === 'project-memory-startup' || e.customType === 'agent-inherited-startup-context'));
  const isolatedStartup = isolated.branch.find(e => e.customType === 'agent-startup-context');
  assert.doesNotMatch(isolatedStartup.content, /Preloaded Skill|CHANGED_SKILL_BODY/);
  assert.match(isolatedStartup.content, /# Environment|CHANGED_MEMORY_BODY/);
  assert.ok(inherited.branch.some(e => e.type === 'message' && e.message.role === 'user' && content(e.message).includes('# Parent Conversation Context')));
  const childRequests = requests.filter(r => getCurrentSystemPrompt(r).includes('<active_agent name="prefix-child"/>'));
  assert.equal(childRequests.length, 6, 'forced refusal makes no child request');
  assert.deepEqual(childRequests[1].slice(0, childRequests[0].length), childRequests[0], 'live continuation prefix stable');
  assert.deepEqual(childRequests[2].slice(0, childRequests[1].length), childRequests[1], 'disk resume prefix stable');
  writeFileSync(join(box, 'requests.json'), JSON.stringify(requests, null, 2));
  writeFileSync(join(box, 'report.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ requests: requests.length, childRequests: childRequests.length, agreement: true, forcedRefused: true, startupFull: true, resumePrefix: true, baseIsNotEffective: true, cancelledClosed: true, saveFailureRollback: true }));
} finally {
  await session.extensionRunner.emit({ type: 'session_shutdown', reason: 'quit' }); session.dispose();
}
