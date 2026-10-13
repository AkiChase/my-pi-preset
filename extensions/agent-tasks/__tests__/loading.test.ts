import { AsyncLocalStorage } from "node:async_hooks";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { it } from "node:test";
import { fileURLToPath } from "node:url";
import { inChildSessionContext, runInChildSessionContext } from "../src/child-context.ts";

void it("child marker preserves unrelated root context, nested awaits and rejection boundaries", async () => {
  const unrelatedRootContext = new AsyncLocalStorage<string>();
  const deferred = () => {
    let resolve = () => {};
    const promise = new Promise<void>((r) => { resolve = r; });
    return { promise, resolve };
  };
  const entered = deferred();
  const release = deferred();
  await unrelatedRootContext.run("unrelated-root", async () => {
    assert.equal(inChildSessionContext(), false);
    const child = runInChildSessionContext(async () => {
      assert.equal(inChildSessionContext(), true);
      assert.equal(unrelatedRootContext.getStore(), "unrelated-root");
      entered.resolve();
      await release.promise;
      await runInChildSessionContext(async () => {
        await new Promise<void>((resolve) => setImmediate(resolve));
        assert.equal(inChildSessionContext(), true);
        assert.equal(unrelatedRootContext.getStore(), "unrelated-root");
      });
      assert.equal(inChildSessionContext(), true, "nested exit keeps the outer child scope");
    });
    try {
      await entered.promise;
      assert.equal(inChildSessionContext(), false, "overlapping root continuation stays outside the child scope");
      assert.equal(unrelatedRootContext.getStore(), "unrelated-root");
    } finally {
      release.resolve();
      await child;
    }
    assert.equal(inChildSessionContext(), false);
    await assert.rejects(runInChildSessionContext(async () => {
      await Promise.resolve();
      assert.equal(inChildSessionContext(), true);
      throw new Error("scoped failure");
    }), /scoped failure/);
    assert.equal(inChildSessionContext(), false, "rejection restores the root scope");
    assert.equal(unrelatedRootContext.getStore(), "unrelated-root");
  });
  assert.equal(unrelatedRootContext.getStore(), undefined);
  assert.equal(inChildSessionContext(), false);
});

void it("cached host loader guards same/different cwd children and isolates overlapping root loads", { timeout: 60_000 }, () => {
  const box = mkdtempSync(join(tmpdir(), "agent-tasks-loading-"));
  const agentDir = join(box, "agent");
  const cwd = join(box, "cwd");
  mkdirSync(agentDir);
  mkdirSync(cwd);
  try {
    const result = spawnSync(process.execPath, [fileURLToPath(new URL("./host-loading-smoke.mjs", import.meta.url))], {
      cwd,
      env: { ...process.env, PI_CODING_AGENT_DIR: agentDir },
      encoding: "utf8",
      timeout: 50_000,
    });
    assert.equal(result.error, undefined);
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
    const report: unknown = JSON.parse(result.stdout.trim());
    assert.ok(typeof report === "object" && report !== null);
    assert.ok("childShutdownPreservedRoot" in report && report.childShutdownPreservedRoot === true);
    assert.ok("rootShutdownReleasedManager" in report && report.rootShutdownReleasedManager === true);
    assert.ok("sameCwdChildHasAgent" in report && report.sameCwdChildHasAgent === false);
    assert.ok("differentCwdChildHasAgent" in report && report.differentCwdChildHasAgent === false);
    assert.ok("differentCwdChildHasWorkflow" in report && report.differentCwdChildHasWorkflow === false);
    assert.ok("childHasRootManagerHandlers" in report && report.childHasRootManagerHandlers === false);
    assert.ok("repeatedParentLoads" in report && report.repeatedParentLoads === 2);
    assert.ok("overlappingRootStayedRoot" in report && report.overlappingRootStayedRoot === true);
    assert.ok("nestedAsyncChildStayedChild" in report && report.nestedAsyncChildStayedChild === true);
    assert.ok("rootReloadAfterShutdown" in report && report.rootReloadAfterShutdown === true);
    assert.deepEqual(readdirSync(agentDir), [], "loading must not create settings or session state");
  } finally {
    rmSync(box, { recursive: true, force: true });
  }
});
