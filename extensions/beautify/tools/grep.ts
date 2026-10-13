import type { Theme } from "@earendil-works/pi-coding-agent";
import { clean, searchNotice, splitView, wrap } from "../layout.ts";
import { text, type Args } from "../types.ts";
import { fallback, genericMetadata, numbered, renderers } from "./shared.ts";
export interface Match { path: string; number: number; body: string; match: boolean }
export function parseMatch(line: string): Match | undefined {
  // Multiple numeric delimiters or mixed match/context delimiters are ambiguous paths.
  const candidates = [...line.matchAll(/([:-])(\d+)\1 /g)];
  if (candidates.length !== 1) return undefined;
  const candidate = candidates[0]!;
  const path = line.slice(0, candidate.index);
  if (!path || path.includes(":")) return undefined;
  return { path, number: Number(candidate[2]), body: line.slice(candidate.index! + candidate[0].length), match: candidate[1] === ":" };
}
export function highlightMatch(body: string, args: Args, theme: Theme): string {
  const pattern = String(args.pattern ?? "");
  if (!pattern || pattern.length > 1_000 || body.length > 8_000) return body;
  // Native rg supports constructs JS does not. Avoid nested quantifiers/backrefs rather
  // than risking a blocking regex in a synchronous terminal render.
  if (!args.literal && /[()\\]|(?:[+*?]|\{[^}]*\}).*(?:[+*?]|\{)/.test(pattern)) return body;
  try {
    const escaped = args.literal ? pattern.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") : pattern;
    const regex = new RegExp(escaped, args.ignoreCase ? "gi" : "g");
    const matches = [...body.matchAll(regex)];
    if (matches.some(match => match[0].length === 0)) return body;
    let output = "", end = 0;
    for (const match of matches) {
      output += body.slice(end, match.index) + theme.bold(theme.fg("warning", match[0])); end = match.index! + match[0].length;
    }
    return output + body.slice(end);
  } catch { return body; }
}
export const grepRenderers = renderers("grep", (result, theme, ctx, width) => {
  const view = splitView(text(result), searchNotice);
  if (ctx.isError || view.body === "No matches found") return fallback(result, theme, ctx, width);
  const records = view.lines.map(parseMatch);
  if (records.some(record => !record)) return fallback(result, theme, ctx, width);
  const notice = view.notice.flatMap(line => wrap(line, width).map(row => theme.fg("muted", row)));
  const rows: string[] = [];
  let previous: string | undefined;
  const digits = String(Math.max(1, ...records.map(record => record!.number))).length;
  for (const record of records as Match[]) {
    if (record.path !== previous) { rows.push(...wrap(record.path, width).map(line => theme.bold(theme.fg("accent", line)))); previous = record.path; }
    rows.push(numbered(record.match ? highlightMatch(clean(record.body), ctx.args, theme) : record.body, record.number, digits, width, theme, record.match));
  }
  return rows.concat(notice);
}, (result, ctx) => {
  if (!result || ctx.isError) return genericMetadata(result, ctx);
  const view = splitView(text(result), searchNotice);
  if (view.body === "No matches found") return { stats: "No matches found" };
  const records = view.lines.map(parseMatch);
  if (!records.length || records.some(record => !record)) return genericMetadata(result, ctx);
  return { stats: `${records.filter(record => record?.match).length} matching lines shown${view.notice.length ? " · limited" : ""}` };
});
