// Test-only offline provider. Actual CLI agent loop and production tools/renderers remain untouched.
import { appendFileSync, readFileSync } from 'node:fs';
import { fauxProvider, fauxAssistantMessage, fauxToolCall } from '/Users/jyxc-dz-0101322/.pi/agent/install/releases/1.2.0/node_modules/@earendil-works/pi-ai/dist/providers/faux.js';
const root = process.env.BEAUTIFY_SMOKE_ROOT!;
const event = (kind: string, data: object = {}) => appendFileSync(root + '/events.jsonl', JSON.stringify({ time: Date.now(), kind, ...data }) + '\n');
const body = (m: any) => typeof m.content === 'string' ? m.content : (m.content || []).filter((b: any) => b.type === 'text').map((b: any) => b.text).join('\n');
export default function (pi: any) {
  let jobId = '', callSeq = 0;
  const held = new Map<string, (v: any) => void>();
  const faux = fauxProvider({ provider: 'beautify-offline', api: 'beautify-offline', models: [{ id: 'scripted', reasoning: false }] });
  const response = async (context: any, options: any) => {
    faux.appendResponses([response]);
    const last = context.messages.findLastIndex((m: any) => m.role === 'user');
    const prompt = body(context.messages[last] || {});
    const results = context.messages.slice(last + 1).filter((m: any) => m.role === 'toolResult');
    event('provider-request', { prompt, results: results.length, sessionId: options?.sessionId });
    if (prompt.includes('SMOKE_CHILD')) {
      if (!results.length) return fauxAssistantMessage([fauxToolCall('bash', { command: "printf 'CHILD_ACTUAL_BASH_OK\\n'" })], { stopReason: 'toolUse' });
      if (prompt.includes('HOLD')) return await new Promise(resolve => {
        const id = String(options?.sessionId || 'child');
        let done = false;
        const finish = (reason: string) => { if (done) return; done = true; held.delete(id); event('child-release', { id, reason }); resolve(fauxAssistantMessage(reason === 'abort' ? 'CHILD_ABORTED' : Array.from({length: 24}, (_, i) => 'CHILD_RESULT_' + (i + 1)).join('\n'))); };
        held.set(id, () => finish('release'));
        options?.signal?.addEventListener('abort', () => finish('abort'), {once: true});
        if (options?.signal?.aborted) finish('abort'); else event('child-held', { id });
      });
      return fauxAssistantMessage(Array.from({length: 24}, (_, i) => 'CHILD_RESULT_' + (i + 1)).join('\n'));
    }
    const name = prompt.match(/^CASE ([\w-]+)$/)?.[1];
    if (!name) return fauxAssistantMessage('OFFLINE_IDLE');
    if (results.length) return fauxAssistantMessage('CASE_DONE ' + name);
    const cases: Record<string, [string, object]> = {
      'ask-name': ['ask_user_question', { questions: [{ header: 'Name check', question: 'Choose acceptance option?', options: [{ label: 'Confirm', description: 'Confirm isolated title check' }, { label: 'Cancel', description: 'Do not confirm' }] }] }],
      read: ['read', { path: 'sample.ts', offset: 3, limit: 40 }],
      'read-error': ['read', { path: 'missing-file.ts' }],
      find: ['find', { pattern: '*.ts', path: 'files', limit: 100 }],
      grep: ['grep', { pattern: 'MARK', path: 'sample.ts', limit: 100 }],
      'find-error': ['find', { pattern: '*', path: 'missing-dir' }],
      'grep-error': ['grep', { pattern: '[', path: 'sample.ts' }],
      bash: ['bash', { command: "python3 -c \"print('\\\\n'.join('BASH_LINE_'+str(i) for i in range(30)));print('Job ID background job /tmp/pi-bg/example.log')\"", description: 'Ordinary keyword output' }],
      'bash-error': ['bash', { command: "python3 -c \"import sys;print('\\\\n'.join('ERROR_LINE_'+str(i) for i in range(30)));sys.exit(7)\"", description: 'Long error output' }],
      'bash-pending': ['bash', { command: `python3 ${root}/work.py pending`, description: 'Pending gate command', timeout: 60 }],
      'job-start': ['bash', { command: `python3 ${root}/work.py background`, description: 'Test background log', run_in_background: true }],
      'jobs-list': ['jobs', { action: 'list' }],
      'jobs-output': ['jobs', { action: 'output', jobId, offset: 0, limit: 150 }],
      'jobs-search': ['jobs', { action: 'search', jobId, pattern: 'JOB_LINE', context: 1 }],
      'jobs-stats': ['jobs', { action: 'stats' }],
      'jobs-attach': ['jobs', { action: 'attach', jobId, wait: true }],
      'jobs-kill': ['jobs', { action: 'kill', jobId }],
      'agent-start': ['Agent', { prompt: 'SMOKE_CHILD normal', description: 'Offline real child result', name: 'smoke-child', subagent_type: 'general-purpose', model: 'beautify-offline/scripted', isolated: true, run_in_background: true }],
      'agent-hold': ['Agent', { prompt: 'SMOKE_CHILD HOLD', description: 'Offline held child result', name: 'smoke-held', subagent_type: 'general-purpose', model: 'beautify-offline/scripted', isolated: true, run_in_background: true }],
      'agent-result': ['get_subagent_result', { agent_id: 'smoke-child', wait: true }],
      'agent-verbose': ['get_subagent_result', { agent_id: 'smoke-child', verbose: true }],
      'agent-running': ['get_subagent_result', { agent_id: 'smoke-held', wait: false }],
      'agent-wait': ['get_subagent_result', { agent_id: 'smoke-held', wait: true }],
      'agent-missing': ['get_subagent_result', { agent_id: 'no-such-agent' }],
    };
    const selected = cases[name];
    if (!selected) return fauxAssistantMessage('UNKNOWN_CASE ' + name);
    event('planned-call', { name, tool: selected[0], args: selected[1] });
    return fauxAssistantMessage([fauxToolCall(selected[0], selected[1], { id: 'smoke-' + (++callSeq) })], { stopReason: 'toolUse' });
  };
  faux.setResponses([response]); pi.registerProvider(faux.provider);
  pi.on('tool_result', (e: any) => {
    event('tool-result', e);
    const raw = (e.content || []).filter((b: any) => b.type === 'text').map((b: any) => b.text).join('\n');
    const match = raw.match(/^Command running in background with ID: (\S+)\. Output/);
    if (match) { jobId = match[1]; event('job-id', { jobId }); }
  });
  pi.on('tool_execution_start', (e: any) => event('execution-start', e));
  pi.on('tool_execution_update', (e: any) => event('execution-update', e));
  pi.on('tool_execution_end', (e: any) => event('execution-end', e));
  pi.on('agent_end', () => event('agent-end'));
  pi.on('session_start', (_: any, ctx: any) => {
    event('session-start', { cwd: ctx.cwd, mode: ctx.mode, model: ctx.model?.id });
    ctx.ui.onTerminalInput((data: string) => { event('terminal-input', { data }); });
    ctx.ui.notify('SMOKE_READY', 'info');
  });
  pi.registerCommand('smoke-release-child', {description:'Test-only release scripted child', handler: async () => { for (const resolve of held.values()) resolve(null); }});
  pi.registerCommand('smoke-observe', {description:'Read-only public transcript observation', handler: async (_: string, ctx: any) => {event('observe', {entries: ctx.sessionManager.getBranch(), editor: ctx.ui.getEditorText()});}});
  pi.on('session_shutdown', (e: any) => {event('session-shutdown', e); for (const resolve of held.values()) resolve(null);});
}
