import assert from 'node:assert/strict';
import { it } from 'node:test';
import { harness, pause } from './harness.ts';
import { atPrefix } from '../token.ts';

void it('closed-list actual slash requests ordinary suggestions across path and terminal encodings', async () => {
  for (const path of ['@local', '@.', '@..', '@~', '@', 'text (@local', '中文：@local', 'x=@local', '@"space dir']) {
    for (const key of ['/', '\x1b[47u', '\x1b[27;1;47~']) {
      const h = harness();
      try { h.install(); await h.start(); h.editor.setText(path); h.dispatch(key); await pause();
        assert.equal(h.editor.getText(), `${path}/`); assert.equal(h.editor.isShowingAutocomplete(), true);
        assert.equal(h.counts.query.length, 1); assert.equal(h.counts.query[0]!.force, false);
      } finally { await h.close(); }
    }
  }
});
void it('quoted directory cursor may remain before the closing quote', async () => {
  const h = harness();
  try { h.install(); await h.start(); h.editor.setText('@"space dir"'); h.editor.handleInput('\x1b[D'); h.editor.handleInput('/'); await pause();
    assert.equal(h.editor.getText(), '@"space dir/"'); assert.equal(h.editor.getCursor().col, 12); assert.equal(h.editor.isShowingAutocomplete(), true);
  } finally { await h.close(); }
});
for (const key of ['\t', '\r']) void it(`actual list ${JSON.stringify(key)} accepts directory then displays but does not accept its only child`, async () => {
  const h = harness();
  try { h.install(); await h.start(); h.editor.setText('@local'); h.editor.handleInput('l'); await pause();
    assert.equal(h.editor.isShowingAutocomplete(), true); h.editor.handleInput(key); await pause();
    assert.equal(h.editor.getText(), '@locall/'); assert.equal(h.editor.isShowingAutocomplete(), true); assert.deepEqual(h.counts.submit, []);
    assert.equal(h.counts.query.length, 2); assert.equal(h.counts.applyReceiver, true); assert.equal(h.counts.queryReceiver, true);
    h.editor.handleInput('\x1b'); await pause(); assert.equal(h.editor.isShowingAutocomplete(), false); assert.equal(h.counts.query.length, 2);
  } finally { await h.close(); }
});
void it('force Tab single-directory applies asynchronously then ordinary next query never auto-accepts', async () => {
  const h = harness();
  try { h.install(); await h.start(); h.editor.setText('@local'); h.editor.handleInput('\t'); await pause();
    assert.equal(h.editor.getText(), '@local/'); assert.equal(h.editor.isShowingAutocomplete(), true);
    assert.deepEqual(h.counts.query.map(q => q.force), [true, false]);
  } finally { await h.close(); }
});
void it('already-open suggestions use native update once; empty directories remain closed', async () => {
  const h = harness();
  try { h.install(); await h.start(); h.editor.setText('@local'); h.editor.handleInput('x'); await pause(); h.editor.handleInput('/'); await pause();
    assert.equal(h.counts.query.length, 2); assert.equal(h.editor.isShowingAutocomplete(), true);
    h.setSuggestions(async () => null); h.editor.setText('@empty'); h.editor.handleInput('/'); await pause(); assert.equal(h.editor.isShowingAutocomplete(), false);
  } finally { await h.close(); }
});
void it('file completion keeps native trailing space and normal Enter submits exactly once', async () => {
  const h = harness();
  try { h.setSuggestions(async (lines, line, col) => ({ prefix: lines[line]!.slice(0, col), items: [{ value: '@file.txt', label: 'file.txt' }] }));
    h.install(); await h.start(); h.editor.setText('@fi'); h.editor.handleInput('l'); await pause(); h.editor.handleInput('\r'); await pause();
    assert.equal(h.editor.getText(), '@file.txt '); assert.equal(h.editor.isShowingAutocomplete(), false); assert.equal(h.counts.query.length, 1); assert.equal(h.counts.submit.length, 0);
    h.editor.handleInput('\r'); assert.deepEqual(h.counts.submit, ['@file.txt']);
  } finally { await h.close(); }
});
void it('prose, email, slash commands, jumps, shortcuts and bracketed paste never request enhancement', async () => {
  const h = harness();
  try { h.install(); await h.start();
    for (const path of ['text', '/command', '/command @local', 'mail@example', '@agent ']) { h.editor.setText(path); h.editor.handleInput('/'); await pause(); }
    assert.equal(h.counts.query.length, 0);
    h.editor.setText('@local/next'); h.editor.handleInput('\x01'); h.editor.handleInput('\x1d'); h.editor.handleInput('/'); await pause(); assert.equal(h.counts.query.length, 0);
    h.editor.setText('@local'); h.editor.handleInput('\x1b[200~'); h.editor.handleInput('/'); h.editor.handleInput('\x1b[201~'); await pause(); assert.equal(h.counts.query.length, 0);
    h.editor.handleInput('\x1bx'); assert.equal(h.counts.shortcut, 1); assert.equal(h.counts.raw, 0);
  } finally { await h.close(); }
});
void it('token delimiter contract excludes email and accepts native wrappers and CJK punctuation', () => {
  for (const text of ['@local/', '(@local/', '`@local/', '中文，@local/', 'x=@local/', '@"space dir/']) assert.ok(atPrefix(text, text.length));
  for (const text of ['email@local/', '/cmd @local/', '@agent ', 'plain/']) assert.equal(atPrefix(text, text.length), undefined);
});

for (const cancel of ['escape', 'type', 'delete', 'cursor', 'mouse', 'replace', 'shutdown', 'editor', 'overlay', 'focus']) void it(`delayed ordinary query cannot display after ${cancel}`, async () => {
  const h = harness();
  let resolve!: (value: Awaited<ReturnType<typeof h.base.getSuggestions>>) => void;
  const pending = new Promise<Awaited<ReturnType<typeof h.base.getSuggestions>>>(r => { resolve = r; });
  try { h.setSuggestions(() => pending); h.install(); await h.start(); const editor = h.editor;
    editor.setText('@local'); editor.handleInput('/'); await pause(); assert.equal(h.counts.query.length, 1);
    if (cancel === 'escape') editor.handleInput('\x1b');
    if (cancel === 'type') { h.setSuggestions(async () => null); editor.handleInput('x'); }
    if (cancel === 'delete') { h.setSuggestions(async () => null); editor.handleInput('\x7f'); }
    if (cancel === 'cursor') editor.handleInput('\x1b[D');
    if (cancel === 'mouse') editor.handleMouse({ type: 'move', button: 'none', x: 0, y: 0, screenX: 0, screenY: 0, width: 80, height: 24, shift: false, alt: false, ctrl: false });
    if (cancel === 'replace') editor.setText('@local/');
    if (cancel === 'shutdown') await h.close();
    if (cancel === 'editor') h.ctx.ui.setEditorComponent(undefined);
    if (cancel === 'overlay') h.tui.showOverlay({ render: () => ['overlay'], invalidate() {} });
    if (cancel === 'focus') h.tui.setFocus({ render: () => ['focus'], invalidate() {} });
    resolve({ prefix: '@local/', items: [{ value: '@local/child/', label: 'child/' }] }); await pause();
    assert.equal(editor.isShowingAutocomplete(), false);
  } finally { resolve(null); await h.close(); }
});
for (const cancel of ['escape', 'type', 'mouse', 'replace', 'shutdown', 'editor']) void it(`directory follow-up microtask is discarded after ${cancel}`, async () => {
  const h = harness();
  try { h.install(); await h.start(); const editor = h.editor; editor.setText('@local'); editor.handleInput('l'); await pause();
    editor.handleInput('\r');
    if (cancel === 'escape') editor.handleInput('\x1b');
    if (cancel === 'type') editor.handleInput('!');
    if (cancel === 'mouse') editor.handleMouse({ type: 'move', button: 'none', x: 0, y: 0, screenX: 0, screenY: 0, width: 80, height: 24, shift: false, alt: false, ctrl: false });
    if (cancel === 'replace') editor.setText(editor.getText());
    if (cancel === 'shutdown') await h.close();
    if (cancel === 'editor') h.ctx.ui.setEditorComponent(undefined);
    await pause(); assert.equal(h.counts.query.length, 1); assert.equal(editor.isShowingAutocomplete(), false);
  } finally { await h.close(); }
});
