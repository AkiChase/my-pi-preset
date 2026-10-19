// Test-only offline provider: records each main request's input; actual CLI loop and production extension untouched.
import { appendFileSync } from 'node:fs';
import { fauxProvider, fauxAssistantMessage, fauxToolCall } from '/Users/jyxc-dz-0101322/.pi/agent/install/releases/1.3.0/node_modules/@earendil-works/pi-ai/dist/providers/faux.js';
const root = process.env.REMINDER_SMOKE_ROOT!;
const event = (kind: string, data: object = {}) => appendFileSync(root + '/events.jsonl', JSON.stringify({ time: Date.now(), kind, ...data }) + '\n');
const text = (m: any) => typeof m.content === 'string' ? m.content : (m.content || []).filter((b: any) => b.type === 'text').map((b: any) => b.text).join('\n');
export default function (pi: any) {
  let seq = 0;
  const faux = fauxProvider({ provider: 'reminder-offline', api: 'reminder-offline', models: [{ id: 'scripted', reasoning: false }] });
  const response = async (context: any) => {
    faux.appendResponses([response]);
    const messages = context.messages.map((m: any) => ({ role: m.role, text: text(m) }));
    event('request', { messages });
    const last = context.messages.findLastIndex((m: any) => m.role === 'user' && !text(m).startsWith('<background-task-reminder>'));
    const prompt = text(context.messages[last] || {});
    const after = context.messages.slice(last + 1).filter((m: any) => m.role === 'toolResult').length;
    if (prompt === 'START BG' && !after) return fauxAssistantMessage([fauxToolCall('bash', { command: 'tail -f /dev/null', background_after_seconds: 0, description: 'long sleeper' }, { id: 'c' + (++seq) })], { stopReason: 'toolUse' });
    const loop = prompt.match(/^LOOP (\d+)$/);
    if (loop && after < Number(loop[1])) return fauxAssistantMessage([fauxToolCall('bash', { command: 'true', background_after_seconds: -1, description: 'tick' }, { id: 'c' + (++seq) })], { stopReason: 'toolUse' });
    return fauxAssistantMessage('DONE ' + prompt);
  };
  faux.setResponses([response]); pi.registerProvider(faux.provider);
  pi.on('session_start', (_: any, ctx: any) => ctx.ui.notify('SMOKE_READY', 'info'));
}
