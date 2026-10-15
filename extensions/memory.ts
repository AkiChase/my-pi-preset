import { getAgentDir } from "@earendil-works/pi-coding-agent";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { projectIdentity } from "./memory/identity.ts";
import { MemoryStore } from "./memory/store.ts";
import { closed, registerMemoryTools } from "./memory/tools.ts";

// Stage 1: tools and bounded session initialization only. No prompt, panel or shutdown flush.
export default function memory(pi: ExtensionAPI): void {
  let epoch = 0;
  let state: { epoch: number; cwd: string; store: MemoryStore } | undefined;
  let retired = false;
  registerMemoryTools(pi, (cwd, signal) => {
    const origin = state;
    if (!origin || origin.cwd !== cwd || retired) return closed();
    const assertActive = () => {
      if (retired || state !== origin || epoch !== origin.epoch || signal?.aborted) closed();
    };
    assertActive();
    return { store: origin.store, assertActive };
  });
  pi.on("session_start", async (_event, ctx) => {
    if (retired) return;
    state = undefined;
    const originEpoch = ++epoch;
    const assertActive = () => { if (retired || epoch !== originEpoch) closed(); };
    const identity = await projectIdentity(ctx.cwd);
    assertActive();
    const store = new MemoryStore(getAgentDir(), identity);
    store.initialize(assertActive);
    assertActive();
    state = { epoch: originEpoch, cwd: ctx.cwd, store };
  });
  pi.on("session_shutdown", () => { retired = true; ++epoch; state = undefined; });
}
