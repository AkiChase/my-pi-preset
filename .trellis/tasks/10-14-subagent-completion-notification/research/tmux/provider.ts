// Test-only CLI driver: real production factory, manager, RPC and SDK loop.
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { appendFileSync } from "node:fs";
import { fauxProvider, fauxAssistantMessage, type FauxResponseFactory } from "/Users/jyxc-dz-0101322/.pi/agent/install/releases/1.2.0/node_modules/@earendil-works/pi-ai/dist/providers/faux.js";
const root = process.env.COMPLETION_SMOKE_ROOT!;
const event = (kind: string, data: object = {}) => appendFileSync(`${root}/events.jsonl`, JSON.stringify({ kind, ...data }) + "\n");
export default function (pi: ExtensionAPI) {
  const faux = fauxProvider({ provider: "completion-offline", api: "completion-offline", models: [{ id: "scripted", reasoning: false }] });
  const response: FauxResponseFactory = context => {
    faux.appendResponses([response]);
    const notification = context.messages.some(message => JSON.stringify(message).includes("<task-notification>"));
    event("provider-response", { notification });
    return fauxAssistantMessage(notification ? "PARENT_RECEIVED_COMPLETION" : "CHILD_COMPLETED_OK");
  };
  faux.setResponses([response]); pi.registerProvider(faux.provider);
  pi.registerCommand("completion-spawn", { description: "Offline actual RPC completion test", handler: async (description, ctx) => {
    const requestId = `smoke-${Date.now()}`;
    const off = pi.events.on(`subagents:rpc:spawn:reply:${requestId}`, value => { event("rpc-reply", { value }); off(); });
    pi.events.emit("subagents:rpc:spawn", { requestId, type: "general-purpose", prompt: "offline child", options: {
      ...(description === "invalid" ? { description: 42 } : description === "blank" ? { description: " " } : {}),
      model: "completion-offline/scripted", isolated: true,
    } });
    ctx.ui.notify("RPC_SENT", "info");
  } });
  pi.events.on("subagents:completed", value => event("child-completed", { value }));
  pi.on("message_end", e => { if (e.message.role === "custom") event("custom-notification", { content: e.message.content }); });
  pi.on("session_start", () => event("ready"));
  pi.on("session_shutdown", () => event("shutdown"));
}
