import assert from 'node:assert/strict';
import { it } from 'node:test';
import { harness, pause } from './harness.ts';

void it('Escape, mouse and shutdown before native debounce starts cannot reopen the list', async () => {
  for (const cancel of ['escape', 'mouse', 'shutdown']) {
    const h = harness();
    try { h.install(); await h.start(); const editor = h.editor;
      editor.setText('@local'); editor.handleInput('/');
      if (cancel === 'escape') editor.handleInput('\x1b');
      if (cancel === 'mouse') editor.handleMouse({ type: 'move', button: 'none', x: 0, y: 0, screenX: 0, screenY: 0, width: 80, height: 24, shift: false, alt: false, ctrl: false });
      if (cancel === 'shutdown') await h.close();
      await pause(); assert.equal(h.counts.query.length, 0); assert.equal(editor.isShowingAutocomplete(), false);
    } finally { await h.close(); }
  }
});
void it('force Tab pending query cannot late-accept after Escape even if provider ignores abort', async () => {
  const h = harness(); let resolve!: (value: Awaited<ReturnType<typeof h.base.getSuggestions>>) => void;
  try { h.setSuggestions(() => new Promise(r => { resolve = r; })); h.install(); await h.start();
    h.editor.setText('@local'); h.editor.handleInput('\t'); await pause(); h.editor.handleInput('\x1b');
    resolve({ prefix: '@local', items: [{ value: '@local/', label: 'local/' }] }); await pause();
    assert.equal(h.editor.getText(), '@local'); assert.equal(h.editor.isShowingAutocomplete(), false); assert.equal(h.counts.query.length, 1);
  } finally { resolve?.(null); await h.close(); }
});

void it('native @ typing debounce is cancelled on shutdown and a new activation starts clean', async () => {
  const h = harness();
  try { h.install(); await h.start(); h.editor.setText('@local'); h.editor.handleInput('l'); await h.close(); await pause();
    assert.equal(h.editor.isShowingAutocomplete(), false); assert.equal(h.counts.query.length, 0);
    h.install(); await h.start(); h.editor.setText('@local'); h.editor.handleInput('/'); await pause(); assert.equal(h.editor.isShowingAutocomplete(), true);
  } finally { await h.close(); }
});
