import { keyHint, type Theme } from "@earendil-works/pi-coding-agent";
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import type { View } from "./types.ts";

// External SGR/OSC/C0 must not become terminal instructions; SDK/Shiki styling is added later.
export function clean(text: string): string {
  return text.replace(/\r\n?/g, "\n").replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g, "").replace(/\x1b(?:\[[0-?]*[ -/]*[@-~]|[ -/]*[@-~])/g, "").replace(/[\x00-\x08\x0b-\x1f\x7f-\x9f]/g, "").replace(/\t/g, "    ");
}
export function clip(text: string, width: number, marker = "›"): string { return truncateToWidth(text, Math.max(0, width), marker); }
// Plain summary fields have no styles to preserve. SDK truncation adds a full
// reset even for plain input; remove it before fg styling so the host owns bg.
function clipPlain(text: string, width: number): string { return clean(clip(text, width, "")); }
export function wrap(text: string, width: number): string[] {
  if (width < 1) return [];
  const output: string[] = [];
  for (const line of clean(text).split("\n")) {
    let row = "";
    for (const { segment } of new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(line)) {
      if (visibleWidth(row + segment) > width) { if (row) output.push(row); row = ""; }
      if (visibleWidth(segment) <= width) row += segment;
    }
    output.push(row);
  }
  return output;
}
export function middlePath(path: string, width: number, suffix = ""): string {
  const room = width - visibleWidth(suffix);
  if (room < 1) return visibleWidth(suffix) <= width ? suffix : "";
  if (visibleWidth(path) <= room) return path + suffix;
  if (room === 1) return "…" + suffix;
  const graphemes = [...new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(path)].map(item => item.segment);
  const tailRoom = Math.ceil((room - 1) * 0.7);
  let tail = "";
  while (graphemes.length && visibleWidth(graphemes.at(-1)! + tail) <= tailRoom) tail = graphemes.pop()! + tail;
  const head = clipPlain(graphemes.join(""), room - 1 - visibleWidth(tail));
  return head + "…" + tail + suffix;
}
export function summary(path: string, suffix: string, stats: string, width: number, theme: Theme, secondary = "", showHint = true): string[] {
  if (width < 1) return [];
  path = clean(path).replace(/\n/g, "\\n");
  stats = clean(stats).replace(/\n/g, "\\n");
  secondary = clean(secondary).replace(/\n/g, "\\n");
  const hint = showHint ? clean(keyHint("app.tools.expand", "expand")) : "";
  const minimumTitle = Math.min(visibleWidth(path + suffix), Math.max(visibleWidth(suffix), Math.min(12, Math.floor(width / 3))));
  const fields = secondary ? secondary.split(" · ") : [];
  let metadata = [stats, ...fields, hint].filter(Boolean).join(" · ");
  while (fields.length && visibleWidth(metadata) + minimumTitle + 2 > width) {
    fields.pop(); metadata = [stats, ...fields, hint].filter(Boolean).join(" · ");
  }
  if (visibleWidth(metadata) + minimumTitle + 2 > width) metadata = stats;
  if (visibleWidth(metadata) + minimumTitle + 2 > width) metadata = clipPlain(stats, Math.max(0, width - minimumTitle - 2));
  const room = width - (metadata ? visibleWidth(metadata) + 2 : 0);
  const label = middlePath(path, room, suffix);
  return [theme.fg("accent", label) + (metadata ? "  " + theme.fg("muted", metadata) : "")];
}
export function toolHeading(name: string, detail: string, suffix: string, stats: string, width: number, theme: Theme, expanded: boolean, secondary = "", showHint = true): string[] {
  if (width < 1) return [];
  if (expanded) return wrap(name + (detail || suffix ? "  " + detail + suffix : ""), width).map(line => theme.fg("accent", line));
  // Identity is a separate field: middle-path clipping may only shorten details.
  const identity = clipPlain(name, width);
  const room = width - visibleWidth(identity) - 2;
  if (room < 1) return [theme.fg("accent", identity)];
  const rest = summary(detail, suffix, stats, room, theme, secondary, showHint)[0]!;
  return [theme.fg("accent", identity) + (visibleWidth(rest) ? "  " + rest : "")];
}
export function splitView(raw: string, noticePattern: RegExp): View {
  const text = clean(raw);
  const match = text.match(noticePattern);
  const body = match ? text.slice(0, match.index) : text;
  return { body, notice: match ? [match[0].replace(/^\n\n/, "")] : [], lines: body === "" ? [] : body.split("\n") };
}
// Pi 1.2 appends continuation notices after exactly two separator newlines.
// A first-line byte overflow instead returns only the notice. Do not consume
// lookalikes embedded in code, or erase trailing blank lines from the source.
const size = String.raw`\d+(?:\.\d+)?(?:B|KB|MB)`;
export const readNotice = new RegExp(String.raw`(?:\n\n\[(?:Showing lines \d+-\d+ of \d+(?: \(${size} limit\))?\. Use offset=\d+ to continue\.|\d+ more lines in file\. Use offset=\d+ to continue\.)\]|^\[Line \d+ is ${size}, exceeds ${size} limit\. Use bash: sed -n '\d+p' [^\n]+ \| head -c \d+\])$`);
const searchLimit = String.raw`\d+ (?:results|matches) limit reached(?:\. Use limit=\d+ for more, or refine pattern)?`;
const byteLimit = String.raw`${size} limit reached`;
const lineLimit = String.raw`Some lines truncated to \d+ chars\. Use read tool to see full lines`;
export const searchNotice = new RegExp(String.raw`\n\n\[(?:${searchLimit}(?:\. ${byteLimit})?(?:\. ${lineLimit})?|${byteLimit}(?:\. ${lineLimit})?|${lineLimit})\]$`);
