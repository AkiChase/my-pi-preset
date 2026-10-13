// Separate process with --expose-gc: opaque callers retain only our retired forwarders.
import assert from "node:assert/strict";
import { CustomEditor } from "@earendil-works/pi-coding-agent";
import { Container, TuiMainScreen } from "@earendil-works/pi-tui";
import { InteractiveMode, KeybindingsManager, themeSdk } from "./editor-host.mjs";
import { TaskCoordinator } from "../coordinator.ts";
import { TaskLifecycle } from "../lifecycle.ts";
import { registerDownOpener } from "../editor.ts";
function opaqueCall(callback) { return function (...args) { return callback.apply(this, args); }; }
async function create() {
    const keys = new KeybindingsManager();
    const tui = new TuiMainScreen({ columns: 80, rows: 24, kittyProtocolActive: false, start() {}, stop() {}, async drainInput() {}, write() {}, moveBy() {}, hideCursor() {}, showCursor() {}, clearLine() {}, clearFromCursor() {}, clearScreen() {}, setTitle() {}, setProgress() {}, setProgramStatus() {} });
    tui.requestRender = () => {};
    const editor = new CustomEditor(tui, themeSdk.getEditorTheme(), keys);
    const host = { ui: tui, keybindings: keys, editor, defaultEditor: editor, editorContainer: new Container(), disposeActiveSelector() {},
        showExtensionCustom: InteractiveMode.prototype.showExtensionCustom,
        setCustomEditorComponent: InteractiveMode.prototype.setCustomEditorComponent };
    tui.setFocus(editor);
    const ctx = { mode: "tui", ui: InteractiveMode.prototype.createExtensionUIContext.call(host) };
    const coordinator = new TaskCoordinator(), lifecycle = new TaskLifecycle(coordinator);
    let start;
    const panel = { canOpen: () => coordinator.list().length > 0, async openPanel() {} };
    registerDownOpener({ on(_event, callback) { start = callback; return () => { start = undefined; }; } }, lifecycle, true, panel);
    await start({}, ctx);
    const input = editor.handleInput, factory = ctx.ui.getEditorComponent();
    const refs = [ctx, tui, coordinator, panel].map(value => new WeakRef(value));
    await lifecycle.shutdown(); tui.stop();
    return { refs, opaqueInput: opaqueCall(input), opaqueFactory: opaqueCall(factory) };
}
const captured = await create();
for (let i = 0; i < 12; i++) { await new Promise(resolve => setImmediate(resolve)); global.gc(); }
assert.deepEqual(captured.refs.map(ref => ref.deref() === undefined), [true, true, true, true], "retired input/factory must not retain activation ctx/TUI/coordinator/panel");
console.log("retired opaque wrappers released 4/4 activation resources");
