import assert from "node:assert/strict";
import { it } from "node:test";
import { Container, type Component } from "@earendil-works/pi-tui";
import { initTheme, createEventBus, SessionManager, type ExtensionAPI, type ExtensionContext } from "@earendil-works/pi-coding-agent";
import owner from "../owner.ts";
import statusBar from "../../../status-bar.ts";
import { createWidgetClient } from "../client.ts";

for (const ownerFirst of [true, false]) it(`installed SDK Footer setter/factory/reset and ${ownerFirst ? "owner" : "consumer"}-first lifecycle preserve takeover and fresh activation`, async () => {
    initTheme("dark", false);
    // Test-only introspection: product uses only public ui.setFooter and its supplied provider.
    const { InteractiveMode } = await import(new URL("./modes/interactive/interactive-mode.js", import.meta.resolve("@earendil-works/pi-coding-agent")).href);
    const handlers = new Map<string, Set<(event: never, ctx: ExtensionContext) => unknown>>();
    const bus = createEventBus();
    let subscribers = 0, factories = 0, disposed = 0;
    const provider = { getExtensionStatuses: () => new Map([["foreign", "foreign status"]]),
        getAvailableProviderCount: () => 1, onBranchChange() { subscribers++; return () => { subscribers--; }; }, clearExtensionStatuses() {} };
    const seam = { customFooter: undefined as (Component & { dispose?(): void }) | undefined,
        footerContainer: new Container(), footer: { render: () => ["native"], invalidate() {} }, footerDataProvider: provider,
        ui: { requestRender() {}, hideOverlay() {} }, defaultEditor: {}, activeStatusIndicator: undefined,
        setExtensionFooter(factory: unknown) { factories++; InteractiveMode.prototype.setExtensionFooter.call(seam, factory); },
        extensionDialogs: [], showTopExtensionDialog() {},
        clearExtensionTerminalInputListeners() {}, setExtensionHeader() {}, clearExtensionWidgets() {}, setCustomEditorComponent() {},
        setupAutocompleteProvider() {}, updateTerminalTitle() {}, setWorkingIndicator() {}, setHiddenThinkingLabel() {},
    };
    const api = { events: bus, on(name: string, fn: (event: never, ctx: ExtensionContext) => unknown) {
        const set = handlers.get(name) ?? new Set(); handlers.set(name, set); set.add(fn); return () => { set.delete(fn); };
    }, getSettings: () => ({}), exec: async () => ({ code: 1, stdout: "", stderr: "" }) } as unknown as ExtensionAPI;
    let ctx = { hasUI: true, mode: "tui", sessionManager: SessionManager.inMemory("/tmp"), getContextUsage: () => undefined,
        ui: { setFooter: (factory: unknown) => seam.setExtensionFooter(factory) } } as unknown as ExtensionContext;
    const emit = async (name: string) => { for (const fn of [...handlers.get(name) ?? []]) await fn({} as never, ctx); };
    if (ownerFirst) { owner(api); statusBar(api); } else { statusBar(api); owner(api); }
    const agent = createWidgetClient(api, "agent_overview");
    await emit("session_start");
    assert.equal(subscribers, 1, "all metric items share one provider subscription");
    const mounted = seam.customFooter!; const writes = factories;
    agent.set(ctx, () => ({ render: () => ["agent last"], invalidate() {}, dispose() { disposed++; } }));
    assert.equal(factories, writes); assert.equal(seam.customFooter, mounted);
    const lines = mounted.render(200); assert.equal(lines.length, 4); assert.equal(lines[3], "agent last");
    assert.match(lines[2], /foreign status/); assert.equal(lines.some(line => line === ""), false);
    seam.setExtensionFooter(() => ({ render: () => ["later footer"], invalidate() {} }));
    assert.equal(subscribers, 0); assert.equal(disposed, 1); assert.deepEqual(mounted.render(200), []);
    assert.equal(agent.set(ctx, ["cannot reclaim"]), false);
    await emit("session_shutdown"); assert.deepEqual(seam.customFooter?.render(200), ["later footer"]);
    InteractiveMode.prototype.resetExtensionUI.call(seam); assert.equal(seam.customFooter, undefined);
    assert.deepEqual(seam.footerContainer.render(200), ["native"]);
    ctx = { ...ctx, sessionManager: SessionManager.inMemory("/tmp") };
    owner(api); statusBar(api); await emit("session_start"); assert.equal(subscribers, 1);
    InteractiveMode.prototype.resetExtensionUI.call(seam); assert.equal(subscribers, 0);
    await emit("session_shutdown"); assert.equal(subscribers, 0); assert.equal(seam.customFooter, undefined);
});
