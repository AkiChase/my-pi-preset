import assert from 'node:assert/strict';
import { it } from 'node:test';
import { Container } from '@earendil-works/pi-tui';
import { registerAppearance } from '../../beautify/editor/owner.ts';
import { registerDownOpener } from '../../task-ui/editor.ts';
import { TaskLifecycle } from '../../task-ui/lifecycle.ts';
import { TaskCoordinator } from '../../task-ui/coordinator.ts';
import { harness, pause } from './harness.ts';

for (const closeWhileWaiting of [false, true]) void it(`reload focus gap: ${closeWhileWaiting ? 'shutdown cancels installation' : 'all three owners recover'}`, async () => {
  const h = harness(), lifecycle = new TaskLifecycle(new TaskCoordinator());
  let opens = 0;
  const errors: unknown[] = [];
  const error = console.error;
  console.error = (...args) => { errors.push(args); };
  try {
    const editor = h.editor, input = editor.handleInput, render = editor.render;
    editor.setText('draft'); editor.handleInput('\x1b[D');
    const cursor = editor.getCursor();
    const reloadBox = new Container();
    h.host.editorContainer.clear(); h.host.editorContainer.addChild(reloadBox); h.tui.setFocus(reloadBox);
    registerAppearance(h.pi);
    registerDownOpener(h.pi, lifecycle, true, { canOpen: () => true, async openPanel() { opens++; } });
    h.install();
    // Must return before the host restores focus; awaiting readiness here would deadlock reload.
    await h.start();
    await h.start();
    assert.equal(h.tui.getFocusedComponent(), reloadBox);
    assert.equal(h.ctx.ui.getEditorComponent(), undefined);
    assert.deepEqual(errors, []);
    if (closeWhileWaiting) { await lifecycle.shutdown(); await h.close(); }
    h.host.editorContainer.clear(); h.host.editorContainer.addChild(editor); h.tui.setFocus(editor);
    await pause();
    assert.equal(h.editor, editor); assert.equal(editor.getText(), 'draft'); assert.deepEqual(editor.getCursor(), cursor);
    assert.deepEqual(errors, []);
    if (closeWhileWaiting) {
      assert.equal(h.ctx.ui.getEditorComponent(), undefined);
      assert.equal(editor.handleInput, input); assert.equal(editor.render, render);
      assert.equal(h.host.autocompleteProviderWrappers.length, 0);
    } else {
      assert.match(editor.render(80).join('\n'), /❯/);
      editor.setText(''); h.dispatch('\x1b[B'); assert.equal(opens, 1);
      editor.setText('@local'); h.dispatch('/'); await pause();
      assert.equal(editor.isShowingAutocomplete(), true);
      assert.equal(h.host.autocompleteProviderWrappers.length, 1);
    }
  } finally { await lifecycle.shutdown(); await h.close(); console.error = error; }
});
