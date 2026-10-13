import assert from "node:assert/strict";
import { after, test } from "node:test";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
type FactoryArgs = Parameters<NonNullable<Parameters<ExtensionContext["ui"]["setEditorComponent"]>[0]>>;
import { adaptPrettyLifecycle, createDecorator } from "../editor.ts";
import { cleanup, makeHost, loadUnified, pretty, inputHistory, createPromptEditorClass, sdk, themeSdk, tuiSdk, StatusIndicator } from "./harness.mjs";

after(cleanup);

async function install(h: ReturnType<typeof makeHost>, order: string, decorated: boolean) {
  const installPretty = () => pretty(decorated ? adaptPrettyLifecycle(h.pi as unknown as ExtensionAPI, createPromptEditorClass) : h.pi);
  if (order === "history-first") { inputHistory(h.pi); await installPretty(); }
  else { await installPretty(); inputHistory(h.pi); }
  await h.fire("session_start");
}

const up = "\x1b[A";
const down = "\x1b[B";

for (const order of ["history-first", "pretty-first"]) {
  test(`original Pretty ${order}: characterize Up history and independent Alt+R`, async () => {
    const h = makeHost(`original-${order}`);
    h.seed("previous session older", "previous session latest");
    try {
      await install(h, order, false);
      assert.equal(h.editor.getText(), "");
      h.editor.handleInput(up);
      assert.equal(h.editor.getText(), order === "history-first" ? "" : "previous session latest");
      if (process.env.PROTOTYPE_REQUIRE_ORIGINAL_HISTORY === "1") {
        // Deliberate red run: acceptance assertion fails against original history-first integration.
        assert.equal(h.editor.getText(), "previous session latest");
      }
      assert.ok(h.editor.render(60).join("\n").includes("❯"));
      await h.shortcuts.get("alt+r")!(h.ctx);
      assert.equal(h.editor.getText(), "previous session latest");
    } finally { await h.fire("session_shutdown"); h.dispose(); }
  });

  test(`decorated ${order}: cold/new/reload Up/Down, current history and Alt+R`, async () => {
    const h = makeHost(`decorated-${order}`);
    h.seed("previous session older", "previous session latest");
    try {
      await install(h, order, true);
      for (const phase of ["cold", "new", "reload"]) {
        if (phase !== "cold") {
          h.resetExtensionUI();
          await h.fire("session_shutdown");
          if (phase === "new") {
            h.resetEmptySession();
            assert.deepEqual(h.ctx.sessionManager.getBranch(), []);
          } else {
            h.editor.setText("");
          }
          // Both /new and /reload get freshly activated extension closures, not only another event.
          h.replaceExtensionRuntime();
          await install(h, order, true);
        }
        assert.equal(h.editor.getText(), "");
        h.editor.handleInput(up);
        assert.equal(h.editor.getText(), "previous session latest");
        h.editor.handleInput(up);
        assert.equal(h.editor.getText(), "previous session older");
        h.editor.handleInput(down);
        assert.equal(h.editor.getText(), "previous session latest");
        h.editor.handleInput(down);
        assert.equal(h.editor.getText(), "");
        h.editor.addToHistory("current session input");
        h.editor.handleInput(up);
        assert.equal(h.editor.getText(), "current session input");
        h.editor.setText("");
        await h.shortcuts.get("alt+r")!(h.ctx);
        assert.equal(h.editor.getText(), "previous session latest");
      }
    } finally { await h.fire("session_shutdown"); h.dispose(); }
  });
  test(`working status ${order}: real Pretty config, embedded start/stop and shutdown`, async () => {
    const h = makeHost(`status-${order}`);
    h.seed("status history");
    try {
      await install(h, order, true);
      // The accepted external config field is text; texts belongs to resolved internal settings.
      assert.equal(h.host.workingMessage, "");
      assert.ok(h.host.workingIndicatorOptions!.frames!.some((frame: string) => frame.includes("PROTOTYPE-WORKING")));
      await h.fire("agent_start");
      assert.equal(h.host.activeWorkingIndicatorEmbedded, true);
      assert.match(h.editor.render(80)[0]!, /PROTOTYPE-WORKING/);
      await h.fire("agent_end");
      assert.equal(h.host.activeStatusIndicator, undefined);
      assert.doesNotMatch(h.editor.render(80)[0]!, /PROTOTYPE-WORKING/);
      await h.fire("agent_start");
      assert.match(h.editor.render(80)[0]!, /PROTOTYPE-WORKING/);
      await h.fire("session_shutdown");
      assert.equal(h.host.activeStatusIndicator, undefined);
      assert.equal(h.host.workingIndicatorOptions, undefined);
      assert.equal(h.host.workingMessage, undefined);
    } finally { await h.fire("session_shutdown"); h.dispose(); }
  });
}

test("instance identity, receiver/subclass, draft/cursor, autocomplete and host app handlers", async () => {
  const h = makeHost("subclass");
  const instances: InstanceType<typeof sdk.CustomEditor>[] = [];
  class SpecializedEditor extends sdk.CustomEditor {
    calls = 0;
    override handleInput(data: string) { this.calls++; super.handleInput(data); }
  }
  const factory = (...args: FactoryArgs) => {
    const editor = new SpecializedEditor(...args, { embedWorkingStatus: true });
    editor.addToHistory("subclass history");
    instances.push(editor);
    return editor;
  };
  h.ctx.ui.setEditorComponent(factory);
  try {
    await pretty(adaptPrettyLifecycle(h.pi as unknown as ExtensionAPI, createPromptEditorClass));
    await h.fire("session_start");
    assert.equal(h.editor, instances.at(-1));
    assert.ok(h.editor instanceof SpecializedEditor);
    h.editor.handleInput(up);
    assert.equal(h.editor.getText(), "subclass history");
    h.editor.setText("first\nsecond中");
    h.editor.handleInput("\x1b[D");
    const cursor = h.editor.getCursor();
    const text = h.editor.getText();
    assert.ok(h.editor.render(35).some((line: string) => line.includes(tuiSdk.CURSOR_MARKER)));
    assert.deepEqual(h.editor.getCursor(), cursor);
    assert.equal(h.editor.getText(), text);
    h.editor.setText("co");
    h.editor.handleInput("\t");
    await new Promise((resolve) => setTimeout(resolve, 150));
    assert.equal(h.editor.getText(), "completed");
    h.editor.handleInput("\x1b");
    h.editor.setText("");
    h.editor.handleInput("\x04");
    h.editor.handleInput("\x16");
    h.editor.handleInput("\x10");
    h.editor.handleInput("\x1bx");
    assert.deepEqual([h.counts.escape, h.counts.exit, h.counts.paste, h.counts.model, h.counts.extension], [1, 1, 1, 1, 1]);
    h.editor.setText("submitted now");
    h.editor.handleInput("\r");
    assert.deepEqual(h.counts.submit, ["submitted now"]);
    assert.ok(h.counts.change > 0);
  } finally { await h.fire("session_shutdown"); h.dispose(); }
});

test("same decorator is idempotent and restores hooks without stealing a later render wrapper", () => {
  const h = makeHost("lease");
  const editor = h.editor;
  const originalRender = editor.render;
  editor.setText("draft\nsecond中");
  editor.handleInput("\x1b[D");
  const draft = editor.getText();
  const cursor = editor.getCursor();
  const decorate = createDecorator(createPromptEditorClass);
  const lease = decorate(editor, [h.tui, themeSdk.getEditorTheme(), h.kb], (icon: string) => icon)!;
  assert.equal(decorate(editor, [h.tui, themeSdk.getEditorTheme(), h.kb], (icon: string) => icon), lease);
  assert.equal(editor.getText(), draft);
  assert.deepEqual(editor.getCursor(), cursor);
  editor.setPaddingX(2);
  const wrapped = editor.render;
  const later = (width: number) => wrapped.call(editor, width);
  editor.render = later;
  lease.dispose();
  lease.dispose();
  assert.equal(editor.render, later);
  assert.equal(editor.getPaddingX(), 2);
  assert.equal(editor.getText(), draft);
  assert.deepEqual(editor.getCursor(), cursor);
  assert.deepEqual(editor.render(40), originalRender.call(editor, 40));
  h.dispose();
});

test("shutdown preserves later factory ownership; captured wrappers become pass-through on reload", async () => {
  const h = makeHost("ownership");
  h.seed("kept history");
  try {
    await install(h, "history-first", true);
    const captured = h.ctx.ui.getEditorComponent()!;
    const later = (...args: FactoryArgs) => captured(...args);
    h.ctx.ui.setEditorComponent(later);
    const editor = h.editor;
    await h.fire("session_shutdown");
    assert.equal(h.ctx.ui.getEditorComponent(), later);
    assert.equal(h.editor, editor);
    assert.ok(!h.editor.render(40).join("\n").includes("❯"));
    h.ctx.ui.setEditorComponent(later);
    assert.ok(!h.editor.render(40).join("\n").includes("❯"));
    await h.fire("session_start");
    assert.ok(h.editor.render(40).join("\n").includes("❯"));
  } finally { await h.fire("session_shutdown"); h.dispose(); }
});

test("supported render matches real Pretty; extreme CJK failures are characterized with SDK controls", () => {
  const h = makeHost("render");
  const args = [h.tui, themeSdk.getEditorTheme(), h.kb] as const;
  const Prompt = createPromptEditorClass(sdk.CustomEditor, (icon: string) => icon);
  const expected = new Prompt(...args);
  const actual = new sdk.CustomEditor(...args, { embedWorkingStatus: true });
  const plain = new sdk.CustomEditor(...args, { embedWorkingStatus: true });
  const lease = createDecorator(createPromptEditorClass)(actual, [...args], (icon: string) => icon)!;
  // SDK 1.1.0 recursively re-wraps a single wide grapheme if layoutWidth < 2.
  // Pretty reserves prompt padding, so its unsupported widths differ from plain SDK.
  const layoutWidth = (width: number, padding: number) => {
    const effective = Math.min(padding, Math.max(0, Math.floor((width - 1) / 2)));
    return Math.max(1, width - effective * 2 - (effective ? 0 : 1));
  };
  let unsupported = 0;
  let supported = 0;
  let cursorOverflow = 0;
  try {
    for (const text of ["", "hello 中世界", Array.from({ length: 50 }, (_, i) => `line ${i}`).join("\n")]) {
      for (const editor of [actual, expected, plain]) { editor.setText(text); editor.focused = true; }
      for (const padding of [0, 1, 3]) {
        for (const editor of [actual, expected, plain]) editor.setPaddingX(padding);
        for (const width of [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 30, 80]) {
          const details = `width=${width} padding=${padding}`;
          const wide = text.includes("中");
          const plainUnsupported = wide && layoutWidth(width, padding) < 2;
          const asciiCursorOverflow = text.startsWith("line") && width === 1;
          const prettyPadding = padding + 3 + (padding === 0 ? 1 : 0);
          const prettyUnsupported = wide && layoutWidth(width, prettyPadding) < 2;
          if (plainUnsupported) {
            assert.throws(() => plain.render(width), { name: "RangeError", message: /Maximum call stack size exceeded/ }, `SDK ${details}`);
          } else {
            const plainLines = plain.render(width);
            if (asciiCursorOverflow) {
              // A focused end-of-line cursor needs an extra cell; SDK and Pretty both overflow at width 1.
              assert.equal(Math.max(...plainLines.map(tuiSdk.visibleWidth)), 2, `SDK cursor limit ${details}`);
            } else {
              assert.ok(plainLines.every((line: string) => tuiSdk.visibleWidth(line) <= width), `SDK ${details}`);
            }
          }
          if (prettyUnsupported) {
            // These are explicit known-limit assertions, not skipped regression cases.
            assert.throws(() => expected.render(width), { name: "RangeError", message: /Maximum call stack size exceeded/ }, `Pretty ${details}`);
            assert.throws(() => actual.render(width), { name: "RangeError", message: /Maximum call stack size exceeded/ }, `adapter ${details}`);
            unsupported++;
          } else {
            const lines = actual.render(width);
            assert.deepEqual(lines, expected.render(width), details);
            if (asciiCursorOverflow) {
              assert.equal(Math.max(...lines.map(tuiSdk.visibleWidth)), 2, `Pretty/adapter cursor limit ${details}`);
              cursorOverflow++;
            } else {
              assert.ok(lines.every((line: string) => tuiSdk.visibleWidth(line) <= width), details);
              supported++;
            }
            if (text.startsWith("line") && width === 80) {
              assert.match(lines[0]!, /more/);
              assert.ok(!lines.join("\n").includes("❯"));
            }
          }
        }
      }
    }
    assert.equal(unsupported, 19);
    assert.equal(cursorOverflow, 3);
    assert.equal(supported, 104);
  } finally { lease.dispose(); h.dispose(); }
});

test("embedded working-status render matches real Pretty at supported narrow widths", () => {
  const h = makeHost("status-render");
  const args = [h.tui, themeSdk.getEditorTheme(), h.kb] as const;
  const Prompt = createPromptEditorClass(sdk.CustomEditor, (icon: string) => icon);
  const expected = new Prompt(...args);
  const actual = new sdk.CustomEditor(...args, { embedWorkingStatus: true });
  const lease = createDecorator(createPromptEditorClass)(actual, [...args], (icon: string) => icon)!;
  // One frame avoids a timer race while still using the SDK's real border/status logic.
  const status = new StatusIndicator("working", h.tui, (text: string) => text, (text: string) => text,
    "", { frames: ["⠋ PROTOTYPE-WORKING"], intervalMs: 1000 });
  try {
    actual.setWorkingStatusIndicator(status); expected.setWorkingStatusIndicator(status);
    for (const text of ["hello 中世界", Array.from({ length: 50 }, (_, i) => `line ${i}`).join("\n")]) {
      actual.setText(text); expected.setText(text);
      for (const width of [12, 20, 30, 80]) {
        const lines = actual.render(width);
        assert.deepEqual(lines, expected.render(width), `working width=${width}`);
        assert.ok(lines.every((line: string) => tuiSdk.visibleWidth(line) <= width));
      }
    }
    actual.setWorkingStatusIndicator(undefined); expected.setWorkingStatusIndicator(undefined);
    assert.deepEqual(actual.render(80), expected.render(80));
  } finally { status.dispose(); lease.dispose(); h.dispose(); }
});

test("non-embedded editor retains editing with a diagnostic fallback", () => {
  const h = makeHost("unsupported");
  const editor = new sdk.CustomEditor(h.tui, themeSdk.getEditorTheme(), h.kb);
  const diagnostics: string[] = [];
  assert.equal(createDecorator(createPromptEditorClass, (message) => diagnostics.push(message))(editor,
    [h.tui, themeSdk.getEditorTheme(), h.kb], (icon: string) => icon), undefined);
  assert.match(diagnostics[0]!, /embedded-status/);
  editor.handleInput("still editable");
  assert.equal(editor.getText(), "still editable");
  h.dispose();
});

for (const unsupported of ["readonly render", "missing hook", "nonembedded", "nonextensible"]) {
  test(`unsupported ${unsupported}: preflight is mutation-free and host history survives`, async () => {
    const h = makeHost(`fallback-${unsupported.replaceAll(" ", "-")}`);
    const instances: InstanceType<typeof sdk.CustomEditor>[] = [];
    const factory = (...args: FactoryArgs) => {
      const editor = new sdk.CustomEditor(...args, { embedWorkingStatus: unsupported !== "nonembedded" });
      editor.addToHistory("fallback history");
      if (unsupported === "readonly render") Object.defineProperty(editor, "render", { value: editor.render, writable: false });
      if (unsupported === "missing hook") {
        // A valid third-party renderer need not delegate SDK border hooks.
        editor.render = () => [`custom:${editor.getText()}`];
        Object.defineProperty(editor, "renderTopBorder", { value: undefined });
      }
      // Predeclare host-owned fields so nonextensibility only blocks decoration,
      // not the SDK's unrelated shortcut/autocomplete wiring.
      if (unsupported === "nonextensible") {
        editor.onEscape = () => {}; editor.onCtrlD = () => {}; editor.onPasteImage = () => {};
        editor.onExtensionShortcut = () => false;
        Object.preventExtensions(editor);
      }
      instances.push(editor);
      return editor;
    };
    h.ctx.ui.setEditorComponent(factory);
    const editor = h.editor;
    const padding = editor.getPaddingX();
    const originalRender = editor.render;
    const diagnostics: string[] = [];
    assert.equal(createDecorator(createPromptEditorClass, (text) => diagnostics.push(text))(editor,
      [h.tui, themeSdk.getEditorTheme(), h.kb], (icon: string) => icon), undefined);
    assert.equal(editor.getPaddingX(), padding);
    assert.equal(editor.render, originalRender);
    assert.equal(diagnostics.length, 1);
    try {
      await pretty(adaptPrettyLifecycle(h.pi as unknown as ExtensionAPI, createPromptEditorClass));
      await h.fire("session_start");
      assert.equal(h.editor, instances.at(-1));
      assert.equal(h.host.editorContainer.children.length, 1);
      h.editor.handleInput(up);
      assert.equal(h.editor.getText(), "fallback history");
      h.editor.handleInput(down);
      h.editor.handleInput("editing remains");
      assert.equal(h.editor.getText(), "editing remains");
      assert.ok(h.editor.render(80).join("\n").includes("editing remains"));
      assert.ok(h.diagnostics.some((message: string) => message.includes("fallback")));
    } finally { await h.fire("session_shutdown"); h.dispose(); }
  });
}

test("adapter constructor partial padding failure rolls back before any method installation", () => {
  const h = makeHost("constructor-failure");
  const editor = h.editor;
  editor.setPaddingX(2);
  const render = editor.render;
  const set = editor.setPaddingX;
  const diagnostics: string[] = [];
  const failPrompt = (Base: typeof sdk.CustomEditor) => class extends Base {
    constructor(...args: ConstructorParameters<typeof Base>) {
      super(...args);
      this.setPaddingX(9);
      throw new Error("constructor exploded after padding");
    }
  };
  assert.equal(createDecorator(failPrompt, (text) => diagnostics.push(text))(editor,
    [h.tui, themeSdk.getEditorTheme(), h.kb], (icon: string) => icon), undefined);
  assert.equal(editor.getPaddingX(), 2);
  assert.equal(editor.render, render);
  assert.equal(editor.setPaddingX, set);
  assert.match(diagnostics[0]!, /rolled back/);
  editor.handleInput("still works");
  assert.equal(editor.getText(), "still works");
  h.dispose();
});

for (const takeover of ["setter", "underlying value", "getter"]) {
  test(`cleanup respects later padding ${takeover} ownership (7 is not reset to 0)`, () => {
    const h = makeHost(`padding-${takeover}`);
    const editor = h.editor;
    const originalSet = editor.setPaddingX;
    const originalGet = editor.getPaddingX;
    const lease = createDecorator(createPromptEditorClass)(editor,
      [h.tui, themeSdk.getEditorTheme(), h.kb], (icon: string) => icon)!;
    if (takeover === "setter") editor.setPaddingX = (padding: number) => originalSet.call(editor, padding);
    if (takeover === "getter") editor.getPaddingX = () => originalGet.call(editor);
    // The underlying value route intentionally bypasses our setter while retaining it.
    if (takeover === "underlying value") originalSet.call(editor, 7);
    else editor.setPaddingX(7);
    const physicalPadding = originalGet.call(editor);
    const laterGet = editor.getPaddingX;
    const laterSet = editor.setPaddingX;
    lease.dispose();
    assert.equal(originalGet.call(editor), physicalPadding);
    if (takeover === "setter") assert.equal(editor.setPaddingX, laterSet);
    if (takeover === "getter") assert.equal(editor.getPaddingX, laterGet);
    h.dispose();
  });
}

for (const failure of ["factory", "padding wiring", "after installation"]) {
  test(`host ${failure} failure rebuilds container/factory and permits a fresh install`, async () => {
    const h = makeHost(`host-failure-${failure}`);
    const created: InstanceType<typeof sdk.CustomEditor>[] = [];
    let broken = false;
    const previous = (...args: FactoryArgs) => {
      if (broken && failure === "factory") { broken = false; throw new Error("factory failed"); }
      const editor = new sdk.CustomEditor(...args, { embedWorkingStatus: true });
      editor.addToHistory("rollback history");
      if (broken && failure === "padding wiring") {
        broken = false;
        editor.setAutocompleteMaxVisible = () => { throw new Error("wiring failed after padding"); };
      }
      created.push(editor);
      return editor;
    };
    h.ctx.ui.setEditorComponent(previous);
    h.editor.setText("draft before host failure");
    const setter = h.ctx.ui.setEditorComponent;
    h.ctx.ui.setEditorComponent = (factory: Parameters<ExtensionContext["ui"]["setEditorComponent"]>[0]) => {
      setter(factory);
      if (broken && failure === "after installation") { broken = false; throw new Error("host failed after installation"); }
    };
    try {
      await pretty(adaptPrettyLifecycle(h.pi as unknown as ExtensionAPI, createPromptEditorClass));
      broken = true;
      await h.fire("session_start");
      assert.equal(h.ctx.ui.getEditorComponent(), previous);
      assert.deepEqual(h.host.editorContainer.children, [h.editor]);
      assert.equal(h.editor.getText(), "draft before host failure");
      assert.equal(h.editor.getPaddingX(), 0);
      h.editor.setText(""); h.editor.handleInput(up);
      assert.equal(h.editor.getText(), "rollback history");
      assert.ok(h.diagnostics.some((message: string) => message.includes("host installation failed")));
      // Deactivated failed factories/leases do not poison the next runtime.
      await h.fire("session_shutdown");
      h.replaceExtensionRuntime();
      await pretty(adaptPrettyLifecycle(h.pi as unknown as ExtensionAPI, createPromptEditorClass));
      await h.fire("session_start");
      assert.match(h.editor.render(80).join("\n"), /❯/);
      await h.fire("session_shutdown");
      assert.ok(created.every((editor) => !editor.render(80).join("\n").includes("❯")));
    } finally { await h.fire("session_shutdown"); h.dispose(); }
  });
}

test("host rollback falls back to default when the previous factory is now broken", async () => {
  const h = makeHost("host-default-rollback");
  let broken = false;
  const previous = (...args: FactoryArgs) => {
    if (broken) throw new Error("previous factory unavailable");
    return new sdk.CustomEditor(...args, { embedWorkingStatus: true });
  };
  h.ctx.ui.setEditorComponent(previous);
  h.editor.setText("default recovery draft");
  try {
    await pretty(adaptPrettyLifecycle(h.pi as unknown as ExtensionAPI, createPromptEditorClass));
    broken = true;
    await h.fire("session_start");
    assert.equal(h.ctx.ui.getEditorComponent(), undefined);
    assert.equal(h.editor, h.host.defaultEditor);
    assert.deepEqual(h.host.editorContainer.children, [h.editor]);
    assert.equal(h.editor.getText(), "default recovery draft");
    h.editor.handleInput("!");
    assert.equal(h.editor.getText(), "default recovery draft!");
  } finally { await h.fire("session_shutdown"); h.dispose(); }
});

test("missing host getter or setter does not replace the editor", async () => {
  for (const missing of ["getEditorComponent", "setEditorComponent"]) {
    const h = makeHost(`missing-${missing}`);
    const editor = h.editor;
    Reflect.set(h.ctx.ui, missing, undefined);
    try {
      await pretty(adaptPrettyLifecycle(h.pi as unknown as ExtensionAPI, createPromptEditorClass));
      await h.fire("session_start");
      assert.equal(h.editor, editor);
      editor.handleInput("safe");
      assert.equal(editor.getText(), "safe");
      assert.ok(h.diagnostics.some((message: string) => message.includes("lacks editor factory")));
    } finally { await h.fire("session_shutdown"); h.dispose(); }
  }
});

for (const order of ["history-first", "pretty-first"]) {
  test(`bounded repeated actual reset-before-shutdown reload ${order}`, async () => {
    const h = makeHost(`repeated-${order}`);
    h.seed("repeated history");
    try {
      for (let cycle = 0; cycle < 25; cycle++) {
        await install(h, order, true);
        const oldEditor = h.editor;
        assert.equal((h.editor.render(80).join("\n").match(/❯/g) ?? []).length, 1);
        h.editor.setText(""); h.editor.handleInput(up);
        assert.equal(h.editor.getText(), "repeated history");
        await h.fire("agent_start");
        h.resetExtensionUI();
        assert.equal(h.ctx.ui.getEditorComponent(), undefined);
        await h.fire("session_shutdown");
        assert.equal(h.ctx.ui.getEditorComponent(), undefined);
        // With no previous factory we deliberately use unmodified native Pretty.
        // Only our own bridge leases are removable; discarded native instances
        // retain their class, but neither owns a live controller after reset.
        if (order === "history-first") assert.doesNotMatch(oldEditor.render(80).join("\n"), /❯/);
        assert.equal(h.host.activeStatusIndicator, undefined);
        assert.deepEqual(h.host.editorContainer.children, [h.host.defaultEditor]);
        h.editor.setText("");
        h.replaceExtensionRuntime();
      }
    } finally { await h.fire("session_shutdown"); h.dispose(); }
  });
}

test("independent Alt+R fixture supports query, older/newer, cancel and branch priority", async () => {
  const h = makeHost("search-behavior");
  h.seed("older selected", "latest selected");
  try {
    await install(h, "history-first", true);
    h.searchWith("os", "\r");
    await h.shortcuts.get("alt+r")!(h.ctx);
    assert.equal(h.editor.getText(), "older selected");
    h.searchWith(up, down, "\r");
    await h.shortcuts.get("alt+r")!(h.ctx);
    assert.equal(h.editor.getText(), "latest selected");
    h.editor.setText("keep on cancel");
    h.searchWith("\x1b");
    await h.shortcuts.get("alt+r")!(h.ctx);
    assert.equal(h.editor.getText(), "keep on cancel");
    h.ctx.sessionManager.appendMessage({ role: "user", content: "current branch", timestamp: Date.now() });
    h.searchWith("\r");
    await h.shortcuts.get("alt+r")!(h.ctx);
    assert.equal(h.editor.getText(), "current branch");
  } finally { await h.fire("session_shutdown"); h.dispose(); }
});

test("partial method installation (Proxy writes then throws) rolls back methods and padding", () => {
  const h = makeHost("method-rollback");
  const editor = h.editor;
  editor.setPaddingX(3);
  const original = { render: editor.render, getPaddingX: editor.getPaddingX, setPaddingX: editor.setPaddingX };
  let once = true;
  const proxied = new Proxy(editor, {
    set(target, key, value, receiver) {
      const result = Reflect.set(target, key, value, receiver);
      if (key === "getPaddingX" && once) { once = false; throw new Error("mutation then failure"); }
      return result;
    },
  });
  const diagnostics: string[] = [];
  const decorate = createDecorator(createPromptEditorClass, (message) => diagnostics.push(message));
  assert.equal(decorate(proxied, [h.tui, themeSdk.getEditorTheme(), h.kb], (icon: string) => icon), undefined);
  assert.equal(editor.getPaddingX(), 3);
  for (const key of ["render", "getPaddingX", "setPaddingX"] as const) assert.equal(editor[key], original[key]);
  assert.match(diagnostics[0]!, /rolled back/);
  const lease = decorate(proxied, [h.tui, themeSdk.getEditorTheme(), h.kb], (icon: string) => icon)!;
  assert.match(editor.render(80).join("\n"), /❯/);
  lease.dispose();
  h.dispose();
});

test("later border methods survive cleanup; captured visual methods become pass-through", () => {
  const h = makeHost("border-ownership");
  const editor = h.editor;
  const hooks = editor as unknown as { renderTopBorder(width: number, hidden: number): string };
  const original = hooks.renderTopBorder;
  const lease = createDecorator(createPromptEditorClass)(editor,
    [h.tui, themeSdk.getEditorTheme(), h.kb], (icon: string) => icon)!;
  const captured = hooks.renderTopBorder;
  const later = (width: number, hidden: number) => captured.call(editor, width, hidden);
  hooks.renderTopBorder = later;
  lease.dispose();
  assert.equal(hooks.renderTopBorder, later);
  assert.equal(hooks.renderTopBorder(40, 0), original.call(editor, 40, 0));
  h.dispose();
});

test("custom nondelegating render preserves original receiver and content", () => {
  const h = makeHost("custom-render");
  class CustomRender extends sdk.CustomEditor {
    override render(_width: number) { return [`custom:${this.getText()}`]; }
  }
  const editor = new CustomRender(h.tui, themeSdk.getEditorTheme(), h.kb, { embedWorkingStatus: true });
  editor.setText("unchanged");
  const lease = createDecorator(createPromptEditorClass)(editor,
    [h.tui, themeSdk.getEditorTheme(), h.kb], (icon: string) => icon)!;
  assert.deepEqual(editor.render(40), ["custom:unchanged"]);
  editor.handleInput("!");
  assert.deepEqual(editor.render(40), ["custom:unchanged!"]);
  lease.dispose();
  h.dispose();
});

test("non-TUI Pretty lifecycle leaves existing editor/factory alone", async () => {
  const h = makeHost("non-tui");
  Reflect.set(h.ctx, "mode", "rpc");
  const editor = h.editor;
  const factory = h.ctx.ui.getEditorComponent();
  try {
    await pretty(adaptPrettyLifecycle(h.pi as unknown as ExtensionAPI, createPromptEditorClass));
    await h.fire("session_start");
    assert.equal(h.editor, editor);
    assert.equal(h.ctx.ui.getEditorComponent(), factory);
    assert.equal(h.host.workingIndicatorOptions, undefined);
  } finally { await h.fire("session_shutdown"); h.dispose(); }
});

test("production bash-unified keeps sole bgTasks bash ownership and decorated history", async () => {
  const h = makeHost("production-wrapper");
  const disabled = process.env.PRETTY_DISABLE_TOOLS;
  process.env.PRETTY_DISABLE_TOOLS = "read,find,grep,ls";
  h.seed("production history");
  try {
    inputHistory(h.pi);
    const unified = await loadUnified();
    await unified(h.pi);
    const bash = h.tools.filter((tool: { name: string }) => tool.name === "bash");
    assert.equal(bash.length, 1);
    assert.ok(bash[0].parameters.properties.run_in_background);
    assert.match(bash[0].promptSnippet, /background|timeout/i);
    assert.equal(typeof bash[0].renderCall, "function");
    assert.deepEqual(h.tools.map((tool: { name: string }) => tool.name).sort(), ["bash", "bash_bg", "jobs", "monitor"]);
    await h.fire("session_start");
    h.editor.handleInput(up);
    assert.equal(h.editor.getText(), "production history");
    assert.match(h.editor.render(80).join("\n"), /❯/);
  } finally {
    process.env.PRETTY_DISABLE_TOOLS = disabled;
    await h.fire("session_shutdown");
    h.dispose();
  }
});

test("later freezing visual wrappers leaves safe inactive passthrough on cleanup", () => {
  const h = makeHost("frozen-cleanup");
  const editor = h.editor;
  const original = editor.render;
  const diagnostics: string[] = [];
  const lease = createDecorator(createPromptEditorClass, (text) => diagnostics.push(text))(editor,
    [h.tui, themeSdk.getEditorTheme(), h.kb], (icon: string) => icon)!;
  Object.defineProperty(editor, "render", { value: editor.render, writable: false, configurable: false });
  lease.dispose();
  assert.deepEqual(editor.render(80), original.call(editor, 80));
  assert.ok(diagnostics.some((message) => message.includes("inactive wrapper")));
  h.dispose();
});

test("accessor render is refused without invoking its setter or changing padding", () => {
  const h = makeHost("accessor-render");
  const editor = h.editor;
  const render = editor.render;
  let writes = 0;
  Object.defineProperty(editor, "render", { get: () => render, set: () => { writes++; throw new Error("side effects"); } });
  const diagnostics: string[] = [];
  assert.equal(createDecorator(createPromptEditorClass, (text) => diagnostics.push(text))(editor,
    [h.tui, themeSdk.getEditorTheme(), h.kb], (icon: string) => icon), undefined);
  assert.equal(writes, 0);
  assert.equal(editor.getPaddingX(), 0);
  assert.equal(diagnostics.length, 1);
  h.dispose();
});

test("throwing preflight property is a diagnosed mutation-free fallback", () => {
  const h = makeHost("throwing-preflight");
  const editor = h.editor;
  Object.defineProperty(editor, "renderTopBorder", { get: () => { throw new Error("hook unavailable"); } });
  const diagnostics: string[] = [];
  assert.equal(createDecorator(createPromptEditorClass, (text) => diagnostics.push(text))(editor,
    [h.tui, themeSdk.getEditorTheme(), h.kb], (icon: string) => icon), undefined);
  assert.equal(editor.getPaddingX(), 0);
  assert.match(diagnostics[0]!, /preflight failed without mutation/);
  h.dispose();
});

test("repeated captured factory calls release the previous editor visual lease", async () => {
  const h = makeHost("single-live-lease");
  h.seed("lease history");
  try {
    await install(h, "history-first", true);
    const factory = h.ctx.ui.getEditorComponent()!;
    for (let i = 0; i < 20; i++) {
      const discarded = h.editor;
      h.ctx.ui.setEditorComponent(factory);
      assert.doesNotMatch(discarded.render(80).join("\n"), /❯/);
      assert.equal((h.editor.render(80).join("\n").match(/❯/g) ?? []).length, 1);
      h.editor.setText(""); h.editor.handleInput(up);
      assert.equal(h.editor.getText(), "lease history");
    }
  } finally { await h.fire("session_shutdown"); h.dispose(); }
});

test("shutdown setter throwing after restoring factory falls back without leaving an empty container", async () => {
  const h = makeHost("shutdown-setter-rollback");
  h.seed("shutdown history");
  try {
    await install(h, "history-first", true);
    const setter = h.ctx.ui.setEditorComponent;
    let once = true;
    h.ctx.ui.setEditorComponent = (factory: Parameters<ExtensionContext["ui"]["setEditorComponent"]>[0]) => {
      setter(factory);
      if (once) { once = false; throw new Error("shutdown setter failed after success"); }
    };
    await h.fire("session_shutdown");
    assert.equal(h.editor, h.host.defaultEditor);
    assert.equal(h.ctx.ui.getEditorComponent(), undefined);
    assert.deepEqual(h.host.editorContainer.children, [h.editor]);
    assert.ok(h.diagnostics.some((message: string) => message.includes("factory restore failed")));
    h.editor.handleInput("still editable");
    assert.equal(h.editor.getText(), "still editable");
  } finally { await h.fire("session_shutdown"); h.dispose(); }
});
