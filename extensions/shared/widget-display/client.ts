import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { CONNECT, type ConnectRequest, type Slot, type WidgetContent, type WidgetHandle } from "./contracts.ts";

/** One finite publisher per consumer activation. No session state is shared at import time. */
export function createWidgetClient(pi: Pick<ExtensionAPI, "events" | "on">, slot: Slot) {
    const token = {};
    let closed = false;
    let generation = 0;
    let handle: WidgetHandle | undefined;
    let manager: ExtensionContext["sessionManager"] | undefined;
    let sessionId: string | undefined;
    function release(value?: WidgetHandle): void { try { value?.dispose(); } catch { /* Isolate unavailable owner cleanup. */ } }
    function disposeHandle(): void { const previous = handle; handle = undefined; release(previous); }
    const offStart = pi.on("session_start", (_event, ctx) => {
        if (closed) return;
        const id = ctx.sessionManager.getSessionId();
        if (manager !== ctx.sessionManager || sessionId !== id) {
            generation++; manager = ctx.sessionManager; sessionId = id; disposeHandle();
        }
    });
    const off = pi.on("session_shutdown", () => { closed = true; generation++; disposeHandle(); manager = undefined; offStart(); });
    return {
        set(ctx: ExtensionContext, content: WidgetContent | undefined): boolean {
            try {
                if (closed || !ctx.hasUI || (ctx.mode !== "tui" && ctx.mode !== "rpc")) return false;
                const origin = ++generation;
                const id = ctx.sessionManager.getSessionId();
                const valid = () => !closed && generation === origin && ctx.sessionManager.getSessionId() === id;
                if (!valid()) return false;
                if (!handle || manager !== ctx.sessionManager || sessionId !== id) {
                    let accepting = true;
                    const request: ConnectRequest = { version: 1, slot, token, ctx, accept(value) {
                        if (accepting && valid()) {
                            accepting = false;
                            const previous = handle;
                            handle = value; manager = ctx.sessionManager; sessionId = id;
                            release(previous);
                        } else release(value);
                    } };
                    try { pi.events.emit(CONNECT, request); } finally { accepting = false; }
                }
                // A rejected stale connect must not dispose the newer session's lease.
                if (!valid() || manager !== ctx.sessionManager || sessionId !== id) return false;
                const accepted = handle;
                return (accepted?.set(content) ?? false) && valid() && handle === accepted;
            } catch { return false; }
        },
        dispose(): void { closed = true; generation++; disposeHandle(); manager = undefined; offStart(); off(); },
    };
}
