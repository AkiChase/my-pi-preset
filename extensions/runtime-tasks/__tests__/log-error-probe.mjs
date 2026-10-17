// Subprocess-only resource/error probe: an unhandled readline error must fail
// this process, not the parent test runner. Production code is loaded unchanged.
import { processInput } from "./process-input.ts";
import assert from "node:assert/strict";
import fs from "node:fs";
import readline from "node:readline";
import { registerHooks, stripTypeScriptTypes, syncBuiltinESMExports } from "node:module";
import { join } from "node:path";

const root = new URL("../../", import.meta.url);
const logSearchUrl = new URL("process-tasks/log-search.ts", root).href;
if (process.env.RUNTIME_LOG_SEARCH_BASELINE) {
  // Optional developer red probe: replace only this owner, only in memory.
  const source = fs.readFileSync(process.env.RUNTIME_LOG_SEARCH_BASELINE, "utf8");
  registerHooks({ load(url, context, nextLoad) {
    if (url !== logSearchUrl) return nextLoad(url, context);
    return { format: "module", shortCircuit: true,
      source: stripTypeScriptTypes(source, { mode: "transform", sourceUrl: url }) };
  } });
}

const scenario = process.argv[2];
const change = process.argv[3];
const target = process.argv[4] !== "global";
const dir = process.env.PI_CODING_AGENT_DIR;
assert.ok(dir);
const badPath = join(dir, "bad.log");
const goodPath = join(dir, "good.log");
const body = "before\nneedle normal\nafter\n";
fs.writeFileSync(goodPath, body);
if (scenario === "directory") fs.mkdirSync(badPath);
else if (scenario !== "missing") fs.writeFileSync(badPath, "before\nneedle fallback\nafter\n");

const streams = [];
const create = fs.createReadStream;
fs.createReadStream = (...args) => {
  const stream = create(...args);
  streams.push(stream);
  if (args[0] === badPath && ["unreadable", "partial"].includes(scenario)) {
    stream.once("open", () => {
      if (scenario === "partial") stream.emit("data", "needle partial\n");
      stream.destroy(Object.assign(new Error("offline read failure"), { code: "EACCES" }));
    });
  }
  return stream;
};
const open = fs.openSync;
const close = fs.closeSync;
const fallbackFds = new Set();
fs.openSync = (...args) => {
  if (scenario === "unreadable" && args[0] === badPath)
    throw Object.assign(new Error("offline unreadable log"), { code: "EACCES" });
  const fd = open(...args);
  if (args[0] === badPath || args[0] === goodPath) fallbackFds.add(fd);
  return fd;
};
fs.closeSync = fd => { const result = close(fd); fallbackFds.delete(fd); return result; };
const createInterface = readline.createInterface;
if (scenario === "setup" || scenario === "readline") readline.createInterface = options => {
  if (options.input.path !== badPath) return createInterface(options);
  if (scenario === "setup") throw new Error("offline readline setup failure");
  const rl = createInterface(options);
  rl.once("line", () => rl.emit("error", new Error("offline readline failure")));
  return rl;
};
syncBuiltinESMExports();

const { BackgroundRegistry } = await import(new URL("process-tasks/state.ts", root));
const { DEFAULTS } = await import(new URL("process-tasks/config.ts", root));
const { add, createRunningJob } = await import(new URL("process-tasks/registry.ts", root));
const { createProcessTaskSource } = await import(new URL("process-tasks/source.ts", root));
const { createProcessManagement } = await import(new URL("process-tasks/management.ts", root));
const { createRuntimeTaskFacade } = await import(new URL("runtime-tasks/facade.ts", root));
const reg = new BackgroundRegistry({ ...DEFAULTS, logDir: dir });
const make = (id, logPath) => {
  const job = createRunningJob({ id, command: "offline fixture", pid: 0, logPath, toolCallId: id });
  job.status = "completed";
  return add(reg, job);
};
const bad = make("bad", badPath);
const good = make("good", goodPath);
const source = createProcessTaskSource(reg);
const { registerManagementTool } = await import(new URL("runtime-tasks/tools.ts", root));
const capabilities = [createProcessManagement(reg, source)];
const facade = createRuntimeTaskFacade(capabilities);
let tool;
registerManagementTool({ registerTool(definition) { tool = definition; } }, "process", capabilities);
const ctx = { cwd: dir };
const run = params => tool.execute("log-error-probe", processInput(params), undefined, undefined, ctx);
const text = result => result.content.map(block => block.type === "text" ? block.text : "").join("\n");
const closed = () => {
  assert.ok(streams.length > 0);
  assert.ok(streams.every(stream => stream.closed), "all actual stream fds closed before reply");
  assert.equal(fallbackFds.size, 0, "actual synchronous fallback fds also closed before reply");
};
try {
  const pending = run({ action: "search", pattern: "needle", context: 1, ...(target ? { task_id: bad.id } : {}) });
  if (change === "close") { reg.closed = true; facade.close(); }
  else if (change === "replace") reg.jobs.set(bad.id, { ...bad });
  const result = await pending;
  closed();
  if (change) {
    assert.equal(result.isError, true);
    assert.equal(result.details.runtimeManagement.error_code, "closed");
    assert.doesNotMatch(text(result), /needle (normal|fallback|partial)/);
    console.log(JSON.stringify({ scenario, change, target, error_code: "closed", streams: streams.length }));
  } else {
    const unavailable = ["missing", "directory", "unreadable"].includes(scenario);
    if (unavailable) {
      assert.equal(result.isError, true);
      assert.equal(result.details.runtimeManagement.error_code, "log_error");
      assert.match(text(result), /Cannot read log|cannot read/i);
      assert.doesNotMatch(text(result), /No matches for/);
      assert.equal(result.details.runtimeManagement.task_id, bad.id);
      assert.notEqual(bad.outcomeSurfaced, true);
      const global = await run({ action: "search", pattern: "needle" });
      closed();
      assert.equal(global.isError, true);
      assert.equal(global.details.runtimeManagement.error_code, "log_error");
      assert.equal(global.details.runtimeManagement.count, 1);
      assert.match(text(global), /incomplete/i);
      assert.match(text(global), /needle normal/);
      assert.match(text(global), /bad\.log/);
    } else {
      assert.notEqual(result.isError, true);
      assert.equal(result.details.runtimeManagement.count, 1, "discard partial streamed hits before tail fallback");
      assert.match(text(result), /log tail/);
      assert.match(text(result), /needle fallback/);
      assert.doesNotMatch(text(result), /needle partial/);
      assert.match(text(result), /:1- before/);
      assert.match(text(result), /:3- after/);
    }
    const next = await run({ action: "search", task_id: good.id, pattern: "NEEDLE", ignore_case: true, context: 1 });
    closed();
    assert.notEqual(next.isError, true);
    assert.equal(next.details.runtimeManagement.count, 1);
    assert.match(text(next), /:2: needle normal/);
    const output = await run({ action: "output", task_id: good.id, offset: 7, limit: 6 });
    assert.deepEqual(output.details.runtimeManagement.range, { start: 7, end: 13, size: Buffer.byteLength(body), omitted_before: 7, omitted_after: Buffer.byteLength(body) - 13 });
    assert.equal(fs.readFileSync(goodPath, "utf8"), body);
    if (scenario === "directory") assert.ok(fs.statSync(badPath).isDirectory());
    else if (scenario === "missing") assert.equal(fs.existsSync(badPath), false);
    else assert.equal(fs.readFileSync(badPath, "utf8"), "before\nneedle fallback\nafter\n");
    console.log(JSON.stringify({ scenario, error_code: result.details.runtimeManagement.error_code ?? null, streams: streams.length, subsequent: "ok", retained: true }));
  }
} finally {
  facade.close(); source.dispose(); reg.coordinator.dispose();
  fs.createReadStream = create; fs.openSync = open; fs.closeSync = close; readline.createInterface = createInterface;
  syncBuiltinESMExports();
}
