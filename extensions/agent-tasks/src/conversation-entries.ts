/**
 * Bounded conversion of agent messages (live session or `.output` JSONL) into
 * the Task Panel's structured, unstyled conversation entries. Input is treated
 * as untrusted: unknown shapes are skipped, never thrown on.
 */
import { closeSync, fstatSync, openSync, readSync } from "node:fs";
import { isLaunchMetadata, type RuntimeLaunchMetadata } from "../../runtime-tasks/launch.ts";
import type { ConversationEntry, ToolCallSummary, ToolDataSummary, ToolParameters } from "../../task-ui/types.ts";

export const MAX_ENTRIES = 64;
export const MAX_TEXT = 8_000;
export const MAX_RESULT = 2_000;
export const MAX_TOOL_DETAIL = 200;
/** Transcript tail read when the live session is gone. */
export const TRANSCRIPT_TAIL_BYTES = 256 * 1024;

type Obj = Record<string, unknown>;
const isObj = (value: unknown): value is Obj => value !== null && typeof value === "object" && !Array.isArray(value);
const str = (value: unknown): string | undefined => typeof value === "string" ? value : undefined;

function cap(text: string, max: number): { text: string; elided: number } {
  if (text.length <= max) return { text, elided: 0 };
  const end = /[\uD800-\uDBFF]/.test(text[max - 1] ?? "") ? max - 1 : max;
  return { text: text.slice(0, end), elided: text.length - end };
}

/** Keep only a prefix and count inspected text blocks without joining large strings. */
function blocksText(content: unknown, budget: number, preserve = false): { text: string; elided: number; sourceTruncated?: boolean } {
  const parts = typeof content === "string" ? [content] : Array.isArray(content) ? content : [];
  let text = "", total = 0, count = 0;
  for (const part of parts.slice(0, 64)) {
    const value = typeof part === "string" ? part : isObj(part) && part.type === "text" ? str(part.text) : undefined;
    if (!value) continue;
    const separator = count++ ? "\n" : "";
    total += separator.length + value.length;
    if (text.length < budget) text += (separator + value.slice(0, budget)).slice(0, budget - text.length);
  }
  // Preserve trim semantics for normal output; elision counts the original text
  // beyond the retained prefix, not an artificial budget+1 sentinel.
  const retained = cap(text, budget);
  if (/[\uD800-\uDBFF]$/.test(retained.text)) retained.text = retained.text.slice(0, -1);
  return { text: preserve ? retained.text : retained.text.trim(), elided: Math.max(0, total - retained.text.length), ...(parts.length > 64 ? { sourceTruncated: true } : {}) };
}

function lineCount(text: string): number {
  if (!text) return 0;
  let count = 1;
  for (let i = 0; i < text.length; i++) if (text.charCodeAt(i) === 10) count++;
  return count;
}
const number = (value: unknown): number | undefined => typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : undefined;
function dataSummary(name: string, args: Obj): ToolDataSummary | undefined {
  if (name !== "read" && name !== "write" && name !== "edit" && name !== "bash") return undefined;
  const path = (str(args.path) ?? str(args.file_path))?.slice(0, MAX_TOOL_DETAIL * 5);
  const summary: { kind: "read" | "write" | "edit" | "bash"; command?: string; path?: string; offset?: number; limit?: number; lines?: number; bytes?: number; addedLines?: number; removedLines?: number } = { kind: name, ...(path ? { path } : {}) };
  if (name === "bash") summary.command = str(args.command)?.slice(0, MAX_TOOL_DETAIL * 5);
  if (name === "read") { summary.offset = number(args.offset); summary.limit = number(args.limit); }
  if (name === "write" && typeof args.content === "string" && args.content.length <= 16 * 1024) { summary.lines = lineCount(args.content); summary.bytes = Buffer.byteLength(args.content); }
  if (name === "edit") {
    const edits = Array.isArray(args.edits) ? args.edits.slice(0, 64) : [args];
    if (edits.some(edit => isObj(edit) && ((str(edit.newText)?.length ?? 0) > 16 * 1024 || (str(edit.oldText)?.length ?? 0) > 16 * 1024))) return Object.freeze(summary);
    summary.addedLines = 0; summary.removedLines = 0;
    for (const edit of edits) if (isObj(edit)) {
      summary.addedLines += lineCount(str(edit.newText) ?? ""); summary.removedLines += lineCount(str(edit.oldText) ?? "");
    }
  }
  return Object.freeze(summary);
}

/** Serialize JSON only, with bounded traversal and no getters/toJSON execution. */
export function toolParameters(value: unknown): ToolParameters {
  if (!isObj(value)) return Object.freeze({ status: "unavailable" });
  let remaining = 16 * 1024, nodes = 2048;
  const seen = new Set<object>();
  const copy = (v: unknown, depth: number): unknown => {
    if (--nodes < 0 || depth > 16) throw new Error("budget");
    if (typeof v === "string") { remaining -= v.length * 6 + 2; if (remaining < 0) throw new Error("budget"); return v; }
    if (v === null || typeof v === "boolean" || typeof v === "number" && Number.isFinite(v)) { remaining -= 24; if (remaining < 0) throw new Error("budget"); return v; }
    if (!v || typeof v !== "object" || seen.has(v)) throw new Error("not JSON");
    if (!Array.isArray(v) && Object.getPrototypeOf(v) !== Object.prototype && Object.getPrototypeOf(v) !== null) throw new Error("not JSON");
    if (Array.isArray(v) && v.length > nodes) throw new Error("budget");
    seen.add(v);
    const out: unknown[] | Record<string, unknown> = Array.isArray(v) ? [] : Object.create(null);
    let count = 0;
    for (const key in v) {
      if (!Object.hasOwn(v, key)) continue;
      if (Array.isArray(v) && key !== String(count)) throw new Error("not JSON");
      count++;
      if (--nodes < 0 || (remaining -= key.length * 6 + 4) < 0) throw new Error("budget");
      const prop = Object.getOwnPropertyDescriptor(v, key);
      if (!prop || !("value" in prop)) throw new Error("not JSON");
      if (Array.isArray(out)) out.push(copy(prop.value, depth + 1));
      else out[key] = copy(prop.value, depth + 1);
    }
    if (Array.isArray(v) && count !== v.length) throw new Error("not JSON");
    seen.delete(v); return out;
  };
  try { return Object.freeze({ status: "complete", json: JSON.stringify(copy(value, 0)) }); }
  catch (error) { return Object.freeze({ status: error instanceof Error && error.message === "budget" ? "truncated" : "unavailable" }); }
}

/** Copy only the bounded plain bash identity used by the main renderer. No getters or extra details. */
function bashLaunch(details: Obj | undefined): Extract<RuntimeLaunchMetadata, { task_type: "bash" | "monitor" }> | undefined {
  const property = details && Object.getOwnPropertyDescriptor(details, "runtimeLaunch");
  const value: unknown = property && "value" in property ? property.value : undefined;
  if (!isObj(value) || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) return undefined;
  const copy: Obj = {};
  let count = 0;
  for (const key in value) {
    if (!Object.hasOwn(value, key)) continue;
    if (++count > 4 || !["version", "task_type", "task_id", "mode"].includes(key)) return undefined;
    const field = Object.getOwnPropertyDescriptor(value, key);
    if (!field || !("value" in field)) return undefined;
    copy[key] = field.value;
  }
  if (copy.version !== 2 || copy.task_type !== "bash" || (copy.mode !== "foreground" && copy.mode !== "background") ||
      typeof copy.task_id !== "string" || copy.task_id.length > 200 || /[\x00-\x1f\x7f-\x9f]/.test(copy.task_id) ||
      !isLaunchMetadata(copy) || !("task_type" in copy)) return undefined;
  return Object.freeze(copy);
}

const PRIMARY_ARGS = ["command", "path", "file_path", "pattern", "query", "url", "description", "action", "prompt"];
function toolSummary(block: Obj, structured = false): ToolCallSummary | undefined {
  const name = str(block.name);
  if (!name) return undefined;
  const args = isObj(block.arguments) ? block.arguments : undefined;
  let detail: string | undefined;
  if (args) for (const key of PRIMARY_ARGS) {
    const value = str(args[key])?.slice(0, MAX_TOOL_DETAIL * 5);
    if (value?.trim()) { detail = value.replace(/\s+/g, " ").trim().slice(0, MAX_TOOL_DETAIL); break; }
  }
  const toolCallId = structured ? str(block.id)?.slice(0, 200) : undefined;
  const summary = structured && args ? dataSummary(name, args) : undefined;
  return Object.freeze({ name: name.slice(0, 128), ...(detail ? { detail } : {}), ...(toolCallId ? { toolCallId } : {}), ...(summary ? { summary } : {}), ...(structured ? { parameters: toolParameters(args) } : {}) });
}

/** One message → at most one entry; unknown roles and empty content yield none. */
export function entryFromMessage(message: unknown, structured = false): ConversationEntry | undefined {
  if (!isObj(message)) return undefined;
  switch (message.role) {
    case "user": {
      const text = blocksText(message.content, MAX_TEXT).text;
      return text ? { kind: "user", text: cap(text, MAX_TEXT).text } : undefined;
    }
    case "assistant": {
      if (!Array.isArray(message.content)) return undefined;
      let text = "";
      const tools: ToolCallSummary[] = [];
      for (const block of message.content.slice(0, 64)) {
        if (!isObj(block)) continue;
        if (block.type === "text" && typeof block.text === "string" && text.length <= MAX_TEXT) text += ((text ? "\n" : "") + block.text.slice(0, MAX_TEXT)).slice(0, MAX_TEXT - text.length);
        else if (block.type === "toolCall" && tools.length < 16) { const tool = toolSummary(block, structured); if (tool) tools.push(tool); }
      }
      text = cap(text.trim(), MAX_TEXT).text;
      const error = str(message.errorMessage);
      if (!text && !tools.length) return error ? { kind: "notice", text: `Error: ${error.slice(0, MAX_RESULT)}` } : undefined;
      return { kind: "assistant", text, tools };
    }
    case "toolResult": {
      const { text, elided, sourceTruncated } = blocksText(message.content, MAX_RESULT, structured);
      const name = str(message.toolName)?.slice(0, 128);
      if (!text && !message.isError && !sourceTruncated && !(structured && str(message.toolCallId))) return undefined;
      const durationMs = structured && typeof message.durationMs === "number" && Number.isFinite(message.durationMs) && message.durationMs >= 0 ? message.durationMs : undefined;
      const toolCallId = structured ? str(message.toolCallId)?.slice(0, 200) : undefined;
      const details = structured && isObj(message.details) ? message.details : undefined;
      const diff = details && str(details.diff);
      const runtimeLaunch = name === "bash" ? bashLaunch(details) : undefined;
      const display = structured ? Object.freeze({ status: elided || sourceTruncated ? "truncated" as const : !text && Array.isArray(message.content) && message.content.slice(0, 64).some(part => !isObj(part) || part.type !== "text") ? "unavailable" as const : "complete" as const,
        ...(runtimeLaunch ? { runtimeLaunch } : {}),
        ...(diff === undefined ? {} : { diff: cap(diff, MAX_RESULT * 4).text, diffTruncated: diff.length > MAX_RESULT * 4 }),
        ...(number(details?.firstChangedLine) === undefined ? {} : { firstChangedLine: number(details?.firstChangedLine) }) }) : undefined;
      return { kind: "toolResult", ...(display ? { display } : {}), ...(durationMs === undefined ? {} : { durationMs }), ...(name ? { name } : {}), text, elided, ...(sourceTruncated ? { sourceTruncated: true } : {}), ...(toolCallId ? { toolCallId } : {}), ...(message.isError === true ? { error: true } : {}) };
    }
    case "bashExecution": {
      const command = str(message.command);
      if (!command) return undefined;
      const { text, elided } = cap((str(message.output) ?? "").trim(), MAX_RESULT);
      const exitCode = typeof message.exitCode === "number" ? message.exitCode : undefined;
      return { kind: "bash", command: command.slice(0, MAX_TOOL_DETAIL * 5), output: text, elided, ...(exitCode === undefined ? {} : { exitCode }) };
    }
    case "compactionSummary": return { kind: "notice", text: "Earlier conversation was compacted." };
    case "branchSummary": return { kind: "notice", text: "Conversation branch summarized." };
    default: return undefined;
  }
}

export interface ConversationSlice { readonly entries: readonly ConversationEntry[]; readonly truncated: boolean }

function finish(entries: ConversationEntry[], truncatedBefore: boolean): ConversationSlice {
  const drop = Math.max(0, entries.length - MAX_ENTRIES);
  return Object.freeze({ entries: Object.freeze(entries.slice(drop).map(entry => Object.freeze(entry))), truncated: truncatedBefore || drop > 0 });
}

/** Live session messages; only the newest bounded window is converted. */
export function fromMessages(messages: readonly unknown[]): ConversationSlice {
  // Over-select so empty/skipped messages do not shrink the visible window.
  const start = Math.max(0, messages.length - MAX_ENTRIES * 3);
  const entries: ConversationEntry[] = [];
  for (const message of messages.slice(start)) { const entry = entryFromMessage(message); if (entry) entries.push(entry); }
  return finish(entries, start > 0);
}

/**
 * Transcript JSONL text. When the text starts mid-file, its first (partial)
 * line is discarded; malformed lines are skipped.
 */
export function fromJsonl(text: string, startsMidFile: boolean): ConversationSlice {
  const lines = text.split("\n");
  if (startsMidFile) lines.shift();
  const entries: ConversationEntry[] = [];
  for (const line of lines) {
    if (!line.trim()) continue;
    let parsed: unknown;
    try { parsed = JSON.parse(line); } catch { continue; }
    const entry = isObj(parsed) ? entryFromMessage(parsed.message) : undefined;
    if (entry) entries.push(entry);
  }
  return finish(entries, startsMidFile);
}

/** Bounded tail read of a transcript file; undefined when unreadable. */
export function readTranscriptTail(path: string, bytes = TRANSCRIPT_TAIL_BYTES): ConversationSlice | undefined {
  let fd: number | undefined;
  try {
    fd = openSync(path, "r");
    const stat = fstatSync(fd);
    if (!stat.isFile()) return undefined;
    const start = Math.max(0, stat.size - bytes);
    const buffer = Buffer.alloc(stat.size - start);
    const read = readSync(fd, buffer, 0, buffer.length, start);
    return fromJsonl(buffer.subarray(0, read).toString("utf8"), start > 0);
  } catch { return undefined; }
  finally { if (fd !== undefined) { try { closeSync(fd); } catch { /* read-only probe */ } } }
}
