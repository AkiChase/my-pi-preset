import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Highlighter } from "./highlight.ts";
import { readRenderers } from "./tools/read.ts";
import { createBashRenderers } from "./tools/bash.ts";
import { createToolClock } from "./tool-clock.ts";
import { findRenderers } from "./tools/find.ts";
import { grepRenderers } from "./tools/grep.ts";
import { optionalRenderers } from "./tools/optional.ts";
import { monitorContract } from "./tools/monitor.ts";
import { managementContract } from "./tools/management.ts";
import { registerAppearance } from "./editor/owner.ts";
import { registerPhaseStatus } from "./editor/phase-status.ts";
export default function beautify(pi: ExtensionAPI): void {
  const highlighter = new Highlighter();
  const clock = createToolClock(pi);
  const tools = { read: readRenderers(highlighter), bash: createBashRenderers(ctx => clock.display(ctx)), find: findRenderers, grep: grepRenderers };
  pi.registerToolRenderer((name, next) => {
    if (Object.hasOwn(tools, name)) return tools[name as keyof typeof tools];
    if (name === "process_manage" || name === "agent_manage") return optionalRenderers(name, next(), managementContract(name === "process_manage" ? "process" : "agent"));
    if (name === "monitor") return optionalRenderers(name, next(), monitorContract);
    return next();
  });
  registerAppearance(pi, registerPhaseStatus(pi));
  pi.on("session_shutdown", () => highlighter.dispose());
}
