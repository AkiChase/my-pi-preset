import { join } from "node:path";
import { atomicReplace, boundedRead, safeDirectory, safeFile, utf8 } from "./paths.ts";
import { withLock } from "./lock.ts";
import { fail } from "./policy.ts";

export function readEnabled(agentDir: string): boolean {
  safeDirectory(agentDir);
  const path = join(agentDir, "memory.json");
  if (!safeFile(path)) return true;
  let value: unknown;
  try { value = JSON.parse(utf8(boundedRead(path, 1024))); } catch { return fail("config", "Memory configuration is malformed or exceeds 1KiB."); }
  if (typeof value !== "object" || value === null || Array.isArray(value) || Object.keys(value).some(key => key !== "enabled") || !("enabled" in value) || typeof value.enabled !== "boolean") fail("config", "Memory configuration requires only an enabled boolean.");
  return value.enabled;
}
export async function setEnabled(agentDir: string, enabled: boolean, assertActive: () => void = () => {}): Promise<void> {
  if (typeof enabled !== "boolean") fail("config", "Memory enabled must be boolean.");
  safeDirectory(agentDir);
  await withLock(agentDir, () => {
    readEnabled(agentDir); // Never overwrite an unknown configuration.
    assertActive();
    atomicReplace(join(agentDir, "memory.json"), JSON.stringify({ enabled }, null, 2), "config", undefined, () => {
      assertActive(); readEnabled(agentDir);
    });
  }, assertActive);
}
