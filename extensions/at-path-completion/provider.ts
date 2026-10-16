import type { AutocompleteItem, AutocompleteProvider } from "@earendil-works/pi-tui";
import { atDirectory, atPrefix } from "./token.ts";
import type { FocusScreen, PathEditor } from "./compat.ts";

export interface Lease {
  editor?: PathEditor;
  screen?: FocusScreen;
  generation: number;
  queryRevision: number;
  depth: number;
  tabGeneration?: number;
  paste: boolean;
  scheduled: boolean;
  queries: number;
  request?: () => void;
  provider?: AutocompleteProvider;
  providerOwner?: PathEditor['setAutocompleteProvider'];
  cancelRequest?: () => void;
  pending?: object;
  release(): void;
}
export interface Cell { lease?: Lease; closed: boolean; revision: number; queryAllowed: boolean; fail(): void }
export function ready(cell: Cell, lease: Lease): lease is Lease & { editor: PathEditor; screen: FocusScreen } {
  return !cell.closed && cell.lease === lease && !!lease.editor && !!lease.screen && lease.editor.focused &&
    lease.screen.getFocusedComponent() === lease.editor && !lease.screen.hasOverlay();
}
function scheduleSuggestions(cell: Cell, lease: Lease, lines: string[], cursorLine: number, cursorCol: number): void {
  const pending = {}; lease.pending = pending;
  const generation = lease.generation, text = lines.join('\n');
  queueMicrotask(() => {
    if (lease.pending !== pending) return;
    lease.pending = undefined;
    if (!ready(cell, lease) || lease.generation !== generation) return;
    const cursor = lease.editor.getCursor();
    if (lease.editor.getText() !== text || cursor.line !== cursorLine || cursor.col !== cursorCol || lease.editor.isShowingAutocomplete()) return;
    lease.request?.();
  });
}
export function wrapProvider(cell: Cell, current: AutocompleteProvider): AutocompleteProvider {
  const tickets = new WeakMap<AutocompleteItem, { lease: Lease; generation: number; text: string; line: number; col: number }>();
  return {
    ...(current.triggerCharacters ? { triggerCharacters: current.triggerCharacters } : {}),
    ...(current.shouldTriggerFileCompletion ? { shouldTriggerFileCompletion: (lines, line, col) => current.shouldTriggerFileCompletion!.call(current, lines, line, col) } : {}),
    async getSuggestions(lines, line, col, options) {
      const lease = cell.lease;
      // Scope additional cancellation to attachment queries, not slash commands,
      // agent-independent triggers or arbitrary native Tab providers.
      const owned = lease && atPrefix(lines[line] ?? '', col) !== undefined;
      const generation = lease?.generation, queryRevision = lease?.queryRevision, allowed = cell.queryAllowed;
      const text = owned ? lines.join('\n') : undefined;
      if (owned && (!ready(cell, lease) || !allowed)) { lease.scheduled = false; return null; }
      if (owned) { lease.scheduled = false; lease.queries++; }
      let result;
      try { result = await current.getSuggestions.call(current, lines, line, col, options); }
      finally { if (owned && lease) lease.queries--; }
      // The SDK handles snapshots/abort; the owner adds Escape, mouse, focus and retirement
      // invalidation, including CustomEditor's no-list Escape handler while a request awaits.
      if (owned && (!allowed || !cell.queryAllowed || !ready(cell, lease) || queryRevision !== lease.queryRevision)) return null;
      if (result && owned && lease) for (const item of result.items) tickets.set(item, { lease, generation: generation!, text: text!, line, col });
      return result;
    },
    applyCompletion(lines, line, col, item, prefix) {
      const lease = cell.lease, ticket = tickets.get(item);
      // Native lists remain selectable while a newer query awaits. Reject before
      // delegation: applying an old prefix length to new text duplicates path segments.
      if (lease && ready(cell, lease) && !lease.paste && prefix.startsWith('@') && ticket?.lease === lease &&
        (atPrefix(lines[line] ?? '', col) !== prefix || ticket.text !== lines.join('\n') || ticket.line !== line || ticket.col !== col)) {
        scheduleSuggestions(cell, lease, lines, line, col);
        return { lines, cursorLine: line, cursorCol: col };
      }
      const result = current.applyCompletion.call(current, lines, line, col, item, prefix);
      if (!lease || !ready(cell, lease) || lease.paste || !prefix.startsWith('@') || atPrefix(lines[line] ?? '', col) !== prefix ||
        !item.label.endsWith('/') || !item.value.replace(/"$/, '').endsWith('/') ||
        !atDirectory(result.lines, result.cursorLine, result.cursorCol)) return result;
      // List acceptance runs in handleInput/handleMouse; force-Tab's single-item branch
      // applies asynchronously. A later real input must invalidate that latter intent.
      if (!lease.depth && (lease.tabGeneration !== lease.generation || ticket?.lease !== lease || ticket.generation !== lease.generation)) return result;
      scheduleSuggestions(cell, lease, result.lines, result.cursorLine, result.cursorCol);
      return result;
    },
  };
}
