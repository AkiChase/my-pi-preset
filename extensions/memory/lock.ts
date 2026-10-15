import * as fs from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { boundedRead, safeDirectory, safeFile, utf8 } from "./paths.ts";
import { fail } from "./policy.ts";

interface Owner { version: 1; token: string; pid: number }
function owner(path: string): Owner {
  let value: unknown;
  try { value = JSON.parse(utf8(boundedRead(path, 256))); } catch { return fail("lock", "Unknown or malformed memory lock; manual inspection is required."); }
  if (typeof value !== "object" || value === null || !("version" in value) || value.version !== 1 || !("token" in value) || typeof value.token !== "string" || !/^[a-f0-9-]{36}$/.test(value.token) || !("pid" in value) || !Number.isSafeInteger(value.pid) || Number(value.pid) <= 0) fail("lock", "Unknown memory lock owner; refusing to steal it.");
  return value as Owner;
}
function dead(pid: number): boolean {
  // Node signal 0 is not a portable liveness probe on Windows. Unknown liveness keeps the lock.
  if (process.platform === "win32") return false;
  try { process.kill(pid, 0); return false; }
  catch (error) { return typeof error === "object" && error !== null && "code" in error && error.code === "ESRCH"; }
}
export async function withLock<T>(directory: string, operation: () => T | Promise<T>, assertActive: () => void = () => {}, waitMs = 1500): Promise<T> {
  safeDirectory(directory);
  const path = join(directory, ".memory-lock");
  const token = randomUUID();
  const deadline = Date.now() + waitMs;
  let acquired = false;
  while (!acquired) {
    assertActive();
    safeDirectory(directory);
    try {
      const fd = fs.openSync(path, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_NOFOLLOW, 0o600);
      try { fs.writeFileSync(fd, JSON.stringify({ version: 1, token, pid: process.pid })); fs.fsyncSync(fd); }
      catch (error) { fs.closeSync(fd); fs.unlinkSync(path); throw error; }
      fs.closeSync(fd);
      acquired = true;
    } catch (error) {
      if (!(typeof error === "object" && error !== null && "code" in error && error.code === "EEXIST")) throw error;
      const stat = safeFile(path);
      if (!stat) continue;
      const previous = owner(path);
      if (dead(previous.pid)) {
        // Recheck inode and token immediately before removal. PID reuse conservatively keeps a lock.
        const fresh = safeFile(path);
        if (fresh?.ino === stat.ino && fresh.dev === stat.dev && owner(path).token === previous.token && dead(previous.pid)) fs.unlinkSync(path);
        continue;
      }
      if (Date.now() >= deadline) fail("lock", "Memory is busy: lock wait timed out; no lock was stolen.");
      await delay(Math.min(25, Math.max(1, deadline - Date.now())));
    }
  }
  try { assertActive(); return await operation(); }
  finally {
    const stat = safeFile(path);
    if (stat && owner(path).token === token) fs.unlinkSync(path);
  }
}
