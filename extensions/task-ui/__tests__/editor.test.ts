import assert from "node:assert/strict";
import { it } from "node:test";
import { CustomEditor, type ExtensionAPI, type ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Container, TuiMainScreen, setKeybindings, type AutocompleteProvider, type EditorComponent } from "@earendil-works/pi-tui";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { InteractiveMode, KeybindingsManager, themeSdk } from "./editor-host.mjs";
import beautify from "../../beautify/index.ts";
import { decorateAppearance } from "../../beautify/editor/appearance.ts";
import { registerDownOpener } from "../editor.ts";
import { TaskCoordinator } from "../coordinator.ts";
import { TaskLifecycle } from "../lifecycle.ts";
import { TaskPanel } from "../panel.ts";
import { createTaskUIOwner } from "../owner.ts";
import { DEFAULTS } from "../config.ts";
import { taskKey, type TaskView } from "../types.ts";

type EditorFactory = NonNullable<Parameters<ExtensionContext["ui"]["setEditorComponent"]>[0]>;
const DOWN = "\x1b[B", UP = "\x1b[A";
const pause = () => new Promise<void>(resolve => setTimeout(resolve, 5));
function harness() {
    const keys = new KeybindingsManager(); setKeybindings(keys);
    const tui = new TuiMainScreen({ columns: 80, rows: 24, kittyProtocolActive: false, start() {}, stop() {}, async drainInput() {},
        write() {}, moveBy() {}, hideCursor() {}, showCursor() {}, clearLine() {}, clearFromCursor() {}, clearScreen() {}, setTitle() {},
        setProgress() {}, setProgramStatus() {} });
    tui.requestRender = () => {};
    const defaultEditor = new CustomEditor(tui, themeSdk.getEditorTheme(), keys);
    const counts = { submit: [] as string[], change: 0, extension: 0, escape: 0, exit: 0, paste: 0, model: 0, raw: 0, factories: 0 };
    defaultEditor.onSubmit = text => { counts.submit.push(text); };
    defaultEditor.onChange = () => { counts.change++; };
    defaultEditor.onEscape = () => { counts.escape++; };
    defaultEditor.onCtrlD = () => { counts.exit++; };
    defaultEditor.onPasteImage = () => { counts.paste++; };
    defaultEditor.onExtensionShortcut = data => { if (data !== "\x1bx") return false; counts.extension++; return true; };
    defaultEditor.onAction("app.model.cycleForward", () => { counts.model++; });
    const provider: AutocompleteProvider = {
        async getSuggestions() { return { items: [{ value: "one", label: "one" }, { value: "two", label: "two" }], prefix: "" }; },
        applyCompletion(_lines, _line, _col, item) { return { lines: [item.value], cursorLine: 0, cursorCol: item.value.length }; },
    };
    defaultEditor.setAutocompleteProvider(provider);
    const host = {
        ui: tui, editor: defaultEditor as EditorComponent, defaultEditor, keybindings: keys, autocompleteProvider: provider,
        editorContainer: new Container(), statusContainer: new Container(), activeStatusIndicator: undefined,
        editorComponentFactory: undefined as EditorFactory | undefined,
        disposeActiveSelector() {}, setExtensionStatus() {},
        showExtensionCustom: InteractiveMode.prototype.showExtensionCustom,
        addExtensionTerminalInputListener() { counts.raw++; return () => {}; },
        showExtensionNotify() {},
        setCustomEditorComponent: InteractiveMode.prototype.setCustomEditorComponent,
    };
    host.editorContainer.addChild(defaultEditor); tui.setFocus(defaultEditor);
    const ui = InteractiveMode.prototype.createExtensionUIContext.call(host);
    const ctx = { ui, mode: "tui" } as unknown as ExtensionContext;
    const handlers = new Set<(event: unknown, ctx: ExtensionContext) => unknown>();
    const pi = { on(_name: string, handler: (event: unknown, ctx: ExtensionContext) => unknown) {
        handlers.add(handler); return () => { handlers.delete(handler); };
    } } as unknown as ExtensionAPI;
    const coordinator = new TaskCoordinator(), lifecycle = new TaskLifecycle(coordinator);
    let canOpen = true, opens = 0;
    const panel = { canOpen: () => canOpen && lifecycle.active, async openPanel(origin: ExtensionContext) { assert.equal(origin, ctx); opens++; } };
    return {
        host, tui, keys, counts, ctx, pi, handlers, coordinator, lifecycle, panel,
        get editor() { return host.editor as CustomEditor; }, get opens() { return opens; },
        setCanOpen(value: boolean) { canOpen = value; },
        install(enabled = true) { return registerDownOpener(pi, lifecycle, enabled, panel); },
        async start() { for (const handler of [...handlers]) await handler({}, ctx); },
        // Execute ACTUAL TUI focus/overlay/raw dispatch, not a copied implementation.
        dispatch(data: string) {
            (tui as unknown as { handleTerminalInput(data: string): void }).handleTerminalInput(data);
        },
        async dispose() { await lifecycle.shutdown(); tui.stop(); },
    };
}

void it("actual host first installation keeps live default/custom identity, draft cursor, undo and native callbacks", async () => {
    for (const custom of [false, true]) {
        const h = harness();
        try {
            let factoryCalls = 0;
            if (custom) h.ctx.ui.setEditorComponent((tui, theme, keys) => {
                factoryCalls++; return new CustomEditor(tui, theme, keys);
            });
            const original = h.editor, handle = original.handleInput;
            original.setText("draft"); original.handleInput("\x1b[D"); original.insertTextAtCursor("!");
            const cursor = original.getCursor(), draft = original.getText(), changes = h.counts.change;
            const submit = original.onSubmit, change = original.onChange;
            const descriptor = Object.getOwnPropertyDescriptor(original, "setText");
            h.install(); await h.start();
            assert.equal(h.editor, original); assert.equal(factoryCalls, custom ? 1 : 0);
            assert.equal(h.editor.onSubmit, submit); assert.equal(h.editor.onChange, change);
            assert.equal(h.editor.getText(), draft); assert.deepEqual(h.editor.getCursor(), cursor);
            assert.equal(h.counts.change, changes); assert.deepEqual(Object.getOwnPropertyDescriptor(original, "setText"), descriptor);
            original.handleInput("\x1f"); assert.equal(original.getText(), "draft");
            await h.start(); assert.equal(h.editor, original);
            original.setText(""); original.handleInput("\x1bx"); original.handleInput("\x03");
            original.handleInput("\x1b"); original.handleInput("\x04"); original.handleInput("\x16"); original.handleInput("\x10");
            assert.deepEqual([h.counts.extension, h.counts.escape, h.counts.exit, h.counts.paste, h.counts.model], [1, 1, 1, 1, 1]);
            original.handleInput("sent"); original.handleInput("\r"); assert.deepEqual(h.counts.submit, ["sent"]);
            await h.lifecycle.shutdown(); assert.equal(original.handleInput, handle); assert.equal(h.handlers.size, 0);
            assert.equal(h.counts.raw, 0);
        } finally { await h.dispose(); }
    }
});

void it("first handoff preserves real history browsing draft, large paste expansion and explicit empty Tab autocomplete", async () => {
    for (const state of ["history", "paste", "autocomplete"]) {
        const h = harness();
        try {
            const editor = h.editor;
            if (state === "history") {
                h.setCanOpen(false); editor.addToHistory("older"); editor.setText("local draft"); editor.handleInput("\x1b[D"); editor.render(80); editor.handleInput("\x01"); editor.handleInput(UP);
                assert.equal(editor.getText(), "older");
            } else if (state === "paste") {
                editor.handleInput(`\x1b[200~${"line\n".repeat(150)}\x1b[201~`);
                assert.match(editor.getText(), /paste #/);
            } else { editor.handleInput("\t"); await pause(); assert.equal(editor.isShowingAutocomplete(), true); }
            const expanded = editor.getExpandedText(), cursor = editor.getCursor();
            h.install(); await h.start();
            assert.equal(h.editor, editor); assert.equal(editor.getExpandedText(), expanded); assert.deepEqual(editor.getCursor(), cursor);
            if (state === "history") { editor.handleInput(DOWN); assert.equal(editor.getText(), "local draft"); assert.equal(editor.getCursor().col, 0); }
            if (state === "paste") { editor.handleInput("\r"); assert.equal(h.counts.submit[0], "line\n".repeat(150).trimEnd()); }
            if (state === "autocomplete") {
                assert.equal(editor.isShowingAutocomplete(), true); editor.handleInput(DOWN); assert.equal(h.opens, 0);
                editor.handleInput("\r"); assert.equal(editor.getText(), "two"); assert.equal(h.counts.submit.length, 0);
            }
        } finally { await h.dispose(); }
    }
});

void it("strict empty/press/focused/no-overlay conditions and actual TUI routing; no-task native history survives", async () => {
    const h = harness();
    try {
        h.install(); await h.start();
        const e = h.editor;
        e.setText(" "); e.handleInput(DOWN); assert.equal(h.opens, 0);
        e.setText("multiline\ntext"); e.handleInput(DOWN); assert.equal(h.opens, 0);
        e.setText(""); h.setCanOpen(false); e.addToHistory("history"); e.handleInput(UP); assert.equal(e.getText(), "history"); e.handleInput(DOWN); assert.equal(e.getText(), "");
        h.setCanOpen(true); e.handleInput("\x1b[1;1:3B"); e.handleInput("\x1b[1;1:2B"); assert.equal(h.opens, 0);
        e.focused = false; e.handleInput(DOWN); assert.equal(h.opens, 0); e.focused = true;
        h.tui.setFocus({ invalidate() {}, render: () => ["selector"] }); e.focused = true; e.handleInput(DOWN); assert.equal(h.opens, 0);
        h.tui.setFocus(null); e.focused = true; e.handleInput(DOWN); assert.equal(h.opens, 0);
        h.tui.setFocus(e);
        let overlayInputs = 0;
        const overlay = { focused: false, invalidate() {}, render: () => ["popup"], handleInput() { overlayInputs++; } };
        const lease = h.tui.showOverlay(overlay);
        e.focused = true; e.handleInput(DOWN); assert.equal(h.opens, 0);
        h.dispatch(DOWN); assert.equal(overlayInputs, 1); assert.equal(h.opens, 0);
        lease.hide(); h.tui.setFocus(e); h.dispatch(DOWN); assert.equal(h.opens, 1);
        h.setCanOpen(false); h.dispatch(DOWN); assert.equal(h.opens, 1);
        assert.equal(h.counts.raw, 0);
    } finally { await h.dispose(); }
});

void it("Beautify live editor first, Down last: actual prompt render and custom action/callback ownership preserved", async () => {
    const h = harness();
    try {
        let calls = 0;
        h.ctx.ui.setEditorComponent((tui, theme, keys) => { calls++; const e = new CustomEditor(tui, theme, keys); decorateAppearance(e); return e; });
        const editor = h.editor;
        let customAction = 0, customSubmit = "";
        editor.onAction("app.model.cycleForward", () => { customAction++; }); editor.onSubmit = text => { customSubmit = text; };
        const before = editor.render(80).join("\n"); assert.match(before, /❯/);
        h.install(); await h.start();
        assert.equal(h.editor, editor); assert.equal(calls, 1); assert.equal(editor.render(80).join("\n"), before);
        editor.handleInput("\x10"); assert.equal(customAction, 1); assert.equal(h.counts.model, 0);
        editor.handleInput("hello"); editor.handleInput("\r"); assert.equal(customSubmit, "hello");
        editor.setText(""); editor.handleInput(DOWN); assert.equal(h.opens, 1);
    } finally { await h.dispose(); }
});

for (const order of ["before", "after"]) void it(`history-equivalent instance wrapper ${order}, later factory delegation and inactive opaque wrappers`, async () => {
    const h = harness();
    try {
        const original = h.editor;
        const wrap = (editor: CustomEditor) => {
            const input = editor.handleInput;
            editor.handleInput = function (data) { assert.equal(this, editor); if (data === "\x1br") this.setText("plugin history"); else input.call(this, data); };
        };
        if (order === "before") wrap(original);
        h.install(); await h.start();
        if (order === "after") wrap(original);
        original.handleInput("\x1br"); assert.equal(original.getText(), "plugin history");
        const saved = h.ctx.ui.getEditorComponent()!;
        const later: EditorFactory = (tui, theme, keys) => { const e = saved(tui, theme, keys) as CustomEditor; wrap(e); return e; };
        h.ctx.ui.setEditorComponent(later);
        assert.notEqual(h.editor, original); const e = h.editor;
        e.setText(""); e.handleInput(DOWN); assert.equal(h.opens, 1);
        e.handleInput("\x1br"); assert.equal(e.getText(), "plugin history");
        const opaque = e.handleInput;
        await h.lifecycle.shutdown();
        assert.equal(h.ctx.ui.getEditorComponent(), later); assert.equal(e.handleInput, opaque);
        e.setText(""); e.handleInput(DOWN); assert.equal(h.opens, 1);
        h.ctx.ui.setEditorComponent(saved); h.editor.setText(""); h.editor.handleInput(DOWN); assert.equal(h.opens, 1);
        assert.equal(h.handlers.size, 0); assert.equal(h.counts.raw, 0);
    } finally { await h.dispose(); }
});

void it("owner fresh model exposes foreground-only and four-second visibility, refuses open/closed interaction", async () => {
    const h = harness();
    const identity = { sourceId: "shell", taskId: "fg", runId: "1" };
    let view: TaskView = { ...identity, key: taskKey(identity), title: "fg", kind: "shell", status: "running", executionMode: "foreground", waitCount: 1, stats: {}, artifacts: [], capabilities: { stop: true, details: true } };
    h.coordinator.registerSource({ sourceId: "shell", revision: 1, list: () => [view], detail: () => ({ text: "log" }), stop: () => true, subscribe: () => () => {}, dispose() {} });
    const owner = createTaskUIOwner(h.pi, h.coordinator, h.lifecycle, DEFAULTS);
    try {
        assert.equal(owner.canOpen(), true);
        view = { ...view, status: "completed", endedAt: Date.now() - 3_999 }; assert.equal(owner.canOpen(), true);
        view = { ...view, endedAt: Date.now() - 4_000 }; assert.equal(owner.canOpen(), false);
        view = { ...view, status: "running" };
        let done!: () => void;
        h.ctx.ui.custom = async <T>() => new Promise<T>(resolve => { done = () => resolve(undefined as T); });
        const open = owner.openPanel(h.ctx); assert.equal(owner.canOpen(), false); done(); await open; assert.equal(owner.canOpen(), true);
        await h.lifecycle.shutdown(); assert.equal(owner.canOpen(), false);
    } finally { owner.dispose(); await h.dispose(); }
});

void it("beautify actual session_start before Down and real panel focus/nav/close leave execution waits untouched", async () => {
    const dir = mkdtempSync(join(tmpdir(), "task-down-beautify-"));
    const h = harness();
    const starts: Array<(event: unknown, ctx: ExtensionContext) => unknown> = [], shuts: Array<(event: unknown, ctx: ExtensionContext) => unknown> = [];
    const rawPi = {
        on(name: string, callback: (event: unknown, ctx: ExtensionContext) => unknown) {
            const list = name === "session_start" ? starts : name === "session_shutdown" ? shuts : [];
            list.push(callback); return () => { const index = list.indexOf(callback); if (index >= 0) list.splice(index, 1); };
        },
        registerCommand() {}, registerFlag() {}, registerMarkdownTransformer() {}, getFlag() {}, registerTool() {}, registerToolRenderer() {},
    };
    const pi = rawPi as unknown as ExtensionAPI;
    let activePanel: TaskPanel | undefined;
    try {
        Object.assign(h.ctx, { cwd: dir, thinkingLevel: "off" });
        Object.assign(h.ctx.ui, { setToolsExpanded() {}, setWorkingVisible() {} });
        beautify(pi);
        const identity = { sourceId: "shell", taskId: "fg", runId: "1" };
        const first: TaskView = { ...identity, key: taskKey(identity), title: "first", kind: "shell", status: "running", executionMode: "foreground", waitCount: 1, stats: {}, artifacts: [], capabilities: { stop: true, details: true } };
        const second = { ...first, taskId: "second", key: taskKey({ ...identity, taskId: "second" }), title: "second" };
        h.coordinator.registerSource({ sourceId: "shell", revision: 0, list: () => [first, second], detail: () => ({ text: "output" }), stop: () => true, subscribe: () => () => {}, dispose() {} });
        const wait = h.coordinator.registerWait({ identity, label: "foreground", kind: "launch" });
        h.ctx.ui.custom = async <T>(factory: Parameters<ExtensionContext["ui"]["custom"]>[0]) => new Promise<T>(resolve => {
            let lease: ReturnType<typeof h.tui.showOverlay> | undefined;
            let completed = false;
            const component = factory(h.tui, themeSdk.theme, h.keys, (value: unknown) => { completed = true; lease?.hide(); resolve(value as T); });
            assert.ok(!(component instanceof Promise));
            if (completed) return; // Synchronous capture probe is never mounted.
            activePanel = component as TaskPanel;
            lease = h.tui.showOverlay(activePanel);
        });
        const owner = createTaskUIOwner(pi, h.coordinator, h.lifecycle, DEFAULTS);
        registerDownOpener(pi, h.lifecycle, true, owner);
        for (const start of starts) await start({}, h.ctx);
        const editor = h.editor; assert.match(editor.render(80).join("\n"), /❯/);
        const input = editor.handleInput;
        for (const start of starts) await start({}, h.ctx);
        assert.equal(h.editor, editor); assert.equal(editor.handleInput, input);
        h.dispatch(DOWN); assert.ok(activePanel); assert.equal(owner.canOpen(), false); assert.equal(h.coordinator.waitCount, 1);
        h.dispatch(DOWN); assert.equal(activePanel.model.selected?.taskId, "second"); assert.equal(wait.settled, false);
        h.dispatch("\x1b"); await pause(); assert.equal(h.tui.getFocusedComponent(), editor); assert.equal(owner.canOpen(), true);
        assert.equal(wait.settled, false); await h.lifecycle.shutdown();
        for (const shut of shuts) await shut({}, h.ctx);
        assert.equal(h.coordinator.waitCount, 0); assert.equal(h.counts.raw, 0);
    } finally {
        activePanel?.dispose(); await h.dispose();
        rmSync(dir, { recursive: true, force: true });
    }
});

void it("later same-object factory does not stack input leases; descriptor ownership and scoped host setters are restored", async () => {
    const h = harness();
    try {
        const editor = h.editor;
        h.ctx.ui.setEditorComponent(() => editor);
        const originals = ["setText", "setAutocompleteProvider", "setPaddingX", "setAutocompleteMaxVisible", "onSubmit", "onChange", "borderColor", "actionHandlers", "onEscape", "onCtrlD", "onPasteImage", "onExtensionShortcut"];
        const descriptors = originals.map(key => Object.getOwnPropertyDescriptor(editor, key));
        h.install(); await h.start();
        for (let i = 0; i < originals.length; i++) assert.deepEqual(Object.getOwnPropertyDescriptor(editor, originals[i]!), descriptors[i]);
        const input = editor.handleInput;
        h.ctx.ui.setEditorComponent(h.ctx.ui.getEditorComponent()); assert.equal(editor.handleInput, input);
        editor.setText("draft"); editor.handleInput("\x1b[D"); const cursor = editor.getCursor();
        const setText = editor.setText;
        editor.setText("draft"); assert.notDeepEqual(editor.getCursor(), cursor); assert.equal(editor.setText, setText);
        // A later owner changes attributes without changing the function: do not remove it.
        Object.defineProperty(editor, "handleInput", { value: input, enumerable: true, writable: true, configurable: true });
        await h.lifecycle.shutdown(); assert.equal(Object.getOwnPropertyDescriptor(editor, "handleInput")?.enumerable, true);
        assert.equal(editor.handleInput, input); editor.setText(""); editor.handleInput(DOWN); assert.equal(h.opens, 0);
    } finally { await h.dispose(); }
});

void it("unsupported accessor live editor is diagnosed without invoking private setters or changing its methods", async () => {
    const h = harness();
    try {
        const editor = h.editor, method = editor.handleInput;
        let writes = 0;
        const original = editor.setText;
        Object.defineProperty(editor, "setText", { configurable: true, get: () => original, set: () => { writes++; } });
        const previousFactory = h.ctx.ui.getEditorComponent();
        const cursor = editor.getCursor();
        h.install(); await h.start();
        assert.equal(writes, 0); assert.equal(editor.handleInput, method); assert.equal(h.editor, editor);
        assert.equal(h.ctx.ui.getEditorComponent(), previousFactory, "failed preflight must not replace the factory");
        assert.deepEqual(h.host.editorContainer.children, [editor], "failed Down installation preserves the mounted editor");
        assert.ok(h.host.editorContainer.render(80).length > 0);
        assert.equal(h.tui.getFocusedComponent(), editor); assert.deepEqual(editor.getCursor(), cursor);
        editor.handleInput("still editing"); assert.equal(editor.getText(), "still editing");
        assert.equal(h.handlers.size, 0); editor.handleInput(DOWN); assert.equal(h.opens, 0);
    } finally { await h.dispose(); }
});

void it("Down preflight with an existing overlay never hides it or mutates the mounted editor", async () => {
    const h = harness();
    try {
        const editor = h.editor, input = editor.handleInput, previous = h.ctx.ui.getEditorComponent();
        const overlay = { focused: false, invalidate() {}, render: () => ["existing selector"], handleInput() {} };
        const handle = h.tui.showOverlay(overlay);
        h.install(); await h.start();
        assert.equal(h.tui.hasOverlay(), true); assert.equal(h.tui.getFocusedComponent(), overlay);
        assert.deepEqual(h.host.editorContainer.children, [editor]);
        assert.equal(h.ctx.ui.getEditorComponent(), previous); assert.equal(editor.handleInput, input);
        handle.hide(); h.tui.setFocus(editor); editor.handleInput("still usable");
        assert.equal(editor.getText(), "still usable"); assert.equal(h.opens, 0);
    } finally { await h.dispose(); }
});

void it("non-configurable input failure rolls back public handoff properties before any host unmount", async () => {
    const h = harness();
    try {
        const editor = h.editor, input = editor.handleInput;
        editor.setText("draft"); editor.handleInput("\x1b[D"); const cursor = editor.getCursor();
        Object.defineProperty(editor, "handleInput", { value: input, writable: true, configurable: false });
        const descriptor = Object.getOwnPropertyDescriptor(editor, "setText");
        h.install(); await h.start();
        assert.deepEqual(h.host.editorContainer.children, [editor]); assert.ok(h.host.editorContainer.render(80).length > 0);
        assert.equal(h.tui.getFocusedComponent(), editor); assert.equal(h.ctx.ui.getEditorComponent(), undefined);
        assert.deepEqual(Object.getOwnPropertyDescriptor(editor, "setText"), descriptor);
        assert.deepEqual(editor.getCursor(), cursor); assert.equal(editor.handleInput, input);
        editor.handleInput("!"); assert.equal(editor.getText(), "draf!t"); assert.equal(h.opens, 0);
    } finally { await h.dispose(); }
});

void it("disabled/noninteractive/missing editor APIs do not access or install; reentrant setter close/throw leaves no active lease", async () => {
    const disabled = harness();
    try { disabled.install(false); await disabled.start(); assert.equal(disabled.handlers.size, 0); } finally { await disabled.dispose(); }
    for (const variant of ["print", "minimal", "close", "throw", "get-close"]) {
        const h = harness();
        try {
            const e = h.editor, original = e.handleInput, setText = e.setText;
            if (variant === "print") Object.assign(h.ctx, { mode: "print" });
            if (variant === "minimal") Object.assign(h.ctx.ui, { getEditorComponent: undefined, setEditorComponent: undefined });
            if (variant === "get-close") h.ctx.ui.getEditorComponent = () => { void h.lifecycle.shutdown(); return undefined; };
            if (variant === "close" || variant === "throw") {
                const setter = h.ctx.ui.setEditorComponent;
                h.ctx.ui.setEditorComponent = factory => { setter(factory); void h.lifecycle.shutdown(); if (variant === "throw") throw new Error("host setter failure"); };
            }
            h.install(); await h.start();
            assert.equal(e.setText, setText); assert.equal(e.handleInput, original);
            e.setText(""); e.handleInput(DOWN); assert.equal(h.opens, 0); assert.equal(h.counts.raw, 0);
        } finally { await h.dispose(); }
    }
});
