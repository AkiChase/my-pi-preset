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
import beautify from ${JSON.stringify(join(root, "extensions/beautify.ts"))};
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
  pi.registerCommand("probe-child", { description: "Test-only child context bridge",
    handler: async (_args, ctx) => runInChildSessionContext(ctx.loadChild) });
}
`);
const registryKey = Symbol.for("pi-subagents:manager");
const rootToolNames = ["Agent", "SubagentWorkflow", "bash", "bash_bg", "get_subagent_result", "jobs", "monitor", "steer_subagent"].sort();
const childToolNames = ["bash", "bash_bg", "jobs", "monitor"].sort();
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
  for (const name of ["Agent", "SubagentWorkflow", "get_subagent_result", "steer_subagent"]) {
    assert.equal(ext.tools.has(name), false, `${label}: no ${name}`);
  }
  assert.equal(ext.commands.has("agents"), false, `${label}: no root manager command`);
  for (const event of [...rootOnlyEvents, ...removedOverviewEvents]) assert.equal(ext.handlers.has(event), false, `${label}: no root manager ${event}`);
  // Composition plus appearance/highlighter teardown; no separate agent shutdown.
  assert.equal(rootExt.handlers.get("session_shutdown")?.length, 3);
  assert.equal(ext.handlers.get("session_shutdown")?.length, 3);
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
