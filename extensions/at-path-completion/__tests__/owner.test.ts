import assert from 'node:assert/strict';
import { it } from 'node:test';
import { CustomEditor, type ExtensionAPI } from '@earendil-works/pi-coding-agent';
import { CombinedAutocompleteProvider, type EditorComponent } from '@earendil-works/pi-tui';
import beautify from '../../beautify/index.ts';
import { registerDownOpener } from '../../task-ui/editor.ts';
import { TaskLifecycle } from '../../task-ui/lifecycle.ts';
import { TaskCoordinator } from '../../task-ui/coordinator.ts';
import { harness, pause } from './harness.ts';
function opaque(original: EditorComponent['handleInput']) { return function (this: EditorComponent, data: string) { original.call(this, data); }; }
void it('actual setter preserves cursor, undo, callbacks, history and paste state on the live instance', async () => {
  for (const state of ['undo', 'history', 'paste', 'autocomplete']) {
    const h = harness();
    try {
      const e = h.editor;
      if (state === 'undo') { e.setText('draft'); e.handleInput('\x1b[D'); e.insertTextAtCursor('!'); }
      if (state === 'history') { e.addToHistory('older'); e.setText('draft'); e.render(80); e.handleInput('\x01'); e.handleInput('\x1b[A'); }
      if (state === 'paste') e.handleInput(`\x1b[200~${'line\n'.repeat(150)}\x1b[201~`);
      if (state === 'autocomplete') { e.setText('@local'); e.handleInput('l'); await pause(); }
      const cursor = e.getCursor(), text = e.getExpandedText(), change = e.onChange, submit = e.onSubmit;
      h.install(); await h.start();
      assert.equal(h.editor, e); assert.deepEqual(e.getCursor(), cursor); assert.equal(e.getExpandedText(), text); assert.equal(e.onChange, change); assert.equal(e.onSubmit, submit);
      assert.deepEqual(h.host.editorContainer.children, [e]); assert.equal(h.tui.getFocusedComponent(), e); assert.ok(h.host.editorContainer.render(80).length);
      if (state === 'undo') { e.handleInput('\x1f'); assert.equal(e.getText(), 'draft'); }
      if (state === 'history') { e.handleInput('\x1b[B'); assert.equal(e.getText(), 'draft'); }
      if (state === 'paste') { e.handleInput('\r'); assert.equal(h.counts.submit[0], 'line\n'.repeat(150).trimEnd()); }
      // addAutocompleteProvider publicly rebuilds the chain and cancels existing suggestions.
      if (state === 'autocomplete') { assert.equal(e.isShowingAutocomplete(), false); e.handleInput('\t'); await pause(); assert.equal(e.getText(), '@locall/'); }
    } finally { await h.close(); }
  }
});
void it('later opaque wrapper and delegating provider survive retirement; factory remains an inactive delegate', async () => {
  const h = harness();
  try { const e = h.editor; h.install(); await h.start(); const factory = h.ctx.ui.getEditorComponent();
    const wrapper = opaque(e.handleInput); e.handleInput = wrapper;
    let query = 0, apply = 0;
    h.ctx.ui.addAutocompleteProvider(current => ({ triggerCharacters: current.triggerCharacters,
      getSuggestions(...args) { query++; return current.getSuggestions(...args); },
      applyCompletion(...args) { apply++; return current.applyCompletion(...args); },
      shouldTriggerFileCompletion: (...args) => current.shouldTriggerFileCompletion?.(...args) ?? true,
    }));
    e.setText('@local'); e.handleInput('\t'); await pause(); assert.equal(query, 2); assert.equal(apply, 1);
    await h.close(); assert.equal(e.handleInput, wrapper); e.setText('@local'); e.handleInput('/'); await pause(); assert.equal(query, 2);
    h.ctx.ui.setEditorComponent(factory); assert.notEqual(h.editor, e); h.editor.setText('@local'); h.editor.handleInput('\t'); await pause(); assert.equal(h.editor.getText(), '@local/');
  } finally { await h.close(); }
});
void it('future delegated factory decorates a new editor and invalidates the old lease', async () => {
  const h = harness();
  try { let calls = 0;
    h.ctx.ui.setEditorComponent((...args) => { calls++; return new CustomEditor(...args); }); const e = h.editor;
    h.install(); await h.start(); assert.equal(calls, 1); const factory = h.ctx.ui.getEditorComponent();
    h.ctx.ui.setEditorComponent(factory); const next = h.editor; assert.notEqual(next, e); assert.equal(calls, 2);
    next.setText('@local'); next.handleInput('/'); await pause(); assert.equal(next.isShowingAutocomplete(), true);
    const queries = h.counts.query.length; e.setText('@local'); e.handleInput('/'); await pause(); assert.equal(h.counts.query.length, queries);
  } finally { await h.close(); }
});
for (const variant of ['missing', 'nonconfig', 'accessor', 'setter', 'overlay', 'throwing-request']) void it(`safe degradation ${variant} keeps actual mounted UI usable`, async () => {
  const h = harness();
  const errors: unknown[][] = [], error = console.error; console.error = (...args: unknown[]) => { errors.push(args); };
  try { const e = h.editor, original = e.handleInput; e.setText('draft'); e.handleInput('\x1b[D'); const cursor = e.getCursor();
    if (variant === 'missing') Object.defineProperty(e, 'tryTriggerAutocomplete', { configurable: true, value: undefined });
    if (variant === 'throwing-request') Object.defineProperty(e, 'tryTriggerAutocomplete', { configurable: true, value: () => { throw new Error('request'); } });
    if (variant === 'nonconfig') Object.defineProperty(e, 'handleInput', { value: original, writable: true, configurable: false });
    if (variant === 'accessor') Object.defineProperty(e, 'handleInput', { configurable: true, get: () => original });
    if (variant === 'setter') { const setter = h.ctx.ui.setEditorComponent; let once = true;
      h.ctx.ui.setEditorComponent = factory => { if (once) { once = false; h.host.editorContainer.clear(); throw new Error('after unmount'); } setter(factory); };
    }
    const overlay = variant === 'overlay' ? h.tui.showOverlay({ render: () => ['overlay'], invalidate() {} }) : undefined;
    h.install(); await h.start();
    assert.deepEqual(h.host.editorContainer.children, [e]); assert.ok(h.host.editorContainer.render(80).length); assert.equal(h.editor, e); assert.deepEqual(e.getCursor(), cursor);
    if (overlay) { assert.equal(h.tui.hasOverlay(), true); overlay.hide(); h.tui.setFocus(e); }
    assert.equal(h.tui.getFocusedComponent(), e);
    e.handleInput('!'); assert.equal(e.getText(), 'draf!t');
    if (variant === 'throwing-request') { e.setText('@local'); e.handleInput('/'); await pause(); assert.equal(e.isShowingAutocomplete(), false); }
    if (variant !== 'accessor' && variant !== 'nonconfig') assert.equal(e.handleInput, original);
    assert.equal(errors.length, 1); e.setText('@local'); e.handleInput('/'); await pause(); assert.equal(errors.length, 1);
    if (variant !== 'missing' && variant !== 'throwing-request') { e.handleInput('\t'); await pause(); assert.equal(e.getText(), '@local/child/'); }
  } finally { console.error = error; await h.close(); }
});
void it('shutdown/reset reentry does not register a late provider or re-enable the activation', async () => {
  const h = harness();
  try { const set = h.ctx.ui.setEditorComponent;
    h.ctx.ui.setEditorComponent = factory => { set(factory); void h.close(); };
    h.install(); await h.start(); assert.equal(h.host.autocompleteProviderWrappers.length, 0);
    h.editor.setText('@local'); h.editor.handleInput('/'); await pause(); assert.equal(h.counts.query.length, 0);
  } finally { await h.close(); }
});
void it('Beautify, Down and history/agent provider fixtures compose in multiple loading orders including Down disabled', async () => {
  for (const order of [['path', 'beautify', 'down'], ['down', 'beautify', 'path'], ['beautify', 'path'], ['path', 'down', 'beautify']]) {
    const h = harness(), lifecycle = new TaskLifecycle(new TaskCoordinator()); let opens = 0;
    const pi = h.pi as ExtensionAPI;
    // Public history factory fixture delegates instance input; production input-history is not loaded.
    h.ctx.ui.setEditorComponent((...args) => { const e = new CustomEditor(...args); e.addToHistory('older'); return e; });
    try {
      h.ctx.ui.addAutocompleteProvider(current => {
        const native = new CombinedAutocompleteProvider([], '/tmp', null);
        return { getSuggestions: (lines, line, col, options) => lines[line]?.slice(0, col) === '@ag' ? Promise.resolve({ prefix: '@ag', items: [{ value: '@agent', label: 'agent' }] }) : current.getSuggestions(lines, line, col, options),
          applyCompletion: (lines, line, col, item, prefix) => item.value === '@agent' ? native.applyCompletion(lines, line, col, item, prefix) : current.applyCompletion(lines, line, col, item, prefix),
          shouldTriggerFileCompletion: (...args) => current.shouldTriggerFileCompletion?.(...args) ?? true };
      });
      for (const owner of order) {
        if (owner === 'path') h.install();
        if (owner === 'beautify') beautify(Object.assign(Object.create(pi) as ExtensionAPI, { registerToolRenderer() {} }));
        if (owner === 'down') registerDownOpener(pi, lifecycle, true, { canOpen: () => true, async openPanel() { opens++; } });
      }
      await h.start(); const e = h.editor;
      e.setText('@local'); e.handleInput('/'); await pause(); assert.equal(e.isShowingAutocomplete(), true);
      e.handleInput('\r'); await pause(); assert.equal(e.getText(), '@local/child/'); assert.deepEqual(h.counts.submit, []);
      e.setText('@a'); e.handleInput('g'); await pause(); e.handleInput('\r'); await pause(); assert.equal(e.getText(), '@agent '); assert.equal(e.isShowingAutocomplete(), false);
      e.setText(''); e.handleInput('\x1b[A'); assert.equal(e.getText(), 'older'); e.handleInput('\x1b[B'); e.handleInput('\x1b[B');
      assert.equal(opens, order.includes('down') ? 1 : 0);
      assert.match(e.render(80).join('\n'), /❯/); assert.equal(h.counts.raw, 0);
      await lifecycle.shutdown(); await h.close(); e.setText('@local'); e.handleInput('/'); await pause(); assert.equal(e.isShowingAutocomplete(), false);
    } finally { await lifecycle.shutdown(); await h.close(); }
  }
});
