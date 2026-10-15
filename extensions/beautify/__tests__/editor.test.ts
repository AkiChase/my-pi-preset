import assert from "node:assert/strict";
import { after, test } from "node:test";
import { stripVTControlCharacters as plain } from "node:util";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import beautify from "../index.ts";
import { registerAppearance } from "../editor/owner.ts";
import { decorateAppearance } from "../editor/appearance.ts";
import { registerDownOpener } from "../../task-ui/editor.ts";
import { TaskLifecycle } from "../../task-ui/lifecycle.ts";
import { TaskCoordinator } from "../../task-ui/coordinator.ts";
import { cleanup, makeHost, loadUnified, inputHistory, sdk, themeSdk, tuiSdk, StatusIndicator } from "./harness.mjs";
after(cleanup);
const up = "\x1b[A", down = "\x1b[B";
type FactoryArgs = Parameters<NonNullable<Parameters<ExtensionContext["ui"]["setEditorComponent"]>[0]>>;

for (const historyFirst of [true, false]) for (const downFirst of [true, false]) for (const enabled of [true, false]) {
  test(`actual host history=${historyFirst ? "first" : "last"}, Down=${downFirst ? "first" : "last"}/${enabled}`, async () => {
    const h = makeHost(`matrix-${historyFirst}-${downFirst}-${enabled}`);
    h.seed("older history", "latest history");
    let opens = 0;
    const lifecycle = new TaskLifecycle(new TaskCoordinator());
    const setup = () => {
      const pi = h.pi as unknown as ExtensionAPI;
      const appearance = () => beautify(pi);
      const downOwner = () => registerDownOpener(pi, lifecycle, enabled, { canOpen: () => true, async openPanel() { opens++; } });
      if (historyFirst) inputHistory(h.pi);
      if (downFirst) { downOwner(); appearance(); } else { appearance(); downOwner(); }
      if (!historyFirst) inputHistory(h.pi);
    };
    try {
      setup(); await h.fire("session_start");
      for (const phase of ["cold", "new", "reload"]) {
        if (phase !== "cold") {
          const old = h.editor;
          h.resetExtensionUI(); await h.fire("session_shutdown");
          assert.equal(h.ctx.ui.getEditorComponent(), undefined);
          assert.doesNotMatch(plain(old.render(80).join("\n")), /❯/);
          h.replaceExtensionRuntime(); h.resetEmptySession(); setup(); await h.fire("session_start");
        }
        assert.equal((plain(h.editor.render(80).join("\n")).match(/❯/g) ?? []).length, 1);
        h.editor.handleInput(up); assert.equal(h.editor.getText(), "latest history");
        h.editor.handleInput(up); assert.equal(h.editor.getText(), "older history");
        h.editor.handleInput(down); assert.equal(h.editor.getText(), "latest history");
        h.editor.handleInput(down); assert.equal(h.editor.getText(), "");
        h.searchWith("oh", "\r"); await h.shortcuts.get("alt+r")!(h.ctx); assert.equal(h.editor.getText(), "older history");
        h.editor.setText("draft"); h.searchWith("\x1b"); await h.shortcuts.get("alt+r")!(h.ctx); assert.equal(h.editor.getText(), "draft");
      }
      h.editor.setText(""); h.editor.handleInput(down); assert.equal(opens, enabled ? 1 : 0);
    } finally { await lifecycle.shutdown(); await h.fire("session_shutdown"); h.dispose(); }
  });
}

test("live handoff preserves subclass, cursor/undo, history draft, paste, autocomplete, IME and callbacks", async () => {
  const h = makeHost("live-state");
  class Special extends sdk.CustomEditor { calls = 0; override handleInput(data: string) { this.calls++; super.handleInput(data); } }
  h.ctx.ui.setEditorComponent((...args: FactoryArgs) => new Special(...args, { embedWorkingStatus: true }));
  const editor = h.editor;
  try {
    editor.setText("draft中"); editor.handleInput("\x1b[D"); editor.insertTextAtCursor("!");
    const cursor = editor.getCursor(), text = editor.getText(), submit = editor.onSubmit;
    registerAppearance(h.pi as unknown as ExtensionAPI); await h.fire("session_start");
    assert.equal(h.editor, editor); assert.ok(editor instanceof Special); assert.equal(editor.onSubmit, submit);
    assert.equal(editor.getText(), text); assert.deepEqual(editor.getCursor(), cursor);
    editor.handleInput("\x1f"); assert.equal(editor.getText(), "draft中");
    editor.addToHistory("saved"); editor.setText("history draft"); editor.render(80); editor.handleInput(""); editor.handleInput(up);
    assert.equal(editor.getText(), "saved"); editor.handleInput(down); assert.equal(editor.getText(), "history draft");
    editor.setText(""); editor.handleInput("\x1b[200~paste\n中"); editor.handleInput("\x1b[201~"); assert.match(editor.getText(), /paste\n中/);
    editor.setText("co"); editor.handleInput("\t"); await new Promise(resolve => setTimeout(resolve, 160)); assert.equal(editor.getText(), "completed");
    editor.setText("first\nsecond中"); const snapshot = editor.getCursor();
    const rows = editor.render(12); assert.ok(rows.some((line: string) => line.includes(tuiSdk.CURSOR_MARKER)));
    assert.deepEqual(editor.getCursor(), snapshot); assert.equal(editor.getText(), "first\nsecond中");
    // SDK cannot split a double-width grapheme into a one-column content area.
    // Keep a native control case rather than claiming this extension fixes that bug.
    const native = new sdk.CustomEditor(h.tui, themeSdk.getEditorTheme(), h.kb); native.setText("中");
    assert.throws(() => native.render(1), RangeError);
    editor.setText("中"); assert.throws(() => editor.render(1), RangeError);
    editor.setText("ascii");
    for (const width of [1, 2]) {
      native.setText("ascii"); native.setPaddingX(2); native.focused = true;
      const nativeWidths = native.render(width).map(tuiSdk.visibleWidth);
      assert.deepEqual(editor.render(width).map(tuiSdk.visibleWidth), nativeWidths);
    }
    for (const width of [8, 20, 40, 80, 120]) for (const line of editor.render(width)) assert.ok(tuiSdk.visibleWidth(line) <= width);
    editor.setText("中文");
    for (const width of [8, 20, 40, 80, 120]) for (const line of editor.render(width)) assert.ok(tuiSdk.visibleWidth(line) <= width);
    editor.setText(""); for (const key of ["\x1b", "\x04", "\x16", "\x10", "\x1bx"]) editor.handleInput(key);
    assert.deepEqual([h.counts.escape, h.counts.exit, h.counts.paste, h.counts.model, h.counts.extension], [1, 1, 1, 1, 1]);
    editor.setText("sent"); editor.handleInput("\r"); assert.deepEqual(h.counts.submit, ["sent"]);
  } finally { await h.fire("session_shutdown"); h.dispose(); }
});

test("appearance keeps native working status, scroll labels and only first prompt", () => {
  const h = makeHost("status"); const editor = h.editor;
  const release = decorateAppearance(editor);
  try {
    const status = new StatusIndicator("working", h.tui, (text: string) => text, (text: string) => text, "busy", { frames: ["*"], intervalMs: 1_000 });
    editor.setWorkingStatusIndicator(status); assert.match(plain(editor.render(80)[0]!), /busy/);
    editor.setText("a\nb\nc\nd\ne\nf\ng\nh\ni\nj");
    const lines = plain(editor.render(80).join("\n")); assert.match(lines, /↑/); assert.doesNotMatch(lines, /❯/);
    editor.setWorkingStatusIndicator(undefined); status.dispose();
    editor.setText("a\nb"); const rows = plain(editor.render(80).join("\n")); assert.equal((rows.match(/❯/g) ?? []).length, 1); assert.doesNotMatch(rows, /[╭╮╰╯]/);
  } finally { release(); h.dispose(); }
});

for (const shape of ["accessor", "locked", "missing", "nonextensible"]) test(`unsupported ${shape} leaves native UI mounted and usable`, async () => {
  const h = makeHost(`unsupported-${shape}`), editor = h.editor;
  if (shape === "accessor") Object.defineProperty(editor, "render", { get: () => sdk.CustomEditor.prototype.render, set() { throw new Error("must not write"); } });
  if (shape === "locked") Object.defineProperty(editor, "render", { value: editor.render, configurable: false });
  if (shape === "missing") Reflect.set(editor, "renderTopBorder", undefined);
  if (shape === "nonextensible") Object.preventExtensions(editor);
  const oldFactory = h.ctx.ui.getEditorComponent();
  try {
    registerAppearance(h.pi as unknown as ExtensionAPI); await h.fire("session_start");
    assert.equal(h.editor, editor); assert.equal(h.ctx.ui.getEditorComponent(), oldFactory); assert.deepEqual(h.host.editorContainer.children, [editor]);
    editor.handleInput("safe"); assert.equal(editor.getText(), "safe");
    if (shape !== "missing") assert.ok(editor.render(80).length);
  } finally { await h.fire("session_shutdown"); h.dispose(); }
});

for (const failure of ["after setter", "focus"]) test(`actual host partial ${failure} rollback keeps same UI, focus and undo`, async () => {
  const h = makeHost(`rollback-${failure}`), editor = h.editor;
  const setter = h.host.setCustomEditorComponent, focus = h.tui.setFocus;
  let once = true;
  if (failure === "after setter") h.host.setCustomEditorComponent = function (value: unknown) { setter.call(this, value); if (once) { once = false; throw new Error("after mount"); } };
  else h.tui.setFocus = function (component: Parameters<typeof focus>[0]) { focus.call(this, component); if (once) { once = false; throw new Error("focus failure"); } };
  try {
    editor.setText("draft"); editor.insertTextAtCursor("!"); const cursor = editor.getCursor();
    registerAppearance(h.pi as unknown as ExtensionAPI); await h.fire("session_start");
    assert.equal(h.editor, editor); assert.deepEqual(h.host.editorContainer.children, [editor]); assert.equal(h.tui.getFocusedComponent(), editor);
    assert.equal(editor.getText(), "draft!"); assert.deepEqual(editor.getCursor(), cursor); assert.ok(editor.render(80).length);
    editor.handleInput("\x1f"); assert.equal(editor.getText(), "draft"); assert.doesNotMatch(plain(editor.render(80).join("\n")), /❯/);
  } finally { await h.fire("session_shutdown"); h.dispose(); }
});

test("later opaque render/factory, user padding and reset-before-shutdown remain owned", async () => {
  const h = makeHost("later");
  try {
    registerAppearance(h.pi as unknown as ExtensionAPI); await h.fire("session_start");
    const captured = h.ctx.ui.getEditorComponent()!;
    const later = (...args: FactoryArgs) => captured(...args);
    h.ctx.ui.setEditorComponent(later); const editor = h.editor;
    editor.setPaddingX(3); const render = editor.render; const wrapped = function (width: number) { return render.call(editor, width); }; editor.render = wrapped;
    await h.fire("session_shutdown"); assert.equal(editor.render, wrapped); assert.equal(editor.getPaddingX(), 3); assert.equal(h.ctx.ui.getEditorComponent(), later);
    assert.doesNotMatch(plain(editor.render(80).join("\n")), /❯/);
    h.ctx.ui.setEditorComponent(later); assert.doesNotMatch(plain(h.editor.render(80).join("\n")), /❯/);
    h.resetExtensionUI(); await h.fire("session_shutdown"); assert.equal(h.ctx.ui.getEditorComponent(), undefined);
  } finally { h.dispose(); }
});

test("production composition registers only backend tools and native presentation stays independent", async () => {
  const h = makeHost("production"); h.seed("production history");
  try {
    inputHistory(h.pi); const unified = await loadUnified(); await unified(h.pi); beautify(h.pi as unknown as ExtensionAPI);
    assert.deepEqual(h.tools.map((tool: { name: string }) => tool.name).sort(), ["bash", "monitor", "subagent_message", "subagent_run", "subagent_workflow", "task_manage"]);
    const bash = h.tools.find((tool: { name: string }) => tool.name === "bash");
    assert.ok(bash.parameters.properties.run_in_background); assert.match(bash.promptSnippet, /background|timeout/i);
    await h.fire("session_start"); h.editor.handleInput(up); assert.equal(h.editor.getText(), "production history"); assert.match(plain(h.editor.render(80).join("\n")), /❯/);
  } finally { await h.fire("session_shutdown"); h.dispose(); }
});

test("opaque retired appearance/factory release context and TUI under real GC", async () => {
  const { spawnSync } = await import("node:child_process");
  const { fileURLToPath } = await import("node:url");
  const output = spawnSync(process.execPath, ["--expose-gc", fileURLToPath(new URL("./editor-retention.mjs", import.meta.url))], { encoding: "utf8", timeout: 15_000 });
  assert.equal(output.status, 0, output.stdout + output.stderr); assert.match(output.stdout, /2\/2/);
});

test("descriptor partial mutation and locked later visual wrapper restore safely", () => {
  const h = makeHost("descriptor-failure"), editor = h.editor;
  const render = editor.render;
  let once = true;
  const proxy = new Proxy(editor, { defineProperty(target, key, descriptor) {
    const result = Reflect.defineProperty(target, key, descriptor);
    if (key === "getPaddingX" && once) { once = false; throw new Error("defined then failed"); }
    return result;
  } });
  try {
    assert.throws(() => decorateAppearance(proxy)); assert.equal(editor.render, render); assert.equal(editor.getPaddingX(), 0);
    const close = decorateAppearance(editor);
    Object.defineProperty(editor, "render", { value: editor.render, configurable: false, writable: false });
    close(); assert.deepEqual(editor.render(80), render.call(editor, 80));
  } finally { h.dispose(); }
});

test("active overlay and non-TUI modes do not unmount or replace an editor", async () => {
  for (const mode of ["overlay", "rpc"]) {
    const h = makeHost(`mode-${mode}`), editor = h.editor;
    let overlay: ReturnType<typeof h.tui.showOverlay> | undefined;
    if (mode === "overlay") overlay = h.tui.showOverlay({ render: () => ["overlay"], invalidate() {} });
    else Reflect.set(h.ctx, "mode", "rpc");
    const factory = h.ctx.ui.getEditorComponent();
    try {
      registerAppearance(h.pi as unknown as ExtensionAPI); await h.fire("session_start");
      assert.equal(h.editor, editor); assert.equal(h.ctx.ui.getEditorComponent(), factory); assert.deepEqual(h.host.editorContainer.children, [editor]);
      if (overlay) assert.equal(h.tui.hasOverlay(), true);
      editor.handleInput("safe"); assert.equal(editor.getText(), "safe");
    } finally { overlay?.hide(); await h.fire("session_shutdown"); h.dispose(); }
  }
});

test("decoration during active history/paste/autocomplete preserves their native transient state", async () => {
  for (const state of ["history", "paste", "autocomplete"]) {
    const h = makeHost(`transient-${state}`), editor = h.editor;
    try {
      if (state === "history") { editor.addToHistory("saved"); editor.setText("draft"); editor.render(80); editor.handleInput("\x01"); editor.handleInput(up); assert.equal(editor.getText(), "saved"); }
      if (state === "paste") { editor.handleInput(`\x1b[200~${"line\n".repeat(150)}\x1b[201~`); assert.match(editor.getText(), /paste #/); }
      if (state === "autocomplete") { editor.setAutocompleteProvider({ ...h.provider, async getSuggestions() { return { items: [{ value: "one", label: "one" }, { value: "two", label: "two" }], prefix: "" }; } }); editor.handleInput("\t"); await new Promise(resolve => setTimeout(resolve, 5)); assert.equal(editor.isShowingAutocomplete(), true); }
      const before = editor.getExpandedText(), cursor = editor.getCursor();
      registerAppearance(h.pi as unknown as ExtensionAPI); await h.fire("session_start");
      assert.equal(h.editor, editor); assert.equal(editor.getExpandedText(), before); assert.deepEqual(editor.getCursor(), cursor);
      if (state === "history") { editor.handleInput(down); assert.equal(editor.getText(), "draft"); }
      if (state === "paste") { editor.handleInput("\r"); assert.equal(h.counts.submit[0], "line\n".repeat(150).trimEnd()); }
      if (state === "autocomplete") assert.equal(editor.isShowingAutocomplete(), true);
    } finally { await h.fire("session_shutdown"); h.dispose(); }
  }
});

for (const takeover of ["setter", "getter", "underlying"]) test(`cleanup retains later padding ${takeover} ownership`, () => {
  const h = makeHost(`padding-${takeover}`), editor = h.editor;
  const get = editor.getPaddingX, set = editor.setPaddingX;
  const close = decorateAppearance(editor);
  const laterSet = function (this: typeof editor, padding: number) { set.call(this, padding); };
  const laterGet = function (this: typeof editor) { return get.call(this); };
  try {
    if (takeover === "setter") editor.setPaddingX = laterSet;
    if (takeover === "getter") editor.getPaddingX = laterGet;
    set.call(editor, 7);
    close(); assert.equal(get.call(editor), 7);
    if (takeover === "setter") assert.equal(editor.setPaddingX, laterSet);
    if (takeover === "getter") assert.equal(editor.getPaddingX, laterGet);
  } finally { close(); h.dispose(); }
});

test("padding mutation then failure restores native methods, physical padding and usable UI", async () => {
  const h = makeHost("padding-partial"), editor = h.editor;
  const nativeSet = editor.setPaddingX, render = editor.render;
  let once = true;
  editor.setPaddingX = function (padding: number) { nativeSet.call(this, padding); if (once) { once = false; throw new Error("partial padding"); } };
  const setter = editor.setPaddingX;
  try {
    registerAppearance(h.pi as unknown as ExtensionAPI); await h.fire("session_start");
    assert.equal(h.editor, editor); assert.equal(editor.render, render); assert.equal(editor.setPaddingX, setter);
    assert.equal(editor.getPaddingX(), 0); assert.deepEqual(h.host.editorContainer.children, [editor]);
    editor.handleInput("safe"); assert.equal(editor.getText(), "safe"); assert.ok(editor.render(80).length);
  } finally { await h.fire("session_shutdown"); h.dispose(); }
});

test("captured future factory keeps a single live visual lease and history", async () => {
  const h = makeHost("repeated-factory"); h.seed("retained history");
  try {
    inputHistory(h.pi); registerAppearance(h.pi as unknown as ExtensionAPI); await h.fire("session_start");
    const factory = h.ctx.ui.getEditorComponent()!;
    for (let index = 0; index < 20; index++) {
      const old = h.editor;
      h.ctx.ui.setEditorComponent(factory);
      assert.doesNotMatch(plain(old.render(80).join("\n")), /❯/);
      assert.equal((plain(h.editor.render(80).join("\n")).match(/❯/g) ?? []).length, 1);
      h.editor.setText(""); h.editor.handleInput(up); assert.equal(h.editor.getText(), "retained history");
    }
  } finally { await h.fire("session_shutdown"); h.dispose(); }
});

test("handoff descriptor failure before setter restores appearance and all earlier handoff methods", async () => {
  const h = makeHost("handoff-failure"), editor = h.editor;
  const render = editor.render, setText = editor.setText, factory = h.ctx.ui.getEditorComponent();
  Object.defineProperty(editor, "onChange", { get: () => () => {}, configurable: false });
  try {
    editor.setText("draft"); const cursor = editor.getCursor();
    registerAppearance(h.pi as unknown as ExtensionAPI); await h.fire("session_start");
    assert.equal(h.editor, editor); assert.equal(editor.render, render); assert.equal(editor.setText, setText);
    assert.equal(editor.getPaddingX(), 0); assert.equal(h.ctx.ui.getEditorComponent(), factory);
    assert.deepEqual(editor.getCursor(), cursor); assert.deepEqual(h.host.editorContainer.children, [editor]);
    editor.handleInput("!"); assert.equal(editor.getText(), "draft!");
  } finally { await h.fire("session_shutdown"); h.dispose(); }
});

test("appearance preserves native non-finite padding behavior and never consumes source indentation after a later takeover", () => {
  const h = makeHost("padding-native-contract"), editor = h.editor;
  const nativeSet = editor.setPaddingX, nativeRender = editor.render;
  const close = decorateAppearance(editor);
  try {
    editor.setText("  indented");
    for (const value of [NaN, Infinity, -Infinity]) {
      editor.setPaddingX(value);
      assert.equal(editor.getPaddingX(), 0); assert.doesNotThrow(() => editor.render(80));
    }
    nativeSet.call(editor, 0);
    assert.deepEqual(editor.render(80), nativeRender.call(editor, 80));
  } finally { close(); h.dispose(); }
});

test("migrated Alt+R query, older/newer navigation, cancel and branch priority stay intact", async () => {
  const h = makeHost("search-priority"); h.seed("older selected", "latest selected");
  try {
    inputHistory(h.pi); registerAppearance(h.pi as unknown as ExtensionAPI); await h.fire("session_start");
    h.searchWith("os", "\r"); await h.shortcuts.get("alt+r")!(h.ctx); assert.equal(h.editor.getText(), "older selected");
    h.searchWith(up, down, "\r"); await h.shortcuts.get("alt+r")!(h.ctx); assert.equal(h.editor.getText(), "latest selected");
    h.editor.setText("keep on cancel"); h.searchWith("\x1b"); await h.shortcuts.get("alt+r")!(h.ctx); assert.equal(h.editor.getText(), "keep on cancel");
    h.ctx.sessionManager.appendMessage({ role: "user", content: "current branch", timestamp: Date.now() });
    h.searchWith("\r"); await h.shortcuts.get("alt+r")!(h.ctx); assert.equal(h.editor.getText(), "current branch");
  } finally { await h.fire("session_shutdown"); h.dispose(); }
});

test("migrated later border wrapper and nondelegating render retain their receivers and content", () => {
  const h = makeHost("custom-render-border"), editor = h.editor;
  const hooks = editor as typeof editor & { renderTopBorder(width: number, hidden: number): string };
  const original = hooks.renderTopBorder, close = decorateAppearance(editor), captured = hooks.renderTopBorder;
  const later = (width: number, hidden: number) => captured.call(editor, width, hidden);
  try {
    hooks.renderTopBorder = later; close(); assert.equal(hooks.renderTopBorder, later);
    assert.equal(hooks.renderTopBorder(40, 0), original.call(editor, 40, 0));
    class CustomRender extends sdk.CustomEditor { override render(_width: number) { return [`custom:${this.getText()}`]; } }
    const custom = new CustomRender(h.tui, themeSdk.getEditorTheme(), h.kb);
    custom.setText("unchanged"); const release = decorateAppearance(custom);
    try { assert.deepEqual(custom.render(40), ["custom:unchanged"]); custom.handleInput("!"); assert.deepEqual(custom.render(40), ["custom:unchanged!"]); } finally { release(); }
  } finally { close(); h.dispose(); }
});
