import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { it } from "node:test";
import { SessionManager, type ExtensionAPI, type ExtensionContext, type ExtensionEvent } from "@earendil-works/pi-coding-agent";
import owner from "../shared/widget-display/owner.ts";
import { createWidgetClient } from "../shared/widget-display/client.ts";

for (const ownerFirst of [true, false]) {
    it(`startup slot publication survives initial and later sessions (${ownerFirst ? "owner" : "consumer"} first)`, async () => {
        const bus = new EventEmitter();
        const handlers: { name: string; handler: (event: ExtensionEvent, ctx: ExtensionContext) => unknown }[] = [];
        const pi = () => ({ events: {
            on(name: string, handler: (data: unknown) => void) { bus.on(name, handler); return () => { bus.off(name, handler); }; },
            emit(name: string, data: unknown) { bus.emit(name, data); },
        }, on(name: string, handler: (event: ExtensionEvent, ctx: ExtensionContext) => unknown) {
            const row = { name, handler }; handlers.push(row);
            return () => { const index = handlers.indexOf(row); if (index >= 0) handlers.splice(index, 1); };
        } }) as unknown as ExtensionAPI;
        const consumer = () => {
            const api = pi(), widget = createWidgetClient(api, "trellis");
            api.on("session_start", (_event, ctx) => { widget.set(ctx, ["startup task"]); });
        };
        if (ownerFirst) { owner(pi()); consumer(); } else { consumer(); owner(pi()); }
        const widgets = new Map<string, readonly string[]>();
        const context = () => ({ hasUI: true, mode: "rpc", sessionManager: SessionManager.inMemory("/tmp"), ui: {
            setWidget(key: string, lines: readonly string[] | undefined) { if (lines) widgets.set(key, lines); else widgets.delete(key); },
        } }) as unknown as ExtensionContext;
        let ctx = context();
        const emit = async (name: string) => { for (const row of [...handlers]) if (row.name === name) await row.handler({ type: name } as ExtensionEvent, ctx); };
        try {
            await emit("session_start"); assert.deepEqual([...widgets.values()], [["startup task"]], "initial session");
            ctx = context(); await emit("session_start");
            assert.deepEqual([...widgets.values()], [["startup task"]], "later session must not lose the consumer's startup publication");
        } finally { await emit("session_shutdown"); }
        assert.equal(widgets.size, 0);
    });
}
