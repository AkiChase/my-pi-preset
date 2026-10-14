import assert from 'node:assert/strict';
import { it } from 'node:test';
import type { AutocompleteProvider, EditorComponent } from '@earendil-works/pi-tui';
import { harness, pause } from './harness.ts';

for (const key of ['\x1b[27;65;47~', '\x1b[27;129;47~', '\x1b[27;66;47~']) void it(`native lock-modified printable slash continues suggestions ${JSON.stringify(key)}`, async () => {
  const h = harness();
  try { h.install(); await h.start(); h.editor.setText('@local'); h.dispatch(key); await pause();
    assert.equal(h.editor.getText(), '@local/'); assert.equal(h.editor.isShowingAutocomplete(), true);
    assert.equal(h.counts.query.length, 1); assert.equal(h.counts.query[0]?.force, false);
  } finally { await h.close(); }
});

for (const cancel of ['focus', 'overlay']) void it(`directory debounce cannot start a visible request after early ${cancel}`, async () => {
  const h = harness();
  try {
    h.install(); await h.start(); h.editor.setText('@local'); h.editor.handleInput('/');
    if (cancel === 'focus') h.tui.setFocus({ render: () => [], invalidate() {} });
    else h.tui.showOverlay({ render: () => ['overlay'], invalidate() {} });
    await pause(); assert.equal(h.editor.isShowingAutocomplete(), false);
  } finally { await h.close(); }
});

void it('unrelated trigger provider retains a pending native request across the native no-op copy action', async () => {
  for (const enhanced of [false, true]) {
    const h = harness(); let resolve!: (value: Awaited<ReturnType<AutocompleteProvider['getSuggestions']>>) => void;
    try {
      h.setSuggestions(() => new Promise(r => { resolve = r; }));
      if (enhanced) { h.install(); await h.start(); }
      h.editor.setText('#tag'); h.editor.handleInput('x'); await pause();
      h.editor.handleInput('\x03');
      resolve({ prefix: '#tagx', items: [{ value: 'tag', label: 'tag' }] }); await pause();
      assert.equal(h.editor.getText(), '#tagx'); assert.equal(h.editor.isShowingAutocomplete(), true, `enhanced=${enhanced}`);
    } finally { resolve?.(null); await h.close(); }
  }
});

void it('directory observation requires native label, @ value and actual directory cursor together', async () => {
  for (const item of [
    { value: '@agent', label: 'agent/' },
    { value: '@local/', label: 'decorated directory' },
    { value: 'plain/', label: 'directory/' },
  ]) {
    const h = harness();
    try {
      h.setSuggestions(async () => ({ prefix: '@local', items: [item] })); h.install(); await h.start();
      h.editor.setText('@loca'); h.editor.handleInput('l'); await pause(); h.editor.handleInput('\r'); await pause();
      assert.equal(h.counts.query.length, 1); assert.equal(h.editor.isShowingAutocomplete(), false); assert.equal(h.counts.submit.length, 0);
    } finally { await h.close(); }
  }
});

void it('ordinary non-attachment force Tab remains active across a handled extension shortcut', async () => {
  const h = harness(); let resolve!: (value: Awaited<ReturnType<AutocompleteProvider['getSuggestions']>>) => void;
  try {
    h.setSuggestions(() => new Promise(r => { resolve = r; })); h.install(); await h.start();
    h.editor.setText('plain'); h.editor.handleInput('\t'); await pause(); h.editor.handleInput('\x1bx');
    resolve({ prefix: 'plain', items: [{ value: 'completed', label: 'completed' }] }); await pause();
    assert.equal(h.editor.getText(), 'completed'); assert.equal(h.counts.shortcut, 1);
  } finally { resolve?.(null); await h.close(); }
});

void it('agent mention provider retains native suggestions across no-op copy', async () => {
  const h = harness(); let resolve!: (value: Awaited<ReturnType<AutocompleteProvider['getSuggestions']>>) => void;
  try {
    h.setSuggestions(() => new Promise(r => { resolve = r; })); h.install(); await h.start();
    h.editor.setText('@a'); h.editor.handleInput('g'); await pause(); h.editor.handleInput('\x03');
    resolve({ prefix: '@ag', items: [{ value: '@agent', label: 'agent' }] }); await pause();
    assert.equal(h.editor.isShowingAutocomplete(), true); h.editor.handleInput('\r'); await pause();
    assert.equal(h.editor.getText(), '@agent '); assert.equal(h.counts.query.length, 1);
  } finally { resolve?.(null); await h.close(); }
});

function setterWrapper(original: NonNullable<EditorComponent['setAutocompleteProvider']>, onQuery: () => void) {
  return function (this: EditorComponent, provider: AutocompleteProvider) {
    original.call(this, {
      triggerCharacters: provider.triggerCharacters,
      getSuggestions(...args) { onQuery(); return provider.getSuggestions(...args); },
      applyCompletion: (...args) => provider.applyCompletion(...args),
      shouldTriggerFileCompletion: (...args) => provider.shouldTriggerFileCompletion?.(...args) ?? true,
    });
  };
}
void it('shutdown does not run a later provider-transforming setter twice', async () => {
  const h = harness(); let query = 0;
  try {
    h.install(); await h.start(); const editor = h.editor;
    const later = setterWrapper(editor.setAutocompleteProvider, () => { query++; }); editor.setAutocompleteProvider = later;
    editor.setAutocompleteProvider(h.base);
    await h.close(); assert.equal(editor.setAutocompleteProvider, later);
    editor.setText('@local'); editor.handleInput('\t'); await pause();
    assert.equal(query, 1); assert.equal(editor.getText(), '@local/');
  } finally { await h.close(); }
});
void it('shutdown never overwrites a later nondelegating provider setter with an old chain', async () => {
  const h = harness(); const nativeSetter = h.editor.setAutocompleteProvider; let query = 0;
  try {
    h.install(); await h.start(); const editor = h.editor;
    editor.setAutocompleteProvider = setterWrapper(nativeSetter, () => { query++; }); editor.setAutocompleteProvider(h.base);
    await h.close(); editor.setText('@local'); editor.handleInput('\t'); await pause();
    assert.equal(query, 1); assert.equal(editor.getText(), '@local/');
  } finally { await h.close(); }
});
