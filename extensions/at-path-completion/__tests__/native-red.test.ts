import assert from "node:assert/strict";
import { it } from "node:test";
import { CustomEditor } from "@earendil-works/pi-coding-agent";
import { CombinedAutocompleteProvider, TuiMainScreen, setKeybindings, type AutocompleteProvider } from "@earendil-works/pi-tui";
import { KeybindingsManager, themeSdk } from "../../task-ui/__tests__/editor-host.mjs";
const pause = () => new Promise(resolve => setTimeout(resolve, 100));
function native() {
  const keys = new KeybindingsManager(); setKeybindings(keys);
  const tui = new TuiMainScreen({ columns: 80, rows: 24, kittyProtocolActive: false, start() {}, stop() {}, async drainInput() {}, write() {}, moveBy() {}, hideCursor() {}, showCursor() {}, clearLine() {}, clearFromCursor() {}, clearScreen() {}, setTitle() {}, setProgress() {}, setProgramStatus() {} });
  tui.requestRender = () => {};
  const editor = new CustomEditor(tui, themeSdk.getEditorTheme(), keys);
  const base = new CombinedAutocompleteProvider([], "/tmp", null);
  const provider: AutocompleteProvider = {
    async getSuggestions(lines, line, col) {
      const prefix = lines[line]!.slice(0, col);
      const value = prefix.endsWith("/") ? `${prefix}child/` : `${prefix}/`;
      return { prefix, items: [{ value, label: "child/" }] };
    },
    applyCompletion: base.applyCompletion.bind(base),
  };
  editor.setAutocompleteProvider(provider); tui.setFocus(editor);
  return { editor, tui };
}
void it("native baseline: closed-list slash does not request", async () => {
  const { editor, tui } = native();
  try { editor.setText("@local"); editor.handleInput("/"); await pause(); assert.equal(editor.getText(), "@local/"); assert.equal(editor.isShowingAutocomplete(), false); }
  finally { tui.stop(); }
});
for (const key of ["\t", "\r"]) void it(`native baseline: list ${JSON.stringify(key)} directory acceptance closes suggestions`, async () => {
  const { editor, tui } = native();
  try {
    editor.setText("@local"); editor.handleInput("l"); await pause(); assert.equal(editor.isShowingAutocomplete(), true);
    editor.handleInput(key); await pause(); assert.equal(editor.getText(), "@locall/"); assert.equal(editor.isShowingAutocomplete(), false);
  } finally { tui.stop(); }
});
void it("native baseline: force Tab single directory closes suggestions", async () => {
  const { editor, tui } = native();
  try { editor.setText("@local"); editor.handleInput("\t"); await pause(); assert.equal(editor.getText(), "@local/"); assert.equal(editor.isShowingAutocomplete(), false); }
  finally { tui.stop(); }
});
