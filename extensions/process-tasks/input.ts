import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { BackgroundRegistry } from "./state.ts";

/** Ordinary messages belong to Pi's native queue/steering, never an extension handoff. */
export function registerInputHandlers(pi: ExtensionAPI, _reg: BackgroundRegistry): void {
    pi.on("input", async () => ({ action: "continue" }));
}
