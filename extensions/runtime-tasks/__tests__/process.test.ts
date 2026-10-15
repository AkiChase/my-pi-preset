import { test } from "node:test";
import { syncBuiltinESMExports } from "node:module";
import fs from "node:fs";
import { runtimeTaskTool } from "../facade.ts";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { BackgroundRegistry } from "../../process-tasks/state.ts";
import { DEFAULTS } from "../../process-tasks/config.ts";
import { add, createRunningJob, stopSidebarTicker } from "../../process-tasks/registry.ts";
import { startBackgroundJob, terminateJobSilently } from "../../process-tasks/lifecycle.ts";
import { createProcessTaskSource } from "../../process-tasks/source.ts";
import { createProcessManagement } from "../../process-tasks/management.ts";
import { createRuntimeTaskFacade } from "../facade.ts";

const tick = () => new Promise<void>(resolve => setImmediate(resolve));
function fixture() {
  const dir = mkdtempSync(join(tmpdir(), "runtime-management-"));
  const reg = new BackgroundRegistry({ ...DEFAULTS, logDir: dir });
  const pi = { sendMessage() { throw new Error("offline sink held"); } } as unknown as ExtensionAPI;
  const ctx = { cwd: dir, ui: { notify() {}, setWidget() {}, setStatus() {} } } as unknown as ExtensionContext;
  const source = createProcessTaskSource(reg);
  const facade = createRuntimeTaskFacade([createProcessManagement(reg, source)]);
  const makeJob = () => {
    const id = `b-${reg.jobs.size}`;
    const path = join(dir, `${id}.log`);
    writeFileSync(path, "first line\nmatch line\nlast line\n");
    const job = add(reg, createRunningJob({ id, command: "fake runner", pid: 0, logPath: path, toolCallId: id }));
    let finish!: () => void;
    const exit = new Promise<{ code: number; signal: null }>(resolve => { finish = () => resolve({ code: 0, signal: null }); });
    startBackgroundJob({ reg, pi, ctx, job, exit });
    return { job, finish };
  };
  return { reg, facade, source, ctx, makeJob, async close() { facade.close(); for (const job of reg.jobs.values()) terminateJobSilently(reg, job); reg.coordinator.dispose(); source.dispose(); stopSidebarTicker(reg); await tick(); rmSync(dir, { recursive: true, force: true }); } };
}

test("process facade list/status/search are non-consuming; output reports byte range", async () => {
  const f = fixture();
  try {
    const { job, finish } = f.makeJob(); finish(); await tick();
    const run = (action: "list" | "status" | "output" | "search", options = {}) => f.facade.execute({ action, ...(action !== "list" ? { task_id: job.id } : {}), ...options }, undefined, undefined, f.ctx);
    await run("list"); await run("status");
    const search = await run("search", { pattern: "match", context: 1 });
    assert.match(search.content[0].type === "text" ? search.content[0].text : "", /:2: match line/);
    assert.notEqual(job.outcomeSurfaced, true);
    const output = await run("output", { offset: 11, limit: 10 });
    assert.deepEqual(output.details.runtimeTask.range, { start: 11, end: 21, size: 32, omitted_before: 11, omitted_after: 11 });
    assert.equal(job.outcomeSurfaced, true);
  } finally { await f.close(); }
});

test("process multiple retrievals release only their waits; completion returns terminal tail", async () => {
  const f = fixture();
  try {
    const { job, finish } = f.makeJob();
    const cancelled = new AbortController();
    const first = f.facade.execute({ action: "wait", task_id: job.id }, cancelled.signal, undefined, f.ctx);
    const second = f.facade.execute({ action: "wait", task_id: job.id, limit: 9 }, undefined, undefined, f.ctx);
    assert.equal(job.attachCount, 2);
    cancelled.abort();
    assert.equal((await first).details.runtimeTask.wait_outcome, "cancelled");
    assert.equal(job.status, "running"); assert.notEqual(job.outcomeSurfaced, true); assert.equal(job.attachCount, 1);
    finish();
    const result = await second;
    assert.equal(result.details.runtimeTask.wait_outcome, "completed");
    assert.equal(result.details.runtimeTask.status, "completed"); assert.equal(job.attachCount, 0); assert.equal(job.outcomeSurfaced, true);
  } finally { await f.close(); }
});

test("missing process log reports actual terminal status instead of successful empty output", async () => {
  const f = fixture();
  try {
    const { job, finish } = f.makeJob(); finish(); await tick(); unlinkSync(job.logPath);
    const output = await f.facade.execute({ action: "output", task_id: job.id }, undefined, undefined, f.ctx);
    assert.equal(output.details.runtimeTask.error_code, "log_error");
    assert.equal(output.details.runtimeTask.status, "completed"); assert.notEqual(job.outcomeSurfaced, true);
  } finally { await f.close(); }
});

test("wait with an invalid log does not consume terminal outcome", async () => {
  const f = fixture();
  try {
    const { job, finish } = f.makeJob();
    const waiting = f.facade.execute({ action: "wait", task_id: job.id }, undefined, undefined, f.ctx);
    unlinkSync(job.logPath); finish();
    const result = await waiting;
    assert.equal(result.details.runtimeTask.error_code, "log_error");
    assert.equal(result.details.runtimeTask.wait_outcome, "completed");
    assert.notEqual(job.outcomeSurfaced, true);
  } finally { await f.close(); }
});

for (const target of [false, true]) for (const change of ["close", "replace"] as const) test(`registered asynchronous search fences ${change} (${target ? "target" : "global"}) and closes streams`, async t => {
  const f = fixture();
  const streams: fs.ReadStream[] = [];
  const create = fs.createReadStream;
  t.mock.method(fs, "createReadStream", ((...args: Parameters<typeof create>) => {
    const stream = create(...args); streams.push(stream); return stream;
  }) as typeof create);
  syncBuiltinESMExports();
  t.after(() => { t.mock.restoreAll(); syncBuiltinESMExports(); });
  const tool = runtimeTaskTool(f.facade);
  try {
    const { job } = f.makeJob();
    const pending = tool.execute("search", { action: "search", pattern: "match", ...(target ? { task_id: job.id } : {}) }, undefined, undefined, f.ctx);
    if (change === "close") { f.facade.close(); f.reg.closed = true; }
    else f.reg.jobs.set(job.id, { ...job });
    const result = await pending;
    assert.equal(result.isError, true);
    assert.equal(result.details.runtimeTask.error_code, "closed");
    assert.doesNotMatch(result.content.map(block => block.type === "text" ? block.text : "").join(""), /match line/);
    assert.ok(streams.length > 0); assert.ok(streams.every(stream => stream.closed), "actual log fd closed before publishing");
    assert.equal(fs.readFileSync(job.logPath, "utf8"), "first line\nmatch line\nlast line\n", "log is preserved");
  } finally { await f.close(); }
});

test("registered search invalid regex remains an error, not a rewritten success", async () => {
  const f = fixture();
  try { const { job } = f.makeJob(); await assert.rejects(f.facade.execute({ action: "search", task_id: job.id, pattern: "[" }, undefined, undefined, f.ctx), /Invalid regex/); }
  finally { await f.close(); }
});

test("an empty directory is not a successfully read empty logfile", async () => {
  const f = fixture();
  try {
    const { job } = f.makeJob(); job.logPath = f.ctx.cwd;
    const result = await f.facade.execute({ action: "output", task_id: job.id }, undefined, undefined, f.ctx);
    assert.equal(result.details.runtimeTask.error_code, "log_error");
  } finally { await f.close(); }
});
