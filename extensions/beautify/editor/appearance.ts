import type { CustomEditor } from "@earendil-works/pi-coding-agent";
import { interpose } from "../../editor-handoff/index.ts";
type Hooks = { renderTopBorder(width: number, hidden: number): string };
interface Appearance { hidden: number; padding: number; ownedPadding: number }
// Separate function environment: later opaque wrappers retain only originals and an empty cell.
function forwarders(cell: { value?: Appearance }, render: CustomEditor["render"], top: Hooks["renderTopBorder"], get: CustomEditor["getPaddingX"], set: CustomEditor["setPaddingX"]) {
  return {
    render(this: CustomEditor, width: number) {
      const lines = render.call(this, width);
      const state = cell.value;
      // A later plugin may bypass our setter. Do not interpret user indentation
      // as the old prompt gutter once the physical padding is no longer ours.
      if (state && get.call(this) === state.ownedPadding && state.hidden === 0 && width >= 5 && lines[1]?.startsWith("  ")) {
        const left = Math.min(state.ownedPadding, Math.max(0, Math.floor((width - 1) / 2)));
        lines[1] = " ".repeat(left - 2) + this.borderColor("❯") + " " + lines[1].slice(left);
      }
      return lines;
    },
    top(this: CustomEditor, width: number, hidden: number) {
      if (cell.value) cell.value.hidden = hidden;
      return top.call(this, width, hidden);
    },
    get(this: CustomEditor) { return cell.value?.padding ?? get.call(this); },
    set(this: CustomEditor, padding: number) {
      if (!cell.value) { set.call(this, padding); return; }
      cell.value.padding = Number.isFinite(padding) ? Math.max(0, Math.floor(padding)) : 0;
      set.call(this, cell.value.padding + 2);
      cell.value.ownedPadding = get.call(this);
    },
  };
}
export function decorateAppearance(editor: CustomEditor): () => void {
  const hooks = editor as unknown as Hooks;
  if (typeof hooks.renderTopBorder !== "function" || typeof editor.getPaddingX !== "function" || typeof editor.setPaddingX !== "function") throw new Error("Editor lacks public border/padding hooks");
  const get = editor.getPaddingX, set = editor.setPaddingX;
  const padding = get.call(editor);
  const cell: { value?: Appearance } = { value: { hidden: 0, padding, ownedPadding: padding } };
  const methods = forwarders(cell, editor.render, hooks.renderTopBorder, get, set);
  const restores: (() => void)[] = [];
  try {
    restores.push(interpose(editor, "render", { writable: true, value: methods.render }));
    restores.push(interpose(editor, "renderTopBorder", { writable: true, value: methods.top }));
    restores.push(interpose(editor, "getPaddingX", { writable: true, value: methods.get }));
    restores.push(interpose(editor, "setPaddingX", { writable: true, value: methods.set }));
    // Native layout, wrapping, cursor marker and mouse coordinates share this padding.
    methods.set.call(editor, padding);
  } catch (error) { cell.value = undefined; for (const restore of restores.reverse()) restore(); set.call(editor, padding); throw error; }
  let active = true;
  return () => {
    if (!active) return; active = false;
    const state = cell.value!;
    cell.value = undefined;
    let ownsPadding = false;
    try { ownsPadding = editor.getPaddingX === methods.get && editor.setPaddingX === methods.set && get.call(editor) === state.ownedPadding; }
    catch { console.error("[beautify] Padding ownership is unavailable; keeping later state."); }
    for (const restore of restores.reverse()) { try { restore(); } catch { console.error("[beautify] Appearance method is now locked; retaining inactive forwarder."); } }
    if (ownsPadding) set.call(editor, state.padding);
  };
}
