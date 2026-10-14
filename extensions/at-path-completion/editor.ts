import { decodeKittyPrintable, getKeybindings, isKeyRelease, matchesKey, type AutocompleteProvider, type EditorComponent, type TuiMouseEvent } from "@earendil-works/pi-tui";
import { interpose } from "../editor-handoff/index.ts";
import { pathEditor, requestCapability, type FocusScreen } from "./compat.ts";
import { atDirectory, atPrefix } from "./token.ts";
import { ready, type Cell, type Lease } from "./provider.ts";

function slash(data: string): boolean {
  // Pi also supports xterm modifyOtherKeys; accept only its unmodified printable '/'.
  const modifyOtherKeys = /^\x1b\[27;(\d+);47~$/.exec(data);
  const modifier = modifyOtherKeys ? Number(modifyOtherKeys[1]) - 1 : -1;
  // Shift, Caps Lock and Num Lock are the SDK's printable modifier bits.
  return !isKeyRelease(data) && (data === '/' || decodeKittyPrintable(data) === '/' ||
    (modifier >= 0 && Number.isSafeInteger(modifier) && (modifier & ~(1 | 64 | 128)) === 0));
}
function cancelClosedRequest(lease: Lease): void {
  const editor = lease.editor;
  if (editor && lease.provider && !editor.isShowingAutocomplete() && (lease.scheduled || lease.queries > 0 || lease.tabGeneration !== undefined)) lease.cancelRequest?.();
  lease.scheduled = false;
}
function invalidate(cell: Cell, lease: Lease): void { cell.revision++; lease.generation++; lease.tabGeneration = undefined; lease.pending = undefined; }
// Module-scope forwarders retain only an emptied lease and the original receiver method.
function inputWrapper(cell: Cell, lease: Lease, original: EditorComponent['handleInput']) {
  return function (this: EditorComponent, data: string): void {
    if (!lease.editor || this !== lease.editor || cell.closed) { original.call(this, data); return; }
    // Copy is a native no-op: keep a pending provider request, but still retire
    // an enhancement microtask like every later input.
    const copy = getKeybindings().matches(data, 'tui.input.copy');
    try { if (!copy) cancelClosedRequest(lease); } catch { cell.fail(); original.call(this, data); return; }
    if (!copy) {
      lease.queryRevision++;
      cell.queryAllowed = !getKeybindings().matches(data, 'tui.select.cancel') && !matchesKey(data, 'escape');
    }
    invalidate(cell, lease);
    const editor = lease.editor;
    const before = editor.getText(), cursor = editor.getCursor(), open = editor.isShowingAutocomplete();
    const paste = lease.paste || data.includes('\x1b[200~');
    if (data.includes('\x1b[200~')) lease.paste = true;
    const isSlash = !paste && slash(data);
    if (!paste && getKeybindings().matches(data, 'tui.input.tab') && atPrefix(editor.getLines()[cursor.line] ?? '', cursor.col) !== undefined) lease.tabGeneration = lease.generation;
    lease.depth++;
    try { original.call(this, data); }
    finally { lease.depth--; if (data.includes('\x1b[201~')) lease.paste = false; }
    // Native @ typing also schedules a debounced request. Observe the public outcome
    // so retirement/cancel can stop it before getSuggestions is ever invoked.
    if (!paste && !open && editor.getText() !== before) {
      const after = editor.getCursor();
      if (atPrefix(editor.getLines()[after.line] ?? '', after.col) !== undefined) lease.scheduled = true;
    }
    if (!isSlash || open || !ready(cell, lease)) return;
    const afterCursor = editor.getCursor(), lines = editor.getLines();
    const offset = before.split('\n').slice(0, cursor.line).reduce((n, line) => n + line.length + 1, 0) + cursor.col;
    if (editor.getText() === before.slice(0, offset) + '/' + before.slice(offset) && afterCursor.line === cursor.line && afterCursor.col === cursor.col + 1 &&
      atDirectory(lines, afterCursor.line, afterCursor.col) && !editor.isShowingAutocomplete()) lease.request?.();
  };
}
function mouseWrapper(cell: Cell, lease: Lease, original: NonNullable<EditorComponent['handleMouse']>) {
  return function (this: EditorComponent, event: TuiMouseEvent) {
    if (!lease.editor || this !== lease.editor || cell.closed) return original.call(this, event);
    try { cancelClosedRequest(lease); } catch { cell.fail(); return original.call(this, event); }
    invalidate(cell, lease); lease.queryRevision++; cell.queryAllowed = true; lease.depth++;
    try { return original.call(this, event); } finally { lease.depth--; }
  };
}
function setterWrapper(cell: Cell, lease: Lease, original: (text: string) => void) {
  return function (this: EditorComponent, text: string) {
    if (lease.editor && this === lease.editor && !cell.closed) { invalidate(cell, lease); lease.queryRevision++; cell.queryAllowed = true; }
    original.call(this, text);
  };
}
function providerSetter(cell: Cell, lease: Lease, original: (provider: AutocompleteProvider) => void) {
  const wrapper = function (this: EditorComponent, provider: AutocompleteProvider) {
    original.call(this, provider);
    if (this === lease.editor) {
      invalidate(cell, lease); lease.queryRevision++; lease.provider = provider;
      // A later delegating setter may transform the provider before reaching us.
      // Replay this exact public argument at this layer, not through it twice.
      lease.providerOwner = this.setAutocompleteProvider;
    }
  };
  lease.cancelRequest = () => {
    const editor = lease.editor;
    if (editor && lease.provider && editor.setAutocompleteProvider === lease.providerOwner) original.call(editor, lease.provider);
  };
  return wrapper;
}
export function decorate(cell: Cell, screen: FocusScreen, component: EditorComponent): Lease {
  if (!pathEditor(component)) throw new Error('Unsupported public editor API');
  const request = requestCapability(component);
  const restores: (() => void)[] = [];
  const lease: Lease = { editor: component, screen, generation: 0, queryRevision: 0, depth: 0, paste: false, scheduled: false, queries: 0,
    request() {
      if (!ready(cell, lease) || lease.editor.isShowingAutocomplete()) return;
      try { lease.scheduled = true; request.call(lease.editor, false); } catch { cell.fail(); }
    },
    release() {
      invalidate(cell, lease);
      // The public provider setter cancels native debounce/requests. Remember its last
      // public argument, not private registry/state, so cleanup preserves even later chains.
      try { lease.cancelRequest?.(); }
      catch { console.error('[at-path-completion] Native request cancellation failed.'); }
      lease.scheduled = false; lease.provider = undefined; lease.providerOwner = undefined; lease.cancelRequest = undefined;
      lease.editor = undefined; lease.screen = undefined; lease.request = undefined;
      for (const restore of restores.splice(0).reverse()) {
        try { restore(); } catch { console.error('[at-path-completion] Editor cleanup failed; keeping inactive delegate.'); }
      }
      lease.release = () => {};
    },
  };
  try {
    if (component.setAutocompleteProvider) restores.push(interpose(component, 'setAutocompleteProvider', { writable: true, value: providerSetter(cell, lease, component.setAutocompleteProvider) }));
    restores.push(interpose(component, 'handleInput', { writable: true, value: inputWrapper(cell, lease, component.handleInput) }));
    if (component.handleMouse) restores.push(interpose(component, 'handleMouse', { writable: true, value: mouseWrapper(cell, lease, component.handleMouse) }));
    for (const key of ['setText', 'insertTextAtCursor'] as const) {
      const original = component[key];
      if (original) restores.push(interpose(component, key, { writable: true, value: setterWrapper(cell, lease, original) }));
    }
  } catch (error) { lease.release(); throw error; }
  return lease;
}
