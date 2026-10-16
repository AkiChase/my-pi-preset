import { stripTerminalSequences } from "@earendil-works/pi-tui";
import * as fs from "node:fs";
import { join } from "node:path";
import { MemoryError, METADATA_BYTES, TOPIC_BYTES, checkSecrets, parseHeader, validName } from "./policy.ts";
import { openRead, utf8 } from "./paths.ts";
import type { MemoryRecord, MemoryStore } from "./store.ts";

export type MemoryDetail = Omit<MemoryRecord, "revision"> & { revision?: string; warning?: string };
/** Local-only oversized preview. Never provides a partial revision or relaxes tool reads. */
export function readDetail(store: MemoryStore, name: string): MemoryDetail {
  try { return store.read(name); }
  catch (error) { if (!(error instanceof MemoryError) || error.code !== "size") throw error; }
  validName(name);
  const path = join(store.directory, `${name}.md`);
  const fd = openRead(path);
  let buffer: Buffer;
  try {
    const bytes = Buffer.alloc(TOPIC_BYTES + 1);
    let length = 0;
    while (length < bytes.length) {
      const read = fs.readSync(fd, bytes, length, bytes.length - length, null);
      if (!read) break;
      length += read;
    }
    buffer = bytes.subarray(0, Math.min(length, TOPIC_BYTES));
  } finally { fs.closeSync(fd); }
  // Trim only an incomplete trailing UTF-8 sequence, never replace malformed interior data.
  let trim = 0;
  let start = buffer.length - 1;
  while (start >= 0 && buffer[start] >= 0x80 && buffer[start] <= 0xbf && buffer.length - start <= 3) start--;
  const lead = buffer[start];
  const expected = lead >= 0xc2 && lead <= 0xdf ? 2 : lead >= 0xe0 && lead <= 0xef ? 3 : lead >= 0xf0 && lead <= 0xf4 ? 4 : 1;
  if (expected > buffer.length - start) {
    const second = buffer[start + 1];
    // An incomplete tail must still be a valid UTF-8 prefix: reject overlong,
    // surrogate and out-of-range prefixes rather than silently trimming them.
    if ((lead === 0xe0 && second < 0xa0) || (lead === 0xed && second > 0x9f) ||
        (lead === 0xf0 && second < 0x90) || (lead === 0xf4 && second > 0x8f)) {
      throw new MemoryError("encoding", "Memory file is not valid UTF-8.");
    }
    trim = buffer.length - start;
  }
  const text = utf8(buffer.subarray(0, buffer.length - trim));
  const end = text.indexOf("\n---\n", 4);
  if (end < 0 || Buffer.byteLength(text.slice(0, end + 5)) > METADATA_BYTES) throw new MemoryError("metadata", "Malformed or oversized memory frontmatter.");
  const metadata = parseHeader(text.slice(0, end + 5), name);
  checkSecrets(text);
  return { metadata, body: text.slice(end + 5), path, warning: "Truncated preview: file exceeds 16KiB. No complete revision; read-only. Repair the file manually. Only this bounded preview was checked for credentials." };
}

/** Sanitize external data before SDK styling, leaving original bodies untouched. */
export function displayText(text: string): string {
  return stripTerminalSequences(text).replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f-\x9f]/g, "");
}
export function commandDiagnostic(error: unknown): string {
  if (error instanceof MemoryError) return displayText(error.message);
  if (typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT") {
    return "Memory project directory or file is missing. Refresh after restoring the private memory path.";
  }
  return "Memory operation failed due to a filesystem or permission error. Inspect the private agent directory.";
}
