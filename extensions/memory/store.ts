import * as fs from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { withFileMutationQueue } from "@earendil-works/pi-coding-agent";
import type { ProjectIdentity } from "./identity.ts";
import { readEnabled } from "./config.ts";
import { withLock } from "./lock.ts";
import { PublishedError, atomicReplace, boundedRead, openRead, safeDirectory, safeFile, utf8 } from "./paths.ts";
import type { ReplaceHook } from "./paths.ts";
import { DIRECTORY_ENTRIES, INDEX_BYTES, INDEX_ENTRIES, LIST_BYTES, METADATA_BYTES, SCAN_BYTES, TOPIC_BYTES, checkSecrets, fail, parseHeader, revision, topic, validName } from "./policy.ts";
import type { Metadata, WriteInput } from "./policy.ts";

export interface MemoryRecord { metadata: Metadata; body: string; revision: string; path: string }
export interface Scan { entries: Metadata[]; scannedBytes: number; directoryEntries: number }
const MARKER = "<!-- pi-project-memory: derived index; refresh to rebuild -->\n";
function digest(buffer: Buffer): string { return createHash("sha256").update(buffer).digest("hex"); }
function readMetadata(path: string, name: string): { metadata: Metadata; bytes: number } {
  const fd = openRead(path);
  const buffer = Buffer.alloc(METADATA_BYTES);
  let length = 0;
  try {
    // Read only through the closing delimiter, never topic bodies. Actual bytes count toward scan budget.
    while (length < buffer.length) {
      const count = fs.readSync(fd, buffer, length, 1, null);
      if (!count) break;
      length += count;
      if (length >= 8 && buffer.subarray(length - 5, length).equals(Buffer.from("\n---\n"))) {
        const metadata = parseHeader(utf8(buffer.subarray(0, length)), name);
        checkSecrets(metadata.description);
        return { metadata, bytes: length };
      }
    }
    return fail("metadata", "Memory frontmatter is missing, malformed or exceeds 1KiB; scan aborted.");
  } finally { fs.closeSync(fd); }
}
export function buildIndex(entries: Metadata[]): { text: string; shown: number; total: number } {
  const rows = entries.map(meta => `- [${meta.name}](${meta.name}.md) (${meta.type}): ${meta.description.replace(/([\\[\]()*_`<>])/g, "\\$1")}\n`);
  let shown = Math.min(rows.length, INDEX_ENTRIES - 3);
  while (true) {
    const note = shown < entries.length ? `Omitted ${entries.length - shown} memories; use memory_list with offset/query to discover all entries.\n` : "";
    const text = MARKER + `Memories: ${entries.length}; shown: ${shown}.\n` + rows.slice(0, shown).join("") + note;
    if (Buffer.byteLength(text) <= INDEX_BYTES) return { text, shown, total: entries.length };
    shown -= 1;
    if (shown < 0) return fail("index", "Index budget cannot hold its diagnostic.");
  }
}
export class MemoryStore {
  readonly directory: string;
  readonly agentDir: string;
  readonly project: ProjectIdentity;
  private readonly beforeReplace?: ReplaceHook;
  constructor(agentDir: string, project: ProjectIdentity, beforeReplace?: ReplaceHook) {
    this.agentDir = agentDir; this.project = project; this.beforeReplace = beforeReplace;
    if (!/^[A-Za-z0-9_-]+-[a-f0-9]{64}$/.test(project.id)) fail("path", "Invalid project identity.");
    this.directory = join(agentDir, "memory", "projects", project.id);
  }
  initialize(assertActive: () => void = () => {}): void {
    assertActive(); safeDirectory(this.agentDir);
    readEnabled(this.agentDir);
    assertActive(); safeDirectory(this.directory, true);
    for (const directory of [join(this.agentDir, "memory"), join(this.agentDir, "memory", "projects"), this.directory]) fs.chmodSync(safeDirectory(directory), 0o700);
  }
  scan(): Scan {
    safeDirectory(this.directory);
    const entries: Metadata[] = [];
    let scannedBytes = 0;
    let directoryEntries = 0;
    const directory = fs.opendirSync(this.directory);
    try {
      let entry: fs.Dirent | null;
      while ((entry = directory.readSync())) {
        if (++directoryEntries > DIRECTORY_ENTRIES) fail("capacity", "Memory directory exceeds 2000 entries; no partial index or mutation is allowed.");
        if (entry.name === "MEMORY.md" || entry.name === ".memory-lock") { safeFile(join(this.directory, entry.name)); continue; }
        if (!entry.name.endsWith(".md")) continue;
        const name = entry.name.slice(0, -3);
        validName(name);
        const result = readMetadata(join(this.directory, entry.name), name);
        scannedBytes += result.bytes;
        if (scannedBytes > SCAN_BYTES) fail("capacity", "Memory metadata scan exceeds 2MiB; no partial index or mutation is allowed.");
        entries.push(result.metadata);
      }
    } finally { directory.closeSync(); }
    entries.sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0);
    return { entries, scannedBytes, directoryEntries };
  }
  read(name: string): MemoryRecord {
    validName(name);
    const path = join(this.directory, `${name}.md`);
    const buffer = boundedRead(path, TOPIC_BYTES);
    const text = utf8(buffer);
    const end = text.indexOf("\n---\n", 4);
    if (end < 0 || Buffer.byteLength(text.slice(0, end + 5)) > METADATA_BYTES) fail("metadata", "Malformed or oversized memory frontmatter.");
    const meta = parseHeader(text.slice(0, end + 5), name);
    const body = text.slice(end + 5);
    topic(meta, body); // Full validity before providing a revision or permitting an overwrite.
    return { metadata: meta, body, revision: digest(buffer), path };
  }
  list(query = "", offset = 0, limit = 20): { text: string; entries: Metadata[]; total: number; nextOffset: number | null; offset: number; scannedBytes: number } {
    if (typeof query !== "string" || [...query].length > 160 || /[\x00-\x1f\x7f-\x9f]/u.test(query) || !Number.isSafeInteger(offset) || offset < 0 || !Number.isSafeInteger(limit) || limit < 1 || limit > 50) fail("list", "Invalid list query, offset or limit (1–50).");
    const scan = this.scan();
    const matched = scan.entries.filter(meta => `${meta.name}\n${meta.description}`.toLowerCase().includes(query.toLowerCase()));
    const page: Metadata[] = [];
    const render = () => JSON.stringify({ total: matched.length, offset, nextOffset: offset + page.length < matched.length ? offset + page.length : null, entries: page });
    for (const meta of matched.slice(offset, offset + limit)) {
      page.push(meta);
      if (Buffer.byteLength(render()) > LIST_BYTES) { page.pop(); break; }
    }
    return { text: render(), entries: page, total: matched.length, offset, nextOffset: offset + page.length < matched.length ? offset + page.length : null, scannedBytes: scan.scannedBytes };
  }
  private checkIndex(): void {
    const path = join(this.directory, "MEMORY.md");
    if (!safeFile(path)) return;
    const fd = openRead(path);
    try {
      const buffer = Buffer.alloc(Buffer.byteLength(MARKER));
      const length = fs.readSync(fd, buffer, 0, buffer.length, 0);
      if (length !== buffer.length || utf8(buffer) !== MARKER) fail("index", "Unknown MEMORY.md file; refusing to overwrite it.");
    } finally { fs.closeSync(fd); }
  }
  private publishIndex(entries: Metadata[]): ReturnType<typeof buildIndex> {
    this.checkIndex();
    const index = buildIndex(entries);
    atomicReplace(join(this.directory, "MEMORY.md"), index.text, "index", this.beforeReplace, () => this.checkIndex());
    return index;
  }
  async refresh(assertActive: () => void = () => {}): Promise<ReturnType<typeof buildIndex>> {
    return withFileMutationQueue(this.directory, () => withLock(this.directory, () => {
      const scan = this.scan(); assertActive(); return this.publishIndex(scan.entries);
    }, assertActive));
  }
  async write(input: WriteInput, assertActive: () => void = () => {}): Promise<{ saved: true; revision: string; indexNeedsRepair: boolean }> {
    validName(input.name); revision(input.expectedRevision, true);
    const now = new Date().toISOString();
    // Reject body/secret/size errors before taking a lock or changing files.
    topic({ name: input.name, description: input.description, type: input.type, created: now, updated: now }, input.body);
    return this.mutate(assertActive, () => {
      const scan = this.scan(); this.checkIndex();
      const path = join(this.directory, `${input.name}.md`);
      const exists = safeFile(path);
      if (!exists && scan.directoryEntries >= DIRECTORY_ENTRIES - 1) fail("capacity", "Memory directory has no capacity for a new topic and derived index.");
      const old = exists ? this.read(input.name) : null;
      if ((old?.revision ?? null) !== input.expectedRevision) fail("conflict", "Memory revision conflict; read the current memory before retrying.");
      const meta: Metadata = { name: input.name, description: input.description, type: input.type, created: old?.metadata.created ?? now, updated: now };
      const text = topic(meta, input.body);
      assertActive();
      let publicationUncertain = false;
      try {
        atomicReplace(path, text, "topic", this.beforeReplace, () => {
          assertActive();
          const current = safeFile(path) ? this.read(input.name).revision : null;
          if (current !== input.expectedRevision) fail("conflict", "Memory changed before publication; refresh before retrying.");
        });
      } catch (error) {
        if (!(error instanceof PublishedError)) throw error;
        publicationUncertain = true;
      }
      const entries = scan.entries.filter(entry => entry.name !== input.name).concat(meta).sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0);
      let indexNeedsRepair = publicationUncertain;
      try { assertActive(); this.publishIndex(entries); } catch { indexNeedsRepair = true; }
      return { saved: true, revision: digest(Buffer.from(text)), indexNeedsRepair };
    });
  }
  async forget(name: string, expectedRevision: string, assertActive: () => void = () => {}): Promise<{ deleted: true; indexNeedsRepair: boolean }> {
    validName(name); revision(expectedRevision);
    return this.mutate(assertActive, () => {
      const scan = this.scan(); this.checkIndex();
      const old = this.read(name);
      if (old.revision !== expectedRevision) fail("conflict", "Memory revision conflict; read the current memory before retrying.");
      assertActive();
      if (this.read(name).revision !== expectedRevision) fail("conflict", "Memory changed before deletion.");
      safeFile(old.path); fs.unlinkSync(old.path);
      let indexNeedsRepair = false;
      try { assertActive(); this.publishIndex(scan.entries.filter(entry => entry.name !== name)); } catch { indexNeedsRepair = true; }
      return { deleted: true, indexNeedsRepair };
    });
  }
  private async mutate<T>(assertActive: () => void, operation: () => T): Promise<T> {
    return withFileMutationQueue(this.directory, () => withLock(this.directory, () => {
      assertActive();
      if (!readEnabled(this.agentDir)) fail("disabled", "Memory is disabled; read/list remain available, but writes and forgetting are rejected.");
      return operation();
    }, assertActive));
  }
}
