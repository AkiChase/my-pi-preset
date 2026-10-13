// A separate process: opaque forwarders must not retain the closed activation.
import assert from "node:assert/strict";
import { CustomEditor } from "@earendil-works/pi-coding-agent";
import { Container, TuiMainScreen } from "@earendil-works/pi-tui";
import { InteractiveMode, KeybindingsManager, themeSdk } from "../../task-ui/__tests__/editor-host.mjs";
import { registerAppearance } from "../editor/owner.ts";
function opaque(callback) { return function (...args) { return callback.apply(this, args); }; }
async function create() {
  const keys = new KeybindingsManager();
  const tui = new TuiMainScreen({ columns: 80, rows: 24, kittyProtocolActive: false, start() {}, stop() {}, async drainInput() {}, write() {}, moveBy() {}, hideCursor() {}, showCursor() {}, clearLine() {}, clearFromCursor() {}, clearScreen() {}, setTitle() {}, setProgress() {}, setProgramStatus() {} });
  tui.requestRender = () => {};
  const editor = new CustomEditor(tui, themeSdk.getEditorTheme(), keys);
  const host = { ui: tui, keybindings: keys, editor, defaultEditor: editor, editorContainer: new Container(), disposeActiveSelector() {}, setCustomEditorComponent: InteractiveMode.prototype.setCustomEditorComponent };
  host.editorContainer.addChild(editor); tui.setFocus(editor);
  const ctx = { mode: "tui", ui: InteractiveMode.prototype.createExtensionUIContext.call(host) };
  let start;
  const close = registerAppearance({ on(event, callback) { if (event === "session_start") start = callback; } });
  await start({}, ctx);
  const refs = [ctx, tui].map(value => new WeakRef(value));
  const render = opaque(editor.render), factory = opaque(ctx.ui.getEditorComponent());
  close(); tui.stop();
  return { refs, render, factory };
}
const captured = await create();
for (let index = 0; index < 12; index++) { await new Promise(resolve => setImmediate(resolve)); global.gc(); }
assert.deepEqual(captured.refs.map(ref => ref.deref() === undefined), [true, true]);
console.log("retired appearance/factory released 2/2 activation resources");
