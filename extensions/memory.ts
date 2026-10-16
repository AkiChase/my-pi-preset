import { getAgentDir } from "@earendil-works/pi-coding-agent";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { projectIdentity } from "./memory/identity.ts";
import { MemoryStore } from "./memory/store.ts";
import { closed, registerMemoryTools } from "./memory/tools.ts";
import { readEnabled } from "./memory/config.ts";
import { registerMemoryCommand } from "./memory/command.ts";
import { MEMORY_SECTION, buildMemoryPrompt, memoryDiagnostic, unavailableMemoryPrompt } from "./memory/prompt.ts";

export default function memory(pi: ExtensionAPI): void {
  let epoch = 0;
  let state: { epoch: number; cwd: string; agentDir: string; store?: MemoryStore; diagnostic?: string } | undefined;
  let retired = false;
  registerMemoryTools(pi, (cwd, signal) => {
    const origin = state;
    if (!origin?.store || origin.cwd !== cwd || retired) return closed();
    const assertActive = () => {
      if (retired || state !== origin || epoch !== origin.epoch || signal?.aborted) closed();
    };
    assertActive();
    return { store: origin.store, assertActive };
  });
  const commands = registerMemoryCommand(pi, cwd => {
    const origin = state;
    if (!origin || retired || origin.cwd !== cwd) return closed();
    const assertActive = () => { if (retired || state !== origin || epoch !== origin.epoch) closed(); };
    assertActive();
    return { ...origin, assertActive };
  });
  pi.on("session_start", async (_event, ctx) => {
    if (retired) return;
    commands.close();
    state = undefined;
    const originEpoch = ++epoch;
    const assertActive = () => { if (retired || epoch !== originEpoch) closed(); };
    const agentDir = getAgentDir();
    try {
      const identity = await projectIdentity(ctx.cwd);
      assertActive();
      const store = new MemoryStore(agentDir, identity);
      store.initialize(assertActive);
      assertActive();
      state = { epoch: originEpoch, cwd: ctx.cwd, agentDir, store };
    } catch (error) {
      assertActive(); // A failed or successful late initialization must never revive a closed activation.
      state = { epoch: originEpoch, cwd: ctx.cwd, agentDir, diagnostic: memoryDiagnostic(error) };
    }
  });
  pi.on("before_agent_start", (event, ctx) => {
    // Mutate only this run's owned key, including removal when disabled or stale.
    delete event.systemPromptOptions.sections[MEMORY_SECTION];
    const origin = state;
    if (!origin || retired || origin.cwd !== ctx.cwd || origin.epoch !== epoch) return;
    let prompt: string;
    try {
      if (!readEnabled(origin.agentDir)) return;
      prompt = origin.store ? buildMemoryPrompt(origin.store) : unavailableMemoryPrompt(origin.diagnostic!);
    } catch (error) { prompt = unavailableMemoryPrompt(memoryDiagnostic(error)); }
    if (retired || state !== origin || epoch !== origin.epoch) return;
    event.systemPromptOptions.sections[MEMORY_SECTION] = prompt;
  });
  pi.on("session_shutdown", () => { retired = true; ++epoch; state = undefined; commands.close(); });
}
