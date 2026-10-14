import { CustomEditor, type ExtensionAPI, type ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { EditorComponent, TUI } from "@earendil-works/pi-tui";
import { preserveHandoff, type LiveEditor } from "../editor-handoff/index.ts";
import { pathEditor, type FocusScreen } from "./compat.ts";
import { decorate } from "./editor.ts";
import { wrapProvider, type Cell } from "./provider.ts";
type Factory = NonNullable<Parameters<ExtensionContext['ui']['setEditorComponent']>[0]>;
function attach(cell: Cell, tui: TUI, editor: EditorComponent): EditorComponent {
  if (cell.closed || cell.lease?.editor === editor) return editor;
  cell.lease?.release(); cell.lease = undefined;
  if (!('getFocusedComponent' in tui) || typeof tui.getFocusedComponent !== 'function') throw new Error('No public focus access');
  cell.lease = decorate(cell, tui as FocusScreen, editor);
  return editor;
}
function factory(cell: Cell, previous: Factory | undefined, handoff: { editor?: LiveEditor }): Factory {
  return (...args) => {
    if (handoff.editor) { const editor = handoff.editor; handoff.editor = undefined; return editor; }
    const editor = previous?.(...args) ?? new CustomEditor(...args);
    try { return attach(cell, args[0], editor); } catch { cell.fail(); return editor; }
  };
}
export default function atPathCompletion(pi: ExtensionAPI): void {
  let installed = false;
  const cell: Cell = { closed: false, revision: 0, queryAllowed: true, fail() {
    if (cell.closed) return;
    close();
    console.error('[at-path-completion] Unsupported autocomplete editor; keeping native Tab completion.');
  } };
  const close = () => { cell.closed = true; cell.revision++; cell.queryAllowed = false; cell.fail = () => {}; const lease = cell.lease; cell.lease = undefined; lease?.release(); };
  pi.on('session_shutdown', close);
  pi.on('session_start', async (_event, ctx) => {
    if (installed || cell.closed || ctx.mode !== 'tui') return;
    installed = true;
    const handoff: { editor?: LiveEditor } = {};
    let restore: (() => void) | undefined, editor: LiveEditor | undefined, previous: Factory | undefined;
    let setterAttempted = false;
    try {
      let tui: TUI | undefined;
      await ctx.ui.custom<void>((screen, _theme, _keys, done) => {
        if (screen.hasOverlay()) throw new Error('Active overlay');
        tui = screen; done(); return { render: () => [], invalidate() {} };
      }, { overlay: true });
      if (cell.closed) return;
      if (!tui || !('getFocusedComponent' in tui) || typeof tui.getFocusedComponent !== 'function') throw new Error('No public focus access');
      const target: unknown = tui.getFocusedComponent();
      if (!pathEditor(target) || !target.focused || tui.hasOverlay()) throw new Error('No focused live editor');
      editor = target; previous = ctx.ui.getEditorComponent();
      if (cell.closed) return;
      attach(cell, tui, editor);
      restore = preserveHandoff(editor); handoff.editor = editor;
      setterAttempted = true;
      ctx.ui.setEditorComponent(factory(cell, previous, handoff));
      restore(); restore = undefined;
      if (cell.closed) return;
      // Public host wiring rebuilds its provider chain and cancels pending native requests.
      ctx.ui.addAutocompleteProvider(current => wrapProvider(cell, current));
    } catch {
      restore?.(); restore = undefined; cell.fail();
      if (setterAttempted && editor) {
        try {
          restore = preserveHandoff(editor);
          ctx.ui.setEditorComponent(factory(cell, previous, { editor }));
        } catch { console.error('[at-path-completion] Editor rollback failed; host recovery required.'); }
      }
    } finally { restore?.(); handoff.editor = undefined; }
  });
}
