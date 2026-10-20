import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Highlighter } from "./highlight.ts";
import { readRenderers } from "./tools/read.ts";
import { createBashRenderers } from "./tools/bash.ts";
import { createToolClock } from "./tool-clock.ts";
import { createFindRenderers } from "./tools/find.ts";
import { createGrepRenderers } from "./tools/grep.ts";
import { createToolCardRenderers, withToolCardTiming } from "./tool-card.ts";
import { optionalRenderers } from "./tools/optional.ts";
import { monitorContract } from "./tools/monitor.ts";
import { managementContract } from "./tools/management.ts";
import { registerAppearance } from "./editor/owner.ts";
import { registerPhaseStatus } from "./editor/phase-status.ts";
export default function beautify(pi: ExtensionAPI): void {
  const highlighter = new Highlighter();
  const clock = createToolClock(pi);
  const timing = (ctx: Parameters<typeof clock.display>[0]) => clock.display(ctx);
  const tools = {
    read: readRenderers(highlighter, timing),
    bash: createBashRenderers(timing),
    find: createFindRenderers(timing),
    grep: createGrepRenderers(timing),
  };
  pi.registerToolRenderer((name, next) => {
    if (Object.hasOwn(tools, name)) return tools[name as keyof typeof tools];
    const original = next();
    const cooperative = withToolCardTiming(original, context => clock.timing(context));
    if (cooperative) return cooperative;
    if (name === "process_manage" || name === "agent_manage") return optionalRenderers(name, original, managementContract(name === "process_manage" ? "process" : "agent"));
    if (name === "monitor") return optionalRenderers(name, original, monitorContract);
    return original ?? createToolCardRenderers(name, ctx => clock.timing(ctx));
  });
  registerAppearance(pi, registerPhaseStatus(pi));
  pi.on("session_shutdown", () => highlighter.dispose());
}
