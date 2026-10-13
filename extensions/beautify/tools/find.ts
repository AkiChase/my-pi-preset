import { searchNotice, splitView, summary, wrap } from "../layout.ts";
import { text } from "../types.ts";
import { fallback, renderers } from "./shared.ts";
export const findRenderers = renderers("find", (result, theme, ctx, width) => {
  const view = splitView(text(result), searchNotice);
  // Native Find records are non-empty single-line paths. An unrecognized
  // separator/notice (or newline in a filename) is not a reliable file count.
  if (ctx.isError || view.body === "No files found matching pattern" || view.lines.some(line => line === "")) return fallback(result, theme, ctx, width);
  const notices = view.notice.flatMap(line => wrap(line, width).map(row => theme.fg("muted", row)));
  if (!ctx.expanded) return summary("Files", "", `${view.lines.length} files shown`, width, theme).concat(notices);
  const rows: string[] = [];
  let previous: string | undefined;
  for (const path of view.lines) {
    const slash = path.lastIndexOf("/");
    const directory = slash < 0 ? "." : path.slice(0, slash), file = path.slice(slash + 1);
    if (directory !== previous) { rows.push(...wrap(directory, width).map(line => theme.bold(theme.fg("accent", line)))); previous = directory; }
    rows.push(...wrap("  " + file, width));
  }
  return rows.concat(notices);
});
