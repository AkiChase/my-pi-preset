// Invoked in disposable cwd/agent dirs by loading.test.ts. Use the real cached
// host loader: Pi 1.1.0 replaces its jiti graph when the resource cwd changes.
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const { loadExtensionsCached: loadExtensions } = await import(new URL("./core/extensions/loader.js", import.meta.resolve("@earendil-works/pi-coding-agent")));
const root = fileURLToPath(new URL("../../../", import.meta.url));
const parentCwd = process.cwd();
const childCwd = join(parentCwd, "worktree-cwd");
const parallelRootCwd = join(parentCwd, "parallel-root-cwd");
mkdirSync(childCwd);
mkdirSync(parallelRootCwd);
const entry = join(parentCwd, "composition-probe.ts");
writeFileSync(entry, `
import composition, { runInChildSessionContext } from ${JSON.stringify(join(root, "extensions/task-composition.ts"))};
import { withChildManagement } from ${JSON.stringify(join(root, "extensions/runtime-tasks/child-handoff.ts"))};
import beautify from ${JSON.stringify(join(root, "extensions/beautify.ts"))};
import atPathCompletion from ${JSON.stringify(join(root, "extensions/at-path-completion.ts"))};
export default async function (pi) {
  const seen = new Map();
  const proxy = new Proxy(pi, { get(target, prop) {
    if (["registerTool", "registerCommand", "registerShortcut"].includes(prop)) return (...args) => {
      const name = prop === "registerTool" ? args[0].name : args[0];
      const key = prop + ":" + name;
      if (seen.has(key)) throw new Error("duplicate registration: " + key);
      seen.set(key, true);
      target[prop](...args);
    };
    const value = Reflect.get(target, prop, target);
    return typeof value === "function" ? value.bind(target) : value;
  }});
  await composition(proxy);
  beautify(proxy);
  atPathCompletion(proxy);
  pi.registerCommand("probe-child", { description: "Test-only child context bridge",
    handler: async (_args, ctx) => withChildManagement(ctx.branch, () => runInChildSessionContext(ctx.loadChild)) });
}
`);
const registryKey = Symbol.for("pi-subagents:manager");
const rootToolNames = ["subagent_run", "subagent_workflow", "bash", "agent_manage", "process_manage", "monitor", "subagent_message"].sort();
const childToolNames = ["bash", "agent_manage", "process_manage", "monitor"].sort();
const rootOnlyEvents = ["input", "session_before_switch"];
const removedOverviewEvents = ["tool_execution_start"];
const liveLoads = new Set();
const shutdown = async (extensions) => {
  for (const e of extensions ?? []) {
    for (const handler of e.handlers.get("session_shutdown") ?? []) {
      await handler({}, { hasUI: false, ui: { setStatus() {}, setWidget() {} } });
    }
  }
};
const load = async (cwd) => {
  const result = await loadExtensions([entry], cwd);
  liveLoads.add(result);
  assert.deepEqual(result.errors, []);
  assert.equal(result.extensions.length, 1);
  return result;
};
const close = async (result) => {
  await shutdown(result.extensions);
  liveLoads.delete(result);
};
const assertRoot = (result) => {
  const ext = result.extensions[0];
  assert.deepEqual([...ext.tools.keys()].sort(), rootToolNames);
  assert.ok(ext.tools.get("bash").definition.parameters.properties.run_in_background);
  assert.equal(ext.toolRenderers.length, 1);
  assert.equal(ext.toolRenderers[0]("bash", () => undefined).renderShell, "default");
  assert.ok(ext.commands.has("agents"));
  for (const event of rootOnlyEvents) assert.equal(ext.handlers.get(event)?.length, 1, `root owns ${event}`);
  for (const event of removedOverviewEvents) assert.equal(ext.handlers.has(event), false, `no legacy overview ${event}`);
  return ext;
};
const assertChild = (result, rootExt, label) => {
  const ext = result.extensions[0];
  assert.deepEqual([...ext.tools.keys()].sort(), childToolNames, `${label}: no child agent tools`);
  for (const name of ["subagent_run", "subagent_workflow", "subagent_message"]) {
    assert.equal(ext.tools.has(name), false, `${label}: no ${name}`);
  }
  assert.equal(ext.commands.has("agents"), false, `${label}: no root manager command`);
  for (const event of [...rootOnlyEvents, ...removedOverviewEvents]) assert.equal(ext.handlers.has(event), false, `${label}: no root manager ${event}`);
  // Composition, foreground widget client, appearance/highlighter and path continuation teardown.
  assert.equal(rootExt.handlers.get("session_shutdown")?.length, 5);
  assert.equal(ext.handlers.get("session_shutdown")?.length, 5);
  for (const event of ["session_start"]) {
    assert.equal(ext.handlers.get(event)?.length, rootExt.handlers.get(event)?.length - 1, `${label}: no agent ${event}`);
  }
};
const inChild = (ext, fn) => ext.commands.get("probe-child").handler("", { loadChild: fn });
const deferred = () => {
  let resolve;
  const promise = new Promise((r) => { resolve = r; });
  return { promise, resolve };
};
let releaseChild;
let overlappingChild;
try {
  const roots = await load(parentCwd);
  const rootExt = assertRoot(roots);
  assert.ok(globalThis[registryKey]);
  const ownedRegistry = globalThis[registryKey];

  const sameCwdChildren = await inChild(rootExt, () => load(parentCwd));
  assertChild(sameCwdChildren, rootExt, "same cwd");
  assert.equal(globalThis[registryKey], ownedRegistry);
  // No session_start: loading alone must still own and release its resources.
  await close(sameCwdChildren);
  assert.equal(globalThis[registryKey], ownedRegistry, "same-cwd child shutdown preserves the root manager");

  const differentCwdChildren = await inChild(rootExt, () => load(childCwd));
  assertChild(differentCwdChildren, rootExt, "different cwd (worktree)");
  assert.equal(globalThis[registryKey], ownedRegistry);
  await close(differentCwdChildren);
  assert.equal(globalThis[registryKey], ownedRegistry, "different-cwd child shutdown preserves the root manager");

  // The actual cached host loader crosses cwd/jiti graphs with one composite manager.
  for (const cwd of [parentCwd, childCwd]) {
    const branch = () => ({ list: () => [{ view: { sourceId: "agent", taskId: "owned", runId: "1", key: "owned", kind: "agent", title: "owned", status: "running", executionMode: "owned", waitCount: 0, stats: {}, artifacts: [], capabilities: { stop: true, details: true } }, manageable: true, rawStatus: "running" }], execute: async () => ({ content: [{ type: "text", text: "owned answer" }], details: { runtimeTask: { version: 1, action: "output", task_type: "subagent", task_id: "owned", run_id: "1" } } }) });
    const child = await rootExt.commands.get("probe-child").handler("", { branch, loadChild: () => load(cwd) });
    assertChild(child, rootExt, "composite child");
    const ext = child.extensions[0], manage = ext.tools.get("agent_manage").definition;
    const ctx = { cwd, hasUI: false, ui: { setStatus() {}, setWidget() {}, notify() {}, theme: { fg: (_c, t) => t } } };
    const call = (args) => manage.execute("probe", { execution_id: null, kind: null, verbose: null, ...args }, undefined, undefined, ctx);
    assert.match((await call({ action: "list" })).content[0].text, /agent_id=owned/);
    assert.equal((await call({ action: "output", execution_id: "exec_" + Buffer.from(JSON.stringify(["root-or-sibling", "1"])).toString("base64url") })).details.runtimeManagement.error_code, "stale");
    const launch = await ext.tools.get("bash").definition.execute("local", { command: "printf CHILD", run_in_background: true }, undefined, undefined, ctx);
    const identity = launch.details.runtimeLaunch;
    assert.match(launch.content[0].text, new RegExp(`task_id=${identity.task_id}`));
    // Spawn deliberately unrefs its child; this standalone driver owns a bounded keepalive.
    const keepalive = setTimeout(() => {}, 5000);
    try { assert.match((await ext.tools.get("process_manage").definition.execute("local", { action: "wait", task_id: identity.task_id }, undefined, undefined, ctx)).content[0].text, /CHILD/); }
    finally { clearTimeout(keepalive); }
    assert.match((await call({ action: "output", execution_id: "exec_" + Buffer.from(JSON.stringify(["owned", "1"])).toString("base64url") })).content[0].text, /owned answer/);
    await close(child);
    assert.equal((await call({ action: "list" })).details.runtimeManagement.error_code, "closed");
    assert.equal(globalThis[registryKey], ownedRegistry, "child facade close never disposes root");
  }

  // Changing back invalidates the graph again. Repeated parent initialization
  // must still be root, with one tool/command/shortcut registration per factory.
  for (let i = 0; i < 2; i++) {
    const repeatedParent = await load(parentCwd);
    assertRoot(repeatedParent);
    assert.equal(globalThis[registryKey], ownedRegistry);
    await close(repeatedParent);
    assert.equal(globalThis[registryKey], ownedRegistry, "non-owner parent shutdown preserves the original root");
  }

  const childEntered = deferred();
  releaseChild = deferred();
  overlappingChild = inChild(rootExt, async () => {
    childEntered.resolve();
    await releaseChild.promise;
    await new Promise((resolve) => setImmediate(resolve));
    // Keep the original root graph's guard alive across an unrelated root load,
    // then nest an async guard and load a new child graph from the other cwd.
    return inChild(rootExt, () => load(childCwd));
  });
  await childEntered.promise;
  const separateRoot = await load(parallelRootCwd);
  assertRoot(separateRoot);
  assert.equal(globalThis[registryKey], ownedRegistry, "overlapping root does not inherit the child marker");
  releaseChild.resolve();
  const overlappingChildren = await overlappingChild;
  assertChild(overlappingChildren, rootExt, "overlapping async child");
  await close(overlappingChildren);
  await close(separateRoot);
  assert.equal(globalThis[registryKey], ownedRegistry, "overlapping load shutdown preserves original ownership");

  await close(roots);
  assert.equal(globalThis[registryKey], undefined, "root shutdown releases its registry slot");
  const newRoot = await load(parentCwd);
  assertRoot(newRoot);
  assert.ok(globalThis[registryKey], "root can claim ownership after the original root shuts down");
  await close(newRoot);
  assert.equal(globalThis[registryKey], undefined);
  console.log(JSON.stringify({
    rootTools: rootToolNames,
    childTools: childToolNames,
    sameCwdChildHasAgent: false,
    differentCwdChildHasAgent: false,
    differentCwdChildHasWorkflow: false,
    childHasRootManagerHandlers: false,
    childShutdownPreservedRoot: true,
    repeatedParentLoads: 2,
    overlappingRootStayedRoot: true,
    nestedAsyncChildStayedChild: true,
    rootShutdownReleasedManager: true,
    rootReloadAfterShutdown: true,
  }));
} finally {
  releaseChild?.resolve();
  await overlappingChild?.catch(() => {});
  for (const result of liveLoads) await close(result);
}
