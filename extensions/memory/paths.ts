import * as fs from "node:fs";
import { dirname, isAbsolute, join, parse, resolve, sep } from "node:path";
import { randomUUID } from "node:crypto";
import { fail, MemoryError } from "./policy.ts";

export class PublishedError extends MemoryError {
  constructor() { super("durability", "Memory file was published, but directory durability confirmation failed."); }
}

// Check every ancestor, including the public agent root. Never canonicalize a symlink into trust.
export function safeDirectory(path: string, create = false): string {
  if (!isAbsolute(path) || path.includes("\0") || path.startsWith("//") || path.startsWith("\\\\")) fail("path", "Unsafe memory directory.");
  const target = resolve(path);
  let current = parse(target).root;
  for (const part of target.slice(current.length).split(sep).filter(Boolean)) {
    current = join(current, part);
    try {
      const stat = fs.lstatSync(current);
      if (stat.isSymbolicLink() || !stat.isDirectory()) fail("path", "Memory path contains a symlink or non-directory ancestor.");
    } catch (error) {
      if (!missing(error)) throw error;
      if (!create) throw error;
      fs.mkdirSync(current, { mode: 0o700 });
    }
  }
  return target;
}
export function missing(error: unknown): boolean { return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT"; }
export function safeFile(path: string): fs.Stats | null {
  safeDirectory(dirname(path));
  try {
    const stat = fs.lstatSync(path);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1) fail("path", "Memory file is not a private regular file.");
    return stat;
  } catch (error) { if (missing(error)) return null; throw error; }
}
export function openRead(path: string): number {
  const before = safeFile(path);
  if (!before) fail("missing", "Memory file does not exist.");
  const fd = fs.openSync(path, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK);
  const after = fs.fstatSync(fd);
  if (!after.isFile() || after.nlink !== 1 || before.ino !== after.ino || before.dev !== after.dev) { fs.closeSync(fd); fail("path", "Memory file changed while opening."); }
  return fd;
}
export function boundedRead(path: string, max: number): Buffer {
  const fd = openRead(path);
  try {
    if (fs.fstatSync(fd).size > max) fail("size", "Memory file exceeds its read budget; no complete revision is available.");
    const buffer = Buffer.alloc(max + 1);
    let length = 0;
    while (length < buffer.length) {
      const count = fs.readSync(fd, buffer, length, buffer.length - length, null);
      if (!count) break;
      length += count;
    }
    if (length > max) fail("size", "Memory file grew beyond its read budget.");
    return buffer.subarray(0, length);
  } finally { fs.closeSync(fd); }
}
export function utf8(buffer: Buffer): string {
  try { return new TextDecoder("utf-8", { fatal: true }).decode(buffer); }
  catch { return fail("encoding", "Memory file is not valid UTF-8."); }
}
export type ReplaceHook = (kind: "topic" | "index" | "config", temp: string, target: string) => void;
// Narrow failure-injection seam at the actual publication boundary, not a replacement filesystem.
export function atomicReplace(path: string, text: string, kind: "topic" | "index" | "config", beforeReplace?: ReplaceHook, validateTarget?: () => void): void {
  safeDirectory(dirname(path));
  const original = safeFile(path);
  const temp = join(dirname(path), `.memory-tmp-${randomUUID()}`);
  const fd = fs.openSync(temp, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_NOFOLLOW, 0o600);
  const owned = fs.fstatSync(fd);
  const ownsTemp = (stat: fs.Stats | null) => stat?.ino === owned.ino && stat.dev === owned.dev;
  try {
    try { fs.writeFileSync(fd, text); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
    beforeReplace?.(kind, temp, path);
    const current = safeFile(path);
    if (original?.ino !== current?.ino || original?.dev !== current?.dev) fail("conflict", "Memory target changed before publication.");
    if (!ownsTemp(safeFile(temp)) || !boundedRead(temp, Buffer.byteLength(text)).equals(Buffer.from(text))) fail("conflict", "Memory temporary file changed before publication.");
    validateTarget?.();
    fs.renameSync(temp, path);
    try {
      const directory = fs.openSync(dirname(path), fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
      try { fs.fsyncSync(directory); } finally { fs.closeSync(directory); }
    } catch { throw new PublishedError(); }
  } finally {
    // Foreign substitutions are not ours to delete, even when they are regular files.
    if (ownsTemp(safeFile(temp))) fs.unlinkSync(temp);
  }
}
