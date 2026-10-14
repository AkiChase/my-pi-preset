// Test-only public input/text/submit probe and local faux provider; never calls editor methods.
import { appendFileSync } from 'node:fs';
import type { ExtensionAPI } from '/Users/jyxc-dz-0101322/.pi/agent/install/releases/1.2.0/node_modules/@earendil-works/pi-coding-agent/dist/index.js';
import { fauxProvider, fauxAssistantMessage } from '/Users/jyxc-dz-0101322/.pi/agent/install/releases/1.2.0/node_modules/@earendil-works/pi-ai/dist/providers/faux.js';
const root = process.env.AT_TMUX_ROOT!;
const log = (kind: string, data: object = {}) => appendFileSync(root + '/events.jsonl', JSON.stringify({ time: Date.now(), kind, ...data }) + '\n');
export default function (pi: ExtensionAPI) {
  const faux = fauxProvider({ provider: 'at-offline', api: 'at-offline', models: [{ id: 'scripted', reasoning: false }] });
  const response = async () => { log('provider-request'); faux.appendResponses([response]); return fauxAssistantMessage('OFFLINE_SUBMIT_OK'); };
  faux.setResponses([response]); pi.registerProvider(faux.provider);
  pi.on('input', e => { log('submit', { text: e.text, source: e.source }); });
  pi.on('before_agent_start', e => { log('before-agent-start', { prompt: e.prompt }); });
  pi.on('agent_end', () => log('agent-end'));
  pi.on('session_start', (_, ctx) => {
    log('ready', { pid: process.pid, cwd: ctx.cwd, home: process.env.HOME, mode: ctx.mode });
    ctx.ui.onTerminalInput(data => {
      log('terminal-input', { data });
      setImmediate(() => log('after-input', { data, text: ctx.ui.getEditorText() }));
    });
    ctx.ui.notify('AT_TMUX_READY', 'info');
  });
  pi.registerShortcut('f9', { description: 'Test-only read-only editor observation', handler: async ctx => { log('observe', { text: ctx.ui.getEditorText() }); } });
  pi.on('session_shutdown', () => log('shutdown'));
}
