import * as fs from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { TestContext } from "node:test";
import { MemoryStore } from "../store.ts";
import type { ReplaceHook } from "../paths.ts";
export function fixture(t: TestContext, hook?: ReplaceHook) {
  const root = fs.realpathSync(fs.mkdtempSync(join(tmpdir(), "pi-memory-test-")));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const agentDir = join(root, "agent"); fs.mkdirSync(agentDir, { mode: 0o700 });
  const project = { id: `fixture-${"a".repeat(64)}`, name: "fixture", root: join(root, "cwd"), kind: "directory" as const };
  fs.mkdirSync(project.root);
  const store = new MemoryStore(agentDir, project, hook); store.initialize();
  return { root, agentDir, project, store };
}
export const input = (name = "preference", body = "Prefer concise explanations.") => ({ name, body, type: "user" as const, description: "Communication preference", expectedRevision: null });
