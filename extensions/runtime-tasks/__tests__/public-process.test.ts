import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { processActivation, until } from "../../process-tasks/__tests__/process-harness.ts";
import { isRuntimeTaskMetadata, type RuntimeTaskDetails } from "../contracts.ts";
import { isLaunchMetadata, type RuntimeLaunchMetadata } from "../launch.ts";
import { processExists } from "../../process-tasks/spawn.ts";

const text = (result: { content: { text?: string }[] }) => result.content.map(block => block.text ?? "").join("\n");
const identity = (result: unknown) => (result as { details: { runtimeLaunch: RuntimeLaunchMetadata } }).details.runtimeLaunch;
const metadata = (result: unknown) => (result as { details: RuntimeTaskDetails }).details.runtimeTask;

test("registered bash identity survives foreground completion, explicit background and early detach; notify is explicit-background-only", async () => {
  const dir = mkdtempSync(join(tmpdir(), "runtime-launch-contract-")), f = processActivation(dir);
  try {
    assert.deepEqual([...f.tools.keys()].sort(), ["bash", "monitor", "task_manage"]);
    const foreground = await f.execute("bash", { command: "printf foreground" });
    const fg = identity(foreground); assert.ok(isLaunchMetadata(fg));
    assert.match(text(foreground), new RegExp(`task_id=${fg.task_id} run_id=${fg.run_id}`));
    assert.equal(fg.mode, "foreground"); assert.equal(f.reg.jobs.get(fg.task_id)?.status, "completed");
    assert.match(text(await f.execute("task_manage", { action: "output", task_id: fg.task_id })), /foreground/);

    for (const params of [{ command: "printf forbidden", notify: false }, { command: "printf forbidden", run_in_background: false, notify: true }]) {
      const before = f.reg.totalStarted;
      await assert.rejects(f.execute("bash", params), /notify requires run_in_background=true/);
      assert.equal(f.reg.totalStarted, before);
    }
    for (const command of ["printf suppressed", "printf failed; exit 7"]) {
      const background = await f.execute("bash", { command, run_in_background: true, notify: false });
      const bg = identity(background); assert.ok(isLaunchMetadata(bg)); assert.equal(bg.mode, "background");
      await until(() => ["completed", "failed"].includes(f.reg.jobs.get(bg.task_id)!.status));
      assert.equal(f.messages.length, 0, "notify:false suppresses both success and failure notifications");
      const result = await f.execute("task_manage", { action: "output", task_id: bg.task_id });
      assert.ok(isRuntimeTaskMetadata(metadata(result))); assert.equal(metadata(result).task_id, bg.task_id);
    }
    const controller = new AbortController();
    const pending = f.execute("bash", { command: "printf detach; tail -f /dev/null" }, controller.signal);
    const job = [...f.reg.jobs.values()].find(job => job.command.includes("tail -f"))!;
    const pid = job.pid, path = job.logPath;
    f.coordinator.detachAll(); const detached = identity(await pending); controller.abort();
    assert.equal(detached.task_id, job.id); assert.equal(detached.run_id, job.id);
    assert.equal(job.pid, pid); assert.equal(job.logPath, path); assert.ok(processExists(pid));
    const stopped = await f.execute("task_manage", { action: "stop", task_id: job.id });
    assert.equal(metadata(stopped).status, "stopped");
    await until(() => !processExists(pid));
  } finally { await f.lifecycle.shutdown(); rmSync(dir, { recursive: true, force: true }); }
});

test("registered process manager retains search counts/context, byte pages and cumulative stats while rejecting cross-type fields", async () => {
  const dir = mkdtempSync(join(tmpdir(), "runtime-process-actions-")), f = processActivation(dir);
  try {
    const launched = await f.execute("bash", { command: "printf log", run_in_background: true, notify: false });
    const id = identity(launched).task_id;
    await until(() => f.reg.jobs.get(id)?.status === "completed");
    const job = f.reg.jobs.get(id)!;
    const body = Array.from({ length: 30 }, (_, n) => `needle 中文 ${n}`).join("\n") + "\n";
    writeFileSync(job.logPath, body);
    const search = await f.execute("task_manage", { action: "search", task_id: id, pattern: "NEEDLE", ignore_case: true, context: 1 });
    assert.equal(metadata(search).count, 30); assert.match(text(search), /and 10 more/); assert.match(text(search), /:1: needle 中文 0/);
    assert.match(text(search), /:2- needle 中文 1/); assert.notEqual(job.outcomeSurfaced, true);
    let offset = 0, size = Buffer.byteLength(body);
    while (offset < size) {
      const page = await f.execute("task_manage", { action: "output", task_id: id, offset, limit: 7 });
      const range = metadata(page).range!;
      assert.equal(range.start, offset); assert.equal(range.end, Math.min(offset + 7, size));
      assert.equal(range.size, size); assert.ok(isRuntimeTaskMetadata(metadata(page))); offset = range.end;
    }
    const stats = text(await f.execute("task_manage", { action: "stats", task_type: "bash" }));
    assert.match(stats, /current retained snapshot/); assert.match(stats, /process activation cumulative \(bash\+monitor\)/); assert.match(stats, /"totalStarted":1/);
    for (const params of [{ action: "output", task_id: id, verbose: false }, { action: "status", task_id: id, limit: 1 }, { action: "wait", task_id: id, offset: 0 }]) {
      assert.equal((await f.execute("task_manage", params) as { isError?: boolean }).isError, true);
    }
    assert.equal(metadata(await f.execute("task_manage", { action: "search", task_type: "workflow", pattern: "x" })).error_code, "unsupported");
    await assert.rejects(f.execute("task_manage", { action: "search", task_id: id, pattern: "[" }), /Invalid regex/);
  } finally { await f.lifecycle.shutdown(); rmSync(dir, { recursive: true, force: true }); }
});
