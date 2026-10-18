import { processInput } from "./process-input.ts";
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { processActivation, until } from "../../process-tasks/__tests__/process-harness.ts";
import type { ManagementDetails } from "../tools.ts";
import { isLaunchMetadata, type RuntimeLaunchMetadata } from "../launch.ts";
import { processExists } from "../../process-tasks/spawn.ts";

const text = (result: { content: { text?: string }[] }) => result.content.map(block => block.text ?? "").join("\n");
const identity = (result: unknown) => (result as { details: { runtimeLaunch: Extract<RuntimeLaunchMetadata, { task_id: string }> } }).details.runtimeLaunch;
const metadata = (result: unknown) => (result as { details: ManagementDetails }).details.runtimeManagement;

test("registered bash identity survives foreground completion, explicit background and early detach", async () => {
  const dir = mkdtempSync(join(tmpdir(), "runtime-launch-contract-")), f = processActivation(dir);
  try {
    assert.deepEqual([...f.tools.keys()].sort(), ["bash", "monitor", "process_manage"]);
    const foreground = await f.execute("bash", { command: "printf foreground" });
    const fg = identity(foreground); assert.ok(isLaunchMetadata(fg));
    assert.match(text(foreground), new RegExp(`task_id=${fg.task_id}`));
    assert.equal(fg.mode, "foreground"); assert.equal(f.reg.jobs.get(fg.task_id)?.status, "completed");
    assert.match(text(await f.execute("process_manage", processInput({ action: "output", task_id: fg.task_id }))), /foreground/);

    for (const command of ["printf completed", "printf failed; exit 7"]) {
      const beforeMessages = f.messages.length;
      const background = await f.execute("bash", { command, background_after_seconds: 0 });
      const bg = identity(background); assert.ok(isLaunchMetadata(bg)); assert.equal(bg.mode, "background");
      await until(() => ["completed", "failed"].includes(f.reg.jobs.get(bg.task_id)!.status));
      assert.equal(f.messages.length, beforeMessages + 1, "background success and failure each notify automatically");
      const result = await f.execute("process_manage", processInput({ action: "output", task_id: bg.task_id }));
      assert.equal(metadata(result).version, 2); assert.equal(metadata(result).task_id, bg.task_id);
    }
    const controller = new AbortController();
    const pending = f.execute("bash", { command: "printf detach; tail -f /dev/null" }, controller.signal);
    const job = [...f.reg.jobs.values()].find(job => job.command.includes("tail -f"))!;
    const pid = job.pid, path = job.logPath;
    f.coordinator.detachAll(); const detached = identity(await pending); controller.abort();
    assert.equal(detached.task_id, job.id);
    assert.equal(job.pid, pid); assert.equal(job.logPath, path); assert.ok(processExists(pid));
    const stopped = await f.execute("process_manage", processInput({ action: "stop", task_id: job.id }));
    assert.equal(metadata(stopped).status, "stopped");
    await until(() => !processExists(pid));
  } finally { await f.lifecycle.shutdown(); rmSync(dir, { recursive: true, force: true }); }
});

test("registered process manager retains search counts/context, byte pages and cumulative stats while rejecting cross-type fields", async () => {
  const dir = mkdtempSync(join(tmpdir(), "runtime-process-actions-")), f = processActivation(dir);
  try {
    const launched = await f.execute("bash", { command: "printf log", background_after_seconds: 0 });
    const id = identity(launched).task_id;
    await until(() => f.reg.jobs.get(id)?.status === "completed");
    const job = f.reg.jobs.get(id)!;
    const body = Array.from({ length: 30 }, (_, n) => `needle 中文 ${n}`).join("\n") + "\n";
    writeFileSync(job.logPath, body);
    // Simulate an unconsumed terminal outcome to keep search's non-consuming
    // contract observable even though normal background completion now notifies.
    delete job.outcomeSurfaced;
    const search = await f.execute("process_manage", processInput({ action: "search", task_id: id, pattern: "NEEDLE", ignore_case: true, context: 1 }));
    assert.equal(metadata(search).count, 30); assert.match(text(search), /and 10 more/); assert.match(text(search), /:1: needle 中文 0/);
    assert.match(text(search), /:2- needle 中文 1/); assert.notEqual(job.outcomeSurfaced, true, "search does not consume a terminal outcome");
    const defaultSearch = await f.execute("process_manage", processInput({ action: "search", task_id: id, pattern: "NEEDLE" }));
    const explicitSearch = await f.execute("process_manage", processInput({ action: "search", task_id: id, pattern: "NEEDLE", ignore_case: false, context: 0 }));
    assert.equal(metadata(defaultSearch).count, 0); assert.equal(metadata(explicitSearch).count, 0);
    const matching = await f.execute("process_manage", processInput({ action: "search", task_id: id, task_type: "bash", pattern: "needle" }));
    assert.equal(metadata(matching).count, 30);
    const mismatched = await f.execute("process_manage", processInput({ action: "search", task_id: id, task_type: "monitor", pattern: "needle" }));
    assert.equal(metadata(mismatched).error_code, "invalid_arguments");
    const defaultTail = await f.execute("process_manage", processInput({ action: "output", task_id: id }));
    const defaultRange = metadata(defaultTail).range!;
    assert.equal(defaultRange.end, Buffer.byteLength(body));
    assert.equal(defaultRange.start, Math.max(0, defaultRange.size - f.reg.config.outputPreviewChars));
    let offset = 0, size = Buffer.byteLength(body);
    while (offset < size) {
      const page = await f.execute("process_manage", processInput({ action: "output", task_id: id, offset, limit: 7 }));
      const range = metadata(page).range!;
      assert.equal(range.start, offset); assert.equal(range.end, Math.min(offset + 7, size));
      assert.equal(range.size, size); assert.equal(metadata(page).version, 2); offset = range.end;
    }
    const stats = text(await f.execute("process_manage", processInput({ action: "stats", task_type: "bash" })));
    assert.match(stats, /current retained snapshot/); assert.match(stats, /process activation cumulative \(bash\+monitor\)/); assert.match(stats, /"totalStarted":1/);
    for (const params of [{ action: "output", task_id: id, verbose: false }, { action: "status", task_id: id, limit: 1 }, { action: "wait", task_id: id, offset: 0 }]) {
      assert.equal((await f.execute("process_manage", processInput(params)) as { isError?: boolean }).isError, true);
    }
    assert.equal(metadata(await f.execute("process_manage", processInput({ action: "search", task_type: "workflow", pattern: "x" }))).error_code, "invalid_arguments");
    await assert.rejects(f.execute("process_manage", processInput({ action: "search", task_id: id, pattern: "[" })), /Invalid regex/);
  } finally { await f.lifecycle.shutdown(); rmSync(dir, { recursive: true, force: true }); }
});
