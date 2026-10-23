import assert from "node:assert/strict";
import { it } from "node:test";
import type { TestContext } from "node:test";
import fsMutable from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import * as fs from "node:fs";
import { join } from "node:path";
import type { ExtensionAPI, ExtensionCommandContext, ExtensionContext, ExtensionUIContext, RegisteredCommand } from "@earendil-works/pi-coding-agent";
import type { TUI } from "@earendil-works/pi-tui";
import memory from "../../memory.ts";
import { registerMemoryCommand } from "../command.ts";
import { MemoryPanel } from "../panel.ts";
import { readEnabled, setEnabled } from "../config.ts";
import type { NativeLayout } from "../../shared/scroll-panel/native-layout.ts";
import { fakeLayout, fakeTui, testTheme } from "./ui-helpers.ts";
import { fixture, input } from "./helpers.ts";

type Custom = ExtensionUIContext["custom"];
type Script = (panel: MemoryPanel) => void | Promise<void>;
const flush = () => new Promise(resolve => setImmediate(resolve));
const keys = { down: "\x1b[B", enter: "\r", escape: "\x1b" };

/** Recursive name/size/mtime listing: browsing must leave the private agent dir byte-identical. */
function tree(root: string): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const name of fs.readdirSync(dir).sort()) {
      const path = join(dir, name); const stat = fs.lstatSync(path);
      out.push(`${path.slice(root.length)}:${stat.size}:${stat.mtimeMs}:${stat.isDirectory()}`);
      if (stat.isDirectory()) walk(path);
    }
  };
  walk(root); return out;
}

/**
 * Fake public UI: custom() mirrors the SDK's observable contract — the factory runs first and
 * onHandle (installation) arrives in a later microtask. done() before installation is recorded
 * as a violation because Pi would hide an unrelated topmost overlay. No dialog methods exist.
 */
function harness(t: TestContext, options: { hook?: Parameters<typeof fixture>[1]; loadLayout?: () => Promise<NativeLayout> } = {}) {
  const f = fixture(t, options.hook);
  let handler!: RegisteredCommand["handler"];
  let active = true;
  let overlay = false;
  let panels = 0;
  const violations: string[] = [];
  const notifications: string[] = [];
  const scripts: Script[] = [];
  let current: MemoryPanel | undefined;
  const pi = { registerCommand(name: string, opts: Omit<RegisteredCommand, "name" | "sourceInfo">) { assert.equal(name, "memory"); handler = opts.handler; } } as ExtensionAPI;
  const owner = registerMemoryCommand(pi, () => ({ ...f, assertActive() { if (!active) throw new Error("retired"); } }), { loadLayout: options.loadLayout ?? (async () => fakeLayout()) });
  const ui = {
    custom: ((factory, opts) => {
      if (overlay) violations.push("nested custom");
      assert.equal(opts?.overlay, true);
      assert.deepEqual(opts?.overlayOptions, { width: "100%", maxHeight: "100%", anchor: "top-left", margin: 0 });
      overlay = true; panels++;
      return new Promise(resolve => {
        let installed = false;
        let ended = false;
        const done = () => {
          if (!installed) violations.push("done before install");
          if (ended) { violations.push("done twice"); return; }
          ended = true; overlay = false; resolve(undefined as never);
        };
        const component = factory(fakeTui(20, 100) as unknown as TUI, testTheme(), {} as Parameters<typeof factory>[2], done);
        assert.ok(component instanceof MemoryPanel); current = component;
        component.focused = true; component.render(100);
        queueMicrotask(async () => {
          installed = true;
          opts?.onHandle?.({} as Parameters<NonNullable<NonNullable<Parameters<Custom>[1]>["onHandle"]>>[0]);
          if (ended) return;
          const script = scripts.shift() ?? (panel => panel.handleInput(keys.escape));
          await script(component);
        });
      });
    }) as Custom,
    notify(text: string) { notifications.push(text); },
  } as unknown as ExtensionUIContext;
  const ctx = { cwd: f.project.root, mode: "tui", hasUI: true, ui } as ExtensionCommandContext;
  return { ...f, ctx, scripts, notifications, violations, owner, run: (args = "") => handler(args, ctx),
    retire() { active = false; owner.close(); }, get panels() { return panels; }, get overlay() { return overlay; }, get current() { return current; } };
}

it("one read-only interaction: list→detail→refresh→back→close with zero disk writes, no dialogs, no index publication", async t => {
  const h = harness(t); await h.store.write(input("first", "First body 中文")); await h.store.write(input("second", "Second body"));
  const before = tree(h.agentDir);
  const index = fs.readFileSync(join(h.store.directory, "MEMORY.md"));
  // Hand edits are only observed: r rereads disk but never republishes MEMORY.md.
  fs.writeFileSync(join(h.store.directory, "first.md"), fs.readFileSync(join(h.store.directory, "first.md"), "utf8").replace("First body", "Edited body"));
  const edited = tree(h.agentDir);
  assert.notDeepEqual(edited, before);
  h.scripts.push(async panel => {
    panel.handleInput(keys.enter);
    assert.equal(panel.getState().page, "list"); // Read happens after input returns.
    await flush();
    assert.equal(panel.getState().page, "detail"); assert.match(panel.render(100).join("\n"), /Edited body 中文/);
    panel.handleInput("r"); await flush();
    assert.match(panel.render(100).join("\n"), /Reloaded from disk \(read-only\)/);
    panel.handleInput(keys.escape); assert.equal(panel.getState().page, "list");
    panel.handleInput(keys.down); panel.handleInput("r"); await flush();
    assert.equal(panel.getState().selectedName, "second");
    for (const key of ["e", "d", "m"]) panel.handleInput(key);
    panel.handleInput(keys.escape);
  });
  await h.run();
  assert.deepEqual(h.violations, []); assert.equal(h.overlay, false); assert.equal(h.panels, 1);
  assert.deepEqual(tree(h.agentDir), edited);
  assert.deepEqual(fs.readFileSync(join(h.store.directory, "MEMORY.md")), index);
  assert.deepEqual(h.notifications, []);
});

it("refresh observes external deletion and corruption without showing stale bodies; disabled memory remains browsable", async t => {
  const h = harness(t); await h.store.write(input("first")); await h.store.write(input("second", "Second body"));
  const file = (name: string) => join(h.store.directory, `${name}.md`);
  h.scripts.push(async panel => {
    panel.handleInput(keys.enter); await flush();
    fs.unlinkSync(file("first")); panel.handleInput("r"); await flush();
    assert.equal(panel.getState().page, "list"); assert.match(panel.render(100).join("\n"), /first no longer exists/);
    assert.equal(panel.getState().selectedName, "second");
    panel.handleInput(keys.enter); await flush();
    assert.match(panel.render(100).join("\n"), /Second body/);
    fs.appendFileSync(file("second"), "\u0000"); panel.handleInput("r"); await flush();
    const text = panel.render(100).join("\n");
    assert.match(text, /unsupported control|control/); assert.doesNotMatch(text, /Second body/);
    panel.handleInput(keys.escape); panel.handleInput(keys.escape);
  });
  await h.run();
  await setEnabled(h.agentDir, false);
  h.scripts.push(async panel => {
    assert.match(panel.render(100).join("\n"), /Disabled[\s\S]*writes rejected/);
    panel.handleInput(keys.escape);
  });
  await h.run();
  assert.equal(readEnabled(h.agentDir), false); assert.deepEqual(h.violations, []);
});

it("snapshot errors are safe and distinct: capacity, corrupt metadata, missing path, permissions, public-root symlink", async t => {
  for (const code of ["capacity", "metadata", "permission", "missing", "path"]) {
    const h = harness(t); await h.store.write(input());
    if (code === "capacity") for (let n = 0; n < 2001; n++) fs.writeFileSync(join(h.store.directory, `unknown-${n}`), "");
    if (code === "metadata") fs.writeFileSync(join(h.store.directory, "preference.md"), "INVALID_RAW_SECRET");
    if (code === "missing") fs.renameSync(h.store.directory, h.store.directory + "-moved");
    if (code === "path") { fs.renameSync(h.agentDir, h.agentDir + "-real"); fs.symlinkSync(h.agentDir + "-real", h.agentDir); }
    const original = fsMutable.opendirSync;
    if (code === "permission") { fsMutable.opendirSync = () => { throw Object.assign(new Error("RAW_PERMISSION_SECRET"), { code: "EACCES" }); }; syncBuiltinESMExports(); }
    try {
      h.scripts.push(panel => {
        const rendered = panel.render(120).join("\n");
        assert.match(rendered, /unavailable|symlink|capacity|2000|frontmatter|permission|missing/);
        if (code === "missing") assert.match(rendered, /directory or file is missing/);
        assert.doesNotMatch(rendered, /RAW_PERMISSION_SECRET|INVALID_RAW_SECRET|No memories yet/); panel.handleInput(keys.escape);
      });
      await h.run(); assert.equal(h.panels, 1); assert.deepEqual(h.violations, []);
    } finally { fsMutable.opendirSync = original; syncBuiltinESMExports(); }
  }
});

it("incompatible native layout refuses to open: no custom, no fallback, bounded error", async t => {
  const h = harness(t, { loadLayout: async () => { throw new Error("RAW_INTERNAL_DETAIL"); } });
  await h.run();
  assert.equal(h.panels, 0);
  assert.equal(h.notifications.length, 1); assert.match(h.notifications[0], /^Memory unavailable:.*no custom scrollbar fallback/);
  const failing = fakeLayout(); failing.fail = new Error("frame invalid");
  const g = harness(t, { loadLayout: async () => failing });
  await g.run(); // First render refuses and closes after installation; the host never sees a throw.
  assert.equal(g.panels, 1); assert.equal(g.overlay, false); assert.match(g.notifications.join("\n"), /Memory unavailable/);
  assert.deepEqual(g.violations, []); assert.equal(g.notifications.length, 1);
});

it("shutdown before installation waits for onHandle; done is idempotent and late reads never update or reopen", async t => {
  // Close between factory return and the installation microtask.
  const h = harness(t); await h.store.write(input());
  const custom = h.ctx.ui.custom;
  h.ctx.ui.custom = ((factory, opts) => { const result = custom(factory, opts); h.retire(); h.retire(); return result; }) as Custom;
  await h.run();
  assert.deepEqual(h.violations, []); assert.equal(h.overlay, false); assert.deepEqual(h.notifications, []);
  // Late detail and refresh reads after close neither update the old panel nor reopen.
  for (const action of ["detail", "refresh", "cwd"] as const) {
    const g = harness(t); await g.store.write(input());
    let panel!: MemoryPanel;
    g.scripts.push(p => {
      panel = p;
      p.handleInput(action === "refresh" ? "r" : keys.enter);
      if (action === "cwd") g.ctx.cwd = join(g.root, "elsewhere"); else g.owner.close();
    });
    const pending = g.run();
    if (action === "cwd") { await flush(); g.owner.close(); }
    await pending; await flush();
    assert.equal(panel.getState().page, "list"); assert.equal(panel.getState().busy, true);
    assert.equal(g.panels, 1); assert.equal(g.overlay, false); assert.deepEqual(g.violations, []); assert.deepEqual(g.notifications, []);
  }
});

it("queued detail and refresh reads are fenced immediately by user close or host disposal", async t => {
  for (const action of ["detail", "refresh"] as const) {
    for (const close of ["user", "host"] as const) {
      const h = harness(t); await h.store.write(input());
      const read = t.mock.method(h.store, "read");
      const scan = t.mock.method(h.store, "scan");
      h.scripts.push(panel => {
        const scans = scan.mock.callCount();
        panel.handleInput(action === "detail" ? keys.enter : "r");
        if (close === "user") panel.handleInput(keys.escape); else panel.dispose();
        // No queued task has run yet; neither may read after the interaction ends.
        assert.equal(scan.mock.callCount(), scans);
      });
      await h.run(); await flush();
      assert.equal(read.mock.callCount(), 0, `${action}/${close}: late detail read`);
      assert.equal(scan.mock.callCount(), 1, `${action}/${close}: late metadata scan`);
      assert.equal(h.overlay, false); assert.deepEqual(h.violations, []); assert.deepEqual(h.notifications, []);
    }
  }
});

it("layout completion after cwd or activation invalidation cannot install or notify", async t => {
  for (const stale of ["cwd", "activation"] as const) {
    let release!: (layout: NativeLayout) => void;
    const h = harness(t, { loadLayout: () => new Promise(resolve => { release = resolve; }) });
    const pending = h.run();
    if (stale === "cwd") h.ctx.cwd = join(h.root, "elsewhere"); else h.retire();
    release(fakeLayout()); await pending;
    assert.equal(h.panels, 0); assert.deepEqual(h.notifications, []);
  }
});

it("host failures notify once, release admission, and suppress stale failures", async t => {
  for (const stale of ["none", "cwd", "activation"] as const) {
    const h = harness(t);
    const original = h.ctx.ui.custom;
    h.ctx.ui.custom = (() => {
      if (stale === "cwd") h.ctx.cwd = join(h.root, "elsewhere");
      if (stale === "activation") h.retire();
      throw new Error("RAW_HOST_SECRET");
    }) as Custom;
    await h.run();
    assert.equal(h.notifications.length, stale === "none" ? 1 : 0);
    assert.doesNotMatch(h.notifications.join("\n"), /RAW_HOST_SECRET/);
    if (stale === "none") {
      h.ctx.ui.custom = original;
      await h.run(); // A failed open must not leave command admission occupied.
      assert.equal(h.panels, 1); assert.deepEqual(h.violations, []);
    }
  }
});

it("busy command rejects concurrent admission; an old completion cannot clear a newer interaction", async t => {
  const h = harness(t); await h.store.write(input());
  h.scripts.push(() => {});
  const old = h.run();
  while (!h.overlay || !h.current) await flush();
  await h.run(); assert.match(h.notifications[0], /already open/); assert.equal(h.panels, 1);
  h.owner.close(); // Old done resolves later; admit a fresh interaction immediately.
  h.scripts.push(() => {});
  const fresh = h.run();
  await old; await flush();
  assert.equal(h.overlay, true); assert.equal(h.panels, 2);
  h.owner.close(); await fresh;
  assert.equal(h.overlay, false); assert.deepEqual(h.violations, []);
});

it("on/off and nonTUI commands never open custom; published/durability errors reread disk and report it", async t => {
  const h = harness(t); await h.store.write(input());
  for (const mode of ["rpc", "print", "json"] as const) {
    h.ctx.mode = mode;
    for (const args of ["", "list pref", "help", "off", "on", "unknown"]) await h.run(args);
  }
  assert.equal(h.panels, 0);
  assert.ok(h.notifications.some(text => text.includes('"total":1')));
  assert.ok(h.notifications.some(text => /Memory · fixture · Enabled · 1 memories/.test(text)));
  assert.ok(h.notifications.some(text => /read-only project browser/.test(text)));
  const original = fsMutable.fsyncSync;
  fsMutable.fsyncSync = fd => { if (fs.fstatSync(fd).isDirectory()) throw new Error("RAW_SECRET_MUST_NOT_ESCAPE"); original(fd); };
  syncBuiltinESMExports();
  try {
    for (const mode of ["tui", "rpc"] as const) {
      h.ctx.mode = mode;
      await h.run("off"); assert.equal(readEnabled(h.agentDir), false);
      assert.match(h.notifications.at(-1)!, /Disabled on disk.*durability/);
      await h.run("on"); assert.equal(readEnabled(h.agentDir), true);
      assert.match(h.notifications.at(-1)!, /Enabled on disk.*durability/);
    }
    assert.equal(h.notifications.join("\n").includes("RAW_SECRET"), false);
    assert.equal(fs.existsSync(join(h.agentDir, ".memory-lock")), false);
    assert.equal(h.panels, 0);
  } finally { fsMutable.fsyncSync = original; syncBuiltinESMExports(); }
});

it("real entry registers the command and fences its activation; nonTUI paths never load the native layout", async t => {
  const f = fixture(t); const previous = process.env.PI_CODING_AGENT_DIR; process.env.PI_CODING_AGENT_DIR = f.agentDir;
  t.after(() => { if (previous === undefined) delete process.env.PI_CODING_AGENT_DIR; else process.env.PI_CODING_AGENT_DIR = previous; });
  let handler!: RegisteredCommand["handler"];
  const handlers = new Map<string, (event: unknown, ctx: ExtensionContext) => unknown>();
  const pi = { registerTool() {}, registerCommand(_name: string, opts: Omit<RegisteredCommand, "name" | "sourceInfo">) { handler = opts.handler; }, on(name: string, fn: (event: unknown, ctx: ExtensionContext) => unknown) { handlers.set(name, fn); return () => {}; } } as unknown as ExtensionAPI;
  const notices: string[] = [];
  const print = { cwd: f.project.root, mode: "print", ui: { notify(text: string) { notices.push(text); } } } as unknown as ExtensionCommandContext;
  memory(pi); await handlers.get("session_start")!({}, print); await handler("", print); assert.match(notices[0], /Memory.*Enabled/);
  await handlers.get("session_start")!({}, print); await handler("help", print); assert.match(notices.at(-1)!, /read-only/);
  handlers.get("session_shutdown")!({}, print); const count = notices.length;
  await handler("off", print); assert.equal(readEnabled(f.agentDir), true); assert.ok(notices.length <= count + 1);
});

it("reentrant close inside the custom factory (session_start) still waits for installation and closes exactly once", async t => {
  const h = harness(t); await h.store.write(input());
  const custom = h.ctx.ui.custom;
  h.ctx.ui.custom = ((factory, opts) => custom(((...args: Parameters<typeof factory>) => { h.owner.close(); return factory(...args); }) as typeof factory, opts)) as Custom;
  await h.run();
  assert.deepEqual(h.violations, []); assert.equal(h.overlay, false); assert.equal(h.panels, 1); assert.deepEqual(h.notifications, []);
  h.current!.handleInput("r"); h.current!.handleInput(keys.escape); await flush();
  assert.deepEqual(h.violations, []);
});
