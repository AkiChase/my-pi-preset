import { CustomEditor, type ExtensionAPI, type ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { EditorComponent, TUI } from "@earendil-works/pi-tui";
import { preserveHandoff, type LiveEditor } from "../../editor-handoff/index.ts";
import { decorateAppearance } from "./appearance.ts";
type Factory = NonNullable<Parameters<ExtensionContext["ui"]["setEditorComponent"]>[0]>;
interface Resources { ctx: ExtensionContext; leases: Set<() => void>; seen: WeakSet<EditorComponent> }
interface Cell { value?: Resources }
function decorate(cell: Cell, editor: EditorComponent): EditorComponent {
  const resources = cell.value;
  if (!resources || resources.seen.has(editor)) return editor;
  for (const release of resources.leases) release();
  resources.leases.clear();
  const dispose = decorateAppearance(editor as CustomEditor);
  const release = () => { dispose(); resources.seen.delete(editor); };
  resources.seen.add(editor); resources.leases.add(release);
  return editor;
}
// Retirement clears the cell and pending live reference, not a host setter that would lose undo.
function factory(cell: Cell, previous: Factory | undefined, transaction: { editor?: LiveEditor }): Factory {
  return (...args) => {
    if (transaction.editor) { const editor = transaction.editor; transaction.editor = undefined; return editor; }
    const editor = previous?.(...args) ?? new CustomEditor(...args, { embedWorkingStatus: true });
    if (cell.value) {
      try { return decorate(cell, editor); }
      catch { console.error("[beautify] Unsupported editor; keeping original appearance."); }
    }
    return editor;
  };
}
export function registerAppearance(pi: ExtensionAPI): () => void {
  const cell: Cell = {};
  let closed = false, installed = false;
  const close = () => {
    closed = true;
    const resources = cell.value; cell.value = undefined;
    for (const release of resources?.leases ?? []) { try { release(); } catch { console.error("[beautify] Editor cleanup failed; keeping inactive forwarder."); } }
    resources?.leases.clear();
  };
  pi.on("session_start", async (_event, ctx) => {
    if (closed || installed || ctx.mode !== "tui") return;
    installed = true;
    const transaction: { editor?: LiveEditor } = {};
    let restore: (() => void) | undefined;
    let editor: LiveEditor | undefined;
    let previous: Factory | undefined;
    let setterAttempted = false;
    try {
      let screen: TUI | undefined;
      await ctx.ui.custom<void>((tui, _theme, _keys, done) => {
        if (tui.hasOverlay()) throw new Error("Active overlay");
        screen = tui; done(); return { render: () => [], invalidate() {} };
      }, { overlay: true });
      if (closed || !screen || screen.hasOverlay()) return;
      if (!("getFocusedComponent" in screen) || typeof screen.getFocusedComponent !== "function") throw new Error("Host lacks public focus access");
      const focused: unknown = screen.getFocusedComponent();
      if (!focused || typeof focused !== "object") throw new Error("No live editor");
      editor = focused as LiveEditor;
      if (!editor.focused || typeof editor.isShowingAutocomplete !== "function" || typeof editor.getText !== "function") throw new Error("Unsupported live editor");
      previous = ctx.ui.getEditorComponent();
      // Descriptor preflight happens while the existing UI is mounted. Padding decoration
      // precedes shielding, so both owners' synchronous handoffs preserve native layout.
      cell.value = { ctx, seen: new WeakSet(), leases: new Set() };
      decorate(cell, editor);
      restore = preserveHandoff(editor);
      transaction.editor = editor;
      setterAttempted = true;
      ctx.ui.setEditorComponent(factory(cell, previous, transaction));
    } catch {
      restore?.(); restore = undefined;
      close();
      console.error("[beautify] Editor installation failed; keeping original editing UI.");
      if (setterAttempted && editor) {
        // The SDK clears its container before invoking/wiring the factory. Rebuild with
        // the same protected instance; the inactive rollback factory delegates the predecessor.
        try {
          restore = preserveHandoff(editor);
          ctx.ui.setEditorComponent(factory({}, previous, { editor }));
        } catch { try { ctx.ui.setEditorComponent(previous); } catch { ctx.ui.setEditorComponent(undefined); } }
      }
    } finally { restore?.(); transaction.editor = undefined; }
  });
  pi.on("session_shutdown", close);
  return close;
}
