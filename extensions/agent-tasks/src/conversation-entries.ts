/**
 * Bounded conversion of agent messages (live session or `.output` JSONL) into
 * the Task Panel's structured, unstyled conversation entries. Input is treated
 * as untrusted: unknown shapes are skipped, never thrown on.
 */
import { closeSync, fstatSync, openSync, readSync } from "node:fs";
import type { ConversationEntry, ToolCallSummary, ToolDataSummary } from "../../task-ui/types.ts";

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
  return text.length <= max ? { text, elided: 0 } : { text: text.slice(0, max), elided: text.length - max };
}

/** Keep only a prefix and count inspected text blocks without joining large strings. */
function blocksText(content: unknown, budget: number): { text: string; elided: number; sourceTruncated?: boolean } {
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
  return { text: text.trim(), elided: Math.max(0, total - budget), ...(parts.length > 64 ? { sourceTruncated: true } : {}) };
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
  if (name === "write" && typeof args.content === "string") { summary.lines = lineCount(args.content); summary.bytes = Buffer.byteLength(args.content); }
  if (name === "edit") {
    const edits = Array.isArray(args.edits) ? args.edits.slice(0, 64) : [args];
    summary.addedLines = 0; summary.removedLines = 0;
    for (const edit of edits) if (isObj(edit)) {
      summary.addedLines += lineCount(str(edit.newText) ?? ""); summary.removedLines += lineCount(str(edit.oldText) ?? "");
    }
  }
  return Object.freeze(summary);
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
  return Object.freeze({ name: name.slice(0, 128), ...(detail ? { detail } : {}), ...(toolCallId ? { toolCallId } : {}), ...(summary ? { summary } : {}) });
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
      const { text, elided, sourceTruncated } = blocksText(message.content, MAX_RESULT);
      const name = str(message.toolName)?.slice(0, 128);
      if (!text && !message.isError && !sourceTruncated) return undefined;
      const toolCallId = structured ? str(message.toolCallId)?.slice(0, 200) : undefined;
      return { kind: "toolResult", ...(name ? { name } : {}), text, elided, ...(sourceTruncated ? { sourceTruncated: true } : {}), ...(toolCallId ? { toolCallId } : {}), ...(message.isError === true ? { error: true } : {}) };
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
