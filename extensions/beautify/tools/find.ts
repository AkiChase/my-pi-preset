import { searchNotice, splitView, wrap } from "../layout.ts";
import { text } from "../types.ts";
import { fallback, genericMetadata, renderers, type TimingDisplay } from "./shared.ts";

export function createFindRenderers(timing?: TimingDisplay) {
  return renderers("find", (result, theme, ctx, width) => {
    const view = splitView(text(result), searchNotice);
    // Native Find records are non-empty single-line paths. An unrecognized
    // separator/notice (or newline in a filename) is not a reliable file count.
    if (ctx.isError || view.body === "No files found matching pattern" || view.lines.some(line => line === "")) return fallback(result, theme, ctx, width);
    const notices = view.notice.flatMap(line => wrap(line, width).map(row => theme.fg("muted", row)));
    const rows: string[] = [];
    let previous: string | undefined;
    for (const path of view.lines) {
      const slash = path.lastIndexOf("/");
      const directory = slash < 0 ? "." : path.slice(0, slash), file = path.slice(slash + 1);
      if (directory !== previous) { rows.push(...wrap(directory, width).map(line => theme.bold(theme.fg("accent", line)))); previous = directory; }
      rows.push(...wrap("  " + file, width));
    }
    return rows.concat(notices);
  }, (result, ctx) => {
    if (!result || ctx.isError) return genericMetadata(result, ctx);
    const view = splitView(text(result), searchNotice);
    if (view.body === "No files found matching pattern") return { stats: "No files found" };
    if (!view.lines.length || view.lines.some(line => !line || line.startsWith("["))) return genericMetadata(result, ctx);
    return { stats: `${view.lines.length} files shown${view.notice.length ? " · limited" : ""}` };
  }, timing);
}

export const findRenderers = createFindRenderers();
