import type { EditorComponent, TUI } from "@earendil-works/pi-tui";
import type { LiveEditor } from "../editor-handoff/index.ts";
export type PathEditor = LiveEditor & { getLines(): string[]; getCursor(): { line: number; col: number } };
export type FocusScreen = TUI & { getFocusedComponent(): unknown };
export function pathEditor(value: unknown): value is PathEditor {
  if (!value || typeof value !== "object") return false;
  const e = value as Partial<PathEditor>;
  return typeof e.focused === "boolean" && [e.getText, e.setText, e.handleInput, e.isShowingAutocomplete, e.getLines, e.getCursor, e.setAutocompleteProvider].every(fn => typeof fn === "function");
}
/** The ONLY private capability used here. Pi 1.2: false means ordinary, non-Tab request.
 * Structural detection cannot prove semantics on future SDK versions; keep upgrade regressions. */
export function requestCapability(editor: EditorComponent): (this: EditorComponent, explicitTab: false) => void {
  const candidate: unknown = Reflect.get(editor, "tryTriggerAutocomplete");
  if (typeof candidate !== "function") throw new Error("Missing ordinary autocomplete request capability");
  return candidate as (this: EditorComponent, explicitTab: false) => void;
}
