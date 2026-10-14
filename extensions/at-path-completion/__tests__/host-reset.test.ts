import assert from 'node:assert/strict';
import { it } from 'node:test';
import { InteractiveMode } from '../../task-ui/__tests__/editor-host.mjs';
import { harness, pause } from './harness.ts';
void it('actual resetExtensionUI before shutdown preserves default editing and does not reinstall predecessor', async () => {
  const h = harness();
  try {
    Object.assign(h.host, { clearExtensionTerminalInputListeners() {}, setExtensionFooter() {}, setExtensionHeader() {}, clearExtensionWidgets() {}, footerDataProvider: { clearExtensionStatuses() {} }, footer: { invalidate() {} }, updateTerminalTitle() {}, setWorkingIndicator() {}, setHiddenThinkingLabel() {} });
    h.install(); await h.start(); const editor = h.editor; editor.setText('@local'); editor.handleInput('/');
    InteractiveMode.prototype.resetExtensionUI.call(h.host);
    assert.equal(h.ctx.ui.getEditorComponent(), undefined); assert.equal(h.host.autocompleteProviderWrappers.length, 0);
    assert.deepEqual(h.host.editorContainer.children, [editor]); assert.equal(h.tui.getFocusedComponent(), editor);
    await h.close(); await pause(); assert.equal(editor.isShowingAutocomplete(), false); assert.equal(h.ctx.ui.getEditorComponent(), undefined);
    editor.handleInput('ok'); assert.equal(editor.getText(), '@local/ok');
  } finally { await h.close(); }
});
void it('actual native list mouse callback accepts directory then displays a single next child without submit', async () => {
  const h = harness();
  try { h.install(); await h.start(); h.editor.setText('@local'); h.editor.handleInput('l'); await pause(); h.editor.render(80);
    const result = h.editor.handleMouse({ type: 'click', button: 'left', x: 2, y: 3, screenX: 2, screenY: 3, width: 80, height: 24, shift: false, alt: false, ctrl: false });
    assert.equal(result?.handled, true); await pause(); assert.equal(h.editor.getText(), '@locall/'); assert.equal(h.editor.isShowingAutocomplete(), true); assert.equal(h.counts.submit.length, 0);
  } finally { await h.close(); }
});
