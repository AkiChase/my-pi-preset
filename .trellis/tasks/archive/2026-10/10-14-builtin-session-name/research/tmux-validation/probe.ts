// Offline native provider and read-only public observations. Test-only; no product mutation.
import { appendFileSync, readFileSync } from 'node:fs';
import type { ExtensionAPI } from '/Users/jyxc-dz-0101322/.pi/agent/install/releases/1.2.0/node_modules/@earendil-works/pi-coding-agent/dist/index.js';
import { fauxProvider, fauxAssistantMessage } from '/Users/jyxc-dz-0101322/.pi/agent/install/releases/1.2.0/node_modules/@earendil-works/pi-ai/dist/providers/faux.js';
import { getCurrentSystemPrompt } from '/Users/jyxc-dz-0101322/.pi/agent/install/releases/1.2.0/node_modules/@earendil-works/pi-ai/dist/utils/transcript.js';
const root = process.env.NAME_TMUX_ROOT!;
const log = (kind: string, data: object = {}) => appendFileSync(root + '/events.jsonl', JSON.stringify({ time: Date.now(), kind, ...data }) + '\n');
const control = () => JSON.parse(readFileSync(root + '/control.json', 'utf8')) as { mode: string; title: string; release?: boolean };
export default function (pi: ExtensionAPI) {
  const faux = fauxProvider({ provider: 'name-offline', api: 'name-offline', models: [{ id: 'scripted', reasoning: false }] });
  let names = 0, mains = 0;
  const response: Parameters<typeof faux.setResponses>[0][number] = async (context, options) => {
    faux.appendResponses([response]);
    const naming = getCurrentSystemPrompt(context.messages).includes("Evaluate one concise, searchable title");
    const c = control();
    const id = naming ? ++names : ++mains;
    log('request', { naming, id, model: 'name-offline/scripted', reasoning: options?.reasoning ?? null, sessionId: options?.sessionId, mode: c.mode, title: naming ? c.title : undefined });
    if (naming) {
      options?.signal?.addEventListener('abort', () => log('request-aborted', { id }), { once: true });
      if (c.mode === 'hold') {
        const deadline = Date.now() + 10000;
        await new Promise<void>((resolve, reject) => {
          const tick = () => {
            if (control().release) { resolve(); return; }
            if (Date.now() > deadline) { reject(new Error('Fixture release timeout')); return; }
            setTimeout(tick, 20);
          };
          tick();
        });
        log('late-provider-return', { id, aborted: options?.signal?.aborted ?? false });
      }
      if (c.mode === 'fail') return fauxAssistantMessage('', { stopReason: 'error', errorMessage: 'Offline fixture failure' });
      return fauxAssistantMessage(c.title);
    }
    return fauxAssistantMessage('OFFLINE_MAIN_OK ' + id);
  };
  faux.setResponses([response]); pi.registerProvider(faux.provider);
  pi.on('input', e => { log('input', { text: e.text, source: e.source }); });
  pi.on('agent_settled', (e, ctx) => { log('settled', { aborted: e.aborted, title: ctx.sessionManager.getSessionName() ?? null }); });
  pi.on('session_info_changed', (e, ctx) => { log('title', { name: e.name, sessionId: ctx.sessionManager.getSessionId() }); });
  pi.on('session_start', (_, ctx) => {
    log('ready', { pid: process.pid, cwd: ctx.cwd, home: process.env.HOME, mode: ctx.mode, sessionId: ctx.sessionManager.getSessionId() });
    ctx.ui.onTerminalInput(data => { log('terminal-input', { data }); setImmediate(() => log('after-input', { data })); });
    ctx.ui.notify('NAME_TMUX_READY', 'info');
  });
  pi.registerShortcut('f9', { description: 'Test-only read-only session observation', handler: async ctx => {
    log('observe', { text: ctx.ui.getEditorText(), sessionId: ctx.sessionManager.getSessionId(), title: ctx.sessionManager.getSessionName() ?? null,
      state: ctx.sessionManager.getEntries().filter(e => e.type === 'custom' && e.customType === 'preset.session-name.v1').at(-1), names, mains });
  } });
  pi.on('session_shutdown', () => log('shutdown'));
}
