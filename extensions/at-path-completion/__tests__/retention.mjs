import assert from 'node:assert/strict';
import { CustomEditor } from '@earendil-works/pi-coding-agent';
import { TuiMainScreen, setKeybindings } from '@earendil-works/pi-tui';
import { KeybindingsManager, themeSdk } from '../../task-ui/__tests__/editor-host.mjs';
import { decorate } from '../editor.ts';
function opaque(original) { return function (data) { original.call(this, data); }; }
function make() {
  const keys = new KeybindingsManager(); setKeybindings(keys);
  const screen = new TuiMainScreen({ columns: 80, rows: 24, kittyProtocolActive: false, start() {}, stop() {}, async drainInput() {}, write() {}, moveBy() {}, hideCursor() {}, showCursor() {}, clearLine() {}, clearFromCursor() {}, clearScreen() {}, setTitle() {}, setProgress() {}, setProgramStatus() {} });
  screen.requestRender = () => {};
  const editor = new CustomEditor(screen, themeSdk.getEditorTheme(), keys); screen.setFocus(editor);
  const refs = [new WeakRef(screen), new WeakRef(editor)];
  const cell = { closed: false, revision: 0, queryAllowed: true, fail() {} };
  const lease = decorate(cell, screen, editor); cell.lease = lease;
  const captured = opaque(editor.handleInput); editor.handleInput = captured;
  cell.closed = true; cell.lease = undefined; lease.release(); screen.stop();
  return { refs, captured };
}
const { refs, captured } = make();
for (let i = 0; i < 50; i++) { await new Promise(resolve => setTimeout(resolve, 10)); global.gc(); if (refs.every(ref => ref.deref() === undefined)) break; }
assert.ok(refs.every(ref => ref.deref() === undefined), 'retired forwarder must not retain editor/screen');
assert.equal(typeof captured, 'function'); console.log('released 2/2');
