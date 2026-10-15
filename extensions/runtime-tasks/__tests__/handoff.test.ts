import { test } from "node:test";
import assert from "node:assert/strict";
import { TaskCoordinator } from "../../task-ui/coordinator.ts";
import { childManagement, withChildManagement } from "../child-handoff.ts";
import type { RuntimeTaskCapability } from "../facade.ts";
import { taskResult } from "../contracts.ts";
const capability = (): RuntimeTaskCapability => ({ list: () => [], execute: async () => taskResult("owned", { action: "output" }) });
test("child finite handoff is scoped across overlapping awaits and clears outside", async () => {
  const coordinator = new TaskCoordinator();
  const first = capability(), second = capability();
  let release!: () => void;
  const deferred = new Promise<void>(resolve => { release = resolve; });
  const a = withChildManagement(() => first, async () => { await deferred; assert.equal(childManagement(coordinator), first); });
  const b = withChildManagement(() => second, async () => { assert.equal(childManagement(coordinator), second); release(); await Promise.resolve(); assert.equal(childManagement(coordinator), second); });
  await Promise.all([a, b]);
  assert.equal(childManagement(coordinator), undefined);
  coordinator.dispose();
});

test("handoff revokes inherited async descendants and masks missing nested admission", async () => {
  const coordinator = new TaskCoordinator();
  let release!: () => void;
  const pending = new Promise<void>(resolve => { release = resolve; });
  let late!: Promise<void>;
  await withChildManagement(capability, async () => {
    late = (async () => { await pending; assert.equal(childManagement(coordinator), undefined); })();
    await withChildManagement(undefined, async () => { assert.equal(childManagement(coordinator), undefined); });
    assert.ok(childManagement(coordinator));
  });
  release(); await late;
  await assert.rejects(withChildManagement(capability, async () => { throw new Error("load failed"); }));
  assert.equal(childManagement(coordinator), undefined);
  coordinator.dispose();
});
