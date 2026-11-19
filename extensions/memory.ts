import { createHash } from "node:crypto";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { hasStartup, startupDetails } from "./shared/model-context/startup.ts";
import { projectIdentity } from "./memory/identity.ts";
import { MemoryStore } from "./memory/store.ts";
import { closed, registerMemoryTools } from "./memory/tools.ts";
import { readEnabled } from "./memory/config.ts";
import { registerMemoryCommand } from "./memory/command.ts";
import { MEMORY_RULES, MEMORY_SECTION, MEMORY_STARTUP, buildMemoryPrompt, memoryDiagnostic, unavailableMemoryPrompt } from "./memory/prompt.ts";

export default function memory(pi: ExtensionAPI): void {
  let epoch = 0;
  type State = { epoch: number; cwd: string; agentDir: string; key: string; unconfirmed: Set<string>; store?: MemoryStore; diagnostic?: string; initializing?: Promise<void> };
  let state: State | undefined;
  let retired = false;
  const check = (origin: State, signal?: AbortSignal) => {
    if (retired || state !== origin || epoch !== origin.epoch || signal?.aborted) closed();
  };
  async function initialize(origin: State, signal?: AbortSignal): Promise<void> {
    check(origin, signal);
    if (!origin.initializing) {
      origin.initializing = (async () => {
        const identity = await projectIdentity(origin.cwd);
        check(origin, signal);
        const store = new MemoryStore(origin.agentDir, identity);
        store.initialize(() => check(origin, signal));
        check(origin, signal);
        origin.store = store; origin.diagnostic = undefined;
      })();
    }
    try { await origin.initializing; check(origin); }
    finally { origin.initializing = undefined; }
  }
  async function access(cwd: string, signal?: AbortSignal) {
    const origin = state;
    if (!origin || origin.cwd !== cwd || retired) return closed();
    check(origin, signal);
    if (!origin.store) await initialize(origin, signal);
    check(origin, signal);
    return { ...origin, store: origin.store!, assertActive: () => check(origin, signal) };
  }
  registerMemoryTools(pi, access);
  const commands = registerMemoryCommand(pi, async cwd => {
    const origin = state;
    if (!origin || retired || origin.cwd !== cwd) return closed();
    check(origin);
    // Commands may repair configuration even when initialization failed. Retry only on access.
    if (!origin.store) {
      try { await initialize(origin); }
      catch (error) { check(origin); origin.diagnostic = memoryDiagnostic(error); }
    }
    check(origin);
    return { ...origin, assertActive: () => check(origin) };
  });
  pi.on("session_start", async (_event, ctx) => {
    if (retired) return;
    commands.close();
    const agentDir = getAgentDir();
    const origin: State = { epoch: ++epoch, cwd: ctx.cwd, agentDir, unconfirmed: new Set(),
      key: createHash("sha256").update(`${agentDir}\0${ctx.cwd}`).digest("hex") };
    state = origin;
    try { await initialize(origin); }
    catch (error) { check(origin); origin.diagnostic = memoryDiagnostic(error); }
  });
  pi.on("before_agent_start", (event, ctx) => {
    const origin = state;
    if (!origin || retired || origin.cwd !== ctx.cwd || origin.epoch !== epoch) {
      delete event.systemPromptOptions.sections[MEMORY_SECTION];
      return;
    }
    event.systemPromptOptions.sections[MEMORY_SECTION] = MEMORY_RULES;
    if (hasStartup(ctx.sessionManager.getBranch().filter(entry => !origin.unconfirmed.has(entry.id)), MEMORY_STARTUP, MEMORY_SECTION, origin.key, "index", entry => {
      if (entry.type !== "message" || entry.message.role !== "system") return false;
      const section = entry.message.sections?.[MEMORY_SECTION];
      return typeof section === "string" && (section.includes("pi-project-memory: derived index") || section.includes("the index below contains metadata only"));
    })) return;
    let content: string;
    let outcome: "provided" | "unavailable" = "provided";
    try {
      if (!readEnabled(origin.agentDir)) {
        check(origin);
        const before = new Set(ctx.sessionManager.getBranch().map(entry => entry.id));
        try { pi.appendEntry(MEMORY_STARTUP, startupDetails(MEMORY_SECTION, origin.key, ["index"], "skipped")); }
        catch {
          check(origin);
          // A tolerated non-atomic host may throw after modifying memory. Do not reuse those entries.
          for (const entry of ctx.sessionManager.getBranch()) if (!before.has(entry.id) && entry.type === "custom" && entry.customType === MEMORY_STARTUP) origin.unconfirmed.add(entry.id);
          if (ctx.hasUI) {
            try { ctx.ui.notify("Memory startup record could not be saved. Persistence is not confirmed; retrying at the next start.", "warning"); }
            catch { /* UI failure must not create a model message for disabled memory. */ }
          }
        }
        return;
      }
      if (origin.store) content = buildMemoryPrompt(origin.store);
      else { content = unavailableMemoryPrompt(origin.diagnostic!); outcome = "unavailable"; }
    } catch (error) { content = unavailableMemoryPrompt(memoryDiagnostic(error)); outcome = "unavailable"; }
    check(origin);
    return { message: { customType: MEMORY_STARTUP, content, display: false, details: startupDetails(MEMORY_SECTION, origin.key, ["index"], outcome) } };
  });
  pi.on("session_shutdown", () => { retired = true; ++epoch; state = undefined; commands.close(); });
}
