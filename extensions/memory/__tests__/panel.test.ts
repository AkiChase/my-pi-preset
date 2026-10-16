import assert from "node:assert/strict";
import { it } from "node:test";
import * as fs from "node:fs";
import { join } from "node:path";
import { CURSOR_MARKER, visibleWidth } from "@earendil-works/pi-tui";
import type { TUI, TuiMouseEvent } from "@earendil-works/pi-tui";
import { MemoryPanel } from "../panel.ts";
import type { DetailResult, PanelAction, PanelSnapshot } from "../panel.ts";
import { displayText, readDetail } from "../preview.ts";
import { TOPIC_BYTES, header } from "../policy.ts";
import type { Metadata } from "../policy.ts";
import { SCROLLBAR, fakeLayout, fakeTui, testTheme } from "./ui-helpers.ts";
import { fixture, input } from "./helpers.ts";

const keys = { down: "\x1b[B", up: "\x1b[A", left: "\x1b[D", end: "\x1b[F", home: "\x1b[H", pgUp: "\x1b[5~", pgDown: "\x1b[6~", enter: "\r", escape: "\x1b", ctrlC: "\x03", backspace: "\x7f" };
const meta = (name: string, description = "Reference", type: Metadata["type"] = "reference"): Metadata => ({ name, description, type, created: "2026-10-15T00:00:00.000Z", updated: "2026-10-15T00:00:00.000Z" });
const entries = (count: number) => Array.from({ length: count }, (_, i) => meta(`entry-${i.toString().padStart(4, "0")}`, i === 150 ? "中文 e\u0301 needle" : "Reference"));
const detailOf = (name: string, body: string): DetailResult => ({ name, detail: { metadata: meta(name, "Detail description"), body, path: `/private/${name}.md`, revision: "a".repeat(64) } });
const wheel = (x: number, y: number, wheelDelta: number) => ({ type: "wheel", x, y, wheelDelta }) as unknown as TuiMouseEvent;

function make(snapshot: Partial<PanelSnapshot> = {}, rows = 14, columns = 80) {
  const actions: PanelAction[] = [];
  const unavailable: string[] = [];
  const tui = fakeTui(rows, columns);
  const layout = fakeLayout();
  const panel = new MemoryPanel({ snapshot: { project: "test", enabled: true, entries: [], scannedBytes: 0, ...snapshot }, theme: testTheme(), tui: tui as unknown as TUI, layout,
    onAction: action => actions.push(action), unavailable: error => unavailable.push(error.message) });
  panel.focused = true;
  return { panel, actions, unavailable, tui, layout, text: (width = columns) => panel.render(width).join("\n") };
}

it("fills every terminal row/column without overflow for list, filter and detail across widths 1–120, heights 1–30 and themes", () => {
  const body = "# 中文 e\u0301\n\n" + "- 正文 line\n".repeat(80) + "\x1b[31mBAD\x1b[0m\x07\x1b]52;c;unsafe\x07";
  for (const appearance of ["dark", "light"] as const) {
    for (const page of ["list", "filter", "detail"] as const) {
      const tui = fakeTui();
      const panel = new MemoryPanel({ snapshot: { project: "中文\x1b[31m e\u0301", enabled: true, entries: entries(40), scannedBytes: 1 }, theme: testTheme(appearance), tui: tui as unknown as TUI, layout: fakeLayout(), onAction() {} });
      panel.focused = true;
      if (page === "filter") { panel.handleInput("/"); panel.handleInput("中文e\u0301"); }
      if (page === "detail") panel.showDetail(detailOf("entry-0001", body));
      for (const rows of [1, 2, 3, 5, 14, 30]) {
        tui.terminal.rows = rows;
        for (let width = 1; width <= 120; width++) {
          tui.terminal.columns = width;
          const lines = panel.render(width);
          assert.equal(lines.length, rows, `${page} ${rows}x${width}`);
          assert.ok(lines.every(line => visibleWidth(line) === width), `${appearance} ${page} ${rows}x${width}`);
          // Host Input cursor markers are APC sequences; external BEL/OSC data must be stripped.
          assert.ok(lines.every(line => !line.includes("unsafe") && !line.replace(/\x1b_pi:[^\x07]*\x07/g, "").includes("\x07")));
          // The close/back path stays discoverable even on tiny terminals.
          if (width >= 10) assert.match(lines.at(-1)!, /Esc/, `${page} ${rows}x${width}`);
          if (rows >= 4 && width >= 2) assert.ok(lines.some(line => line.includes(SCROLLBAR)), `scrollbar ${page} ${rows}x${width}`);
        }
      }
      panel.dispose();
    }
  }
  assert.equal(displayText("\x1b]52;c;unsafe\x07中文\x1b[31mX\x1b[0m\x00"), "中文X");
});

it("list keys select with ensure-visible; wheel scrolls natively without moving selection and every overlay wheel is consumed", () => {
  const h = make({ entries: entries(200) });
  h.text();
  h.panel.handleInput(keys.end);
  h.text();
  let state = h.panel.getState();
  assert.equal(state.selectedName, "entry-0199"); assert.ok(state.listScrollTop > 0);
  assert.match(h.text(), /entry-0199/);
  h.panel.handleInput(keys.home); h.text();
  assert.equal(h.panel.getState().selectedName, "entry-0000"); assert.equal(h.panel.getState().listScrollTop, 0);
  h.panel.handleInput(keys.down); h.panel.handleInput(keys.down); h.panel.handleInput(keys.up); h.text();
  assert.equal(h.panel.getState().selectedName, "entry-0001");
  // Body wheel: native scroll by the host-normalized delta; selection unchanged.
  assert.deepEqual(h.panel.handleMouse(wheel(5, 6, 3)), { handled: true });
  state = h.panel.getState();
  assert.equal(state.listScrollTop, 3); assert.equal(state.selectedName, "entry-0001");
  // Rendering and refresh results do not pull the viewport back to the selection.
  h.text(); h.panel.update({ project: "test", enabled: true, entries: entries(200), scannedBytes: 1 });
  h.text(); assert.equal(h.panel.getState().listScrollTop, 3);
  // Header/footer/edges are consumed without scrolling and never fall through.
  for (const [x, y] of [[0, 0], [5, 13], [5, 100]]) assert.deepEqual(h.panel.handleMouse(wheel(x, y, 5)), { handled: true });
  assert.equal(h.panel.getState().listScrollTop, 3);
  assert.equal(h.panel.handleMouse({ type: "press", x: 5, y: 6 } as unknown as TuiMouseEvent), undefined);
  // Boundary wheel stays clamped by the native ScrollView.
  h.panel.handleMouse(wheel(5, 6, -100)); assert.equal(h.panel.getState().listScrollTop, 0);
  assert.deepEqual(h.actions, []);
});

it("read-only boundary: no edit/delete/menu/paging keys, no mutation hints, and only close/refresh/detail/back actions", () => {
  const h = make({ entries: entries(30) });
  h.text();
  for (const key of ["e", "d", "m", keys.pgUp, keys.pgDown, "x"]) h.panel.handleInput(key);
  assert.deepEqual(h.actions, []); assert.equal(h.panel.getState().selectedName, "entry-0000"); assert.equal(h.panel.getState().listScrollTop, 0);
  const list = h.text(120);
  assert.doesNotMatch(list, /edit|delete|menu|PgUp|PgDn|PageUp|PageDown/i);
  h.panel.showDetail(detailOf("entry-0000", "line\n".repeat(60)));
  h.text();
  for (const key of ["e", "d", "m", keys.pgUp, keys.pgDown]) h.panel.handleInput(key);
  assert.deepEqual(h.actions, []); assert.equal(h.panel.getState().detailScrollTop, 0);
  const detail = h.text(120);
  assert.doesNotMatch(detail, /edit|delete|menu|PgUp|PgDn|PageUp|PageDown/i); assert.match(detail, /Read-only/);
});

it("Enter requests detail; detail scrolls with ↑↓/Home/End and wheel; Esc/← return preserves query, selection and list scroll", () => {
  const h = make({ entries: entries(200) });
  h.text(); h.panel.handleInput("/"); h.panel.handleInput("entry-01"); h.panel.handleInput(keys.enter);
  h.panel.handleInput(keys.end); h.text();
  const before = h.panel.getState();
  assert.equal(before.selectedName, "entry-0199"); assert.ok(before.listScrollTop > 0);
  h.panel.handleInput(keys.enter);
  assert.deepEqual(h.actions, [{ kind: "detail", name: "entry-0199" }]);
  assert.equal(h.panel.getState().page, "list"); assert.equal(h.panel.getState().busy, true);
  h.panel.handleInput(keys.enter); assert.equal(h.actions.length, 1); // No duplicate request while reading.
  h.panel.showDetail(detailOf("entry-0199", Array.from({ length: 100 }, (_, i) => `line ${i}`).join("\n\n")));
  assert.equal(h.panel.getState().page, "detail");
  const shown = h.text();
  assert.match(shown, /entry-0199 · reference/); assert.match(shown, /Description: Detail description/); assert.match(shown, /Path: \/private\/entry-0199\.md/);
  h.panel.handleInput(keys.down); h.panel.handleInput(keys.down); h.panel.handleInput(keys.up);
  assert.equal(h.panel.getState().detailScrollTop, 1);
  h.panel.handleInput(keys.end); assert.ok(h.panel.getState().detailScrollTop > 100);
  h.panel.handleInput(keys.home); assert.equal(h.panel.getState().detailScrollTop, 0);
  h.panel.handleMouse(wheel(5, 6, 4)); assert.equal(h.panel.getState().detailScrollTop, 4);
  h.panel.handleInput(keys.escape);
  assert.deepEqual(h.actions.at(-1), { kind: "back" });
  h.text();
  const after = h.panel.getState();
  assert.equal(after.page, "list"); assert.equal(after.query, "entry-01"); assert.equal(after.selectedName, "entry-0199"); assert.equal(after.listScrollTop, before.listScrollTop);
  // ← also returns; a fresh detail starts with its own independent native scroll state.
  h.panel.handleInput(keys.enter); h.panel.showDetail(detailOf("entry-0199", "x\n\n".repeat(50)));
  assert.equal(h.panel.getState().detailScrollTop, 0);
  h.panel.handleInput(keys.left); assert.equal(h.panel.getState().page, "list"); assert.equal(h.panel.getState().listScrollTop, before.listScrollTop);
  h.panel.handleInput(keys.escape); assert.deepEqual(h.actions.at(-1), { kind: "close" });
  h.panel.handleInput(keys.escape); h.panel.close();
  assert.equal(h.actions.filter(action => action.kind === "close").length, 1);
});

it("/ filters locally through native Input; typed c/r/Esc belong to the filter; c clears and keeps the selected memory", () => {
  const h = make({ entries: entries(200) });
  h.text(); h.panel.handleInput(keys.down); h.panel.handleInput(keys.down);
  h.panel.handleInput("/");
  assert.equal(h.panel.getState().filterMode, true);
  for (const char of "cr") h.panel.handleInput(char);
  assert.equal(h.panel.getState().query, "cr"); assert.deepEqual(h.actions, []);
  assert.ok(h.text().includes(CURSOR_MARKER));
  assert.match(h.text(), /No matching memories/); assert.match(h.text(), /c to clear/);
  h.panel.handleInput(keys.backspace); h.panel.handleInput(keys.backspace);
  for (const char of "needle") h.panel.handleInput(char);
  h.panel.handleInput(keys.escape); // Ends filter input only; query is kept.
  assert.equal(h.panel.getState().filterMode, false); assert.equal(h.panel.getState().query, "needle"); assert.deepEqual(h.actions, []);
  assert.ok(!h.text().includes(CURSOR_MARKER));
  assert.equal(h.panel.getState().selectedName, "entry-0150"); assert.match(h.text(), /1\/200 matching/);
  h.panel.handleInput("c");
  h.text();
  assert.equal(h.panel.getState().query, ""); assert.equal(h.panel.getState().selectedName, "entry-0150");
  assert.match(h.text(), /entry-0150/); // Viewport converges onto the retained selection.
  // Enter and Ctrl+C also end filter input immediately without closing.
  for (const exit of [keys.enter, keys.ctrlC]) {
    h.panel.handleInput("/"); h.panel.handleInput("z"); h.panel.handleInput(exit);
    assert.equal(h.panel.getState().filterMode, false); assert.ok(!h.text().includes(CURSOR_MARKER));
    h.panel.handleInput("c");
  }
  assert.deepEqual(h.actions, []);
  // Removed selection falls back to the nearest remaining entry.
  h.panel.update({ project: "test", enabled: true, entries: entries(200).filter(entry => entry.name !== "entry-0150"), scannedBytes: 1 });
  assert.equal(h.panel.getState().selectedName, "entry-0151");
});

it("r requests a read-only reload; refreshed detail replaces stale content and a vanished topic returns to the list", () => {
  const h = make({ entries: entries(3) });
  h.text(); h.panel.handleInput("r");
  assert.deepEqual(h.actions, [{ kind: "refresh" }]); assert.match(h.text(), /Loading…/);
  assert.match(h.text(), /1\/3/);
  h.panel.handleInput("r"); assert.equal(h.actions.length, 1);
  h.panel.update({ project: "test", enabled: true, entries: entries(3), scannedBytes: 1 }, undefined, "Reloaded from disk (read-only).");
  assert.match(h.text(), /Reloaded from disk/); assert.equal(h.panel.getState().busy, false);
  h.panel.handleInput(keys.enter); h.panel.showDetail(detailOf("entry-0000", "Old body"));
  h.panel.handleInput("r");
  assert.deepEqual(h.actions.at(-1), { kind: "refresh", detail: "entry-0000" });
  h.panel.update({ project: "test", enabled: true, entries: entries(3), scannedBytes: 1 }, { name: "entry-0000", error: "Memory file contains unsupported control characters." });
  const corrupt = h.text();
  assert.match(corrupt, /unsupported control/); assert.doesNotMatch(corrupt, /Old body/);
  h.panel.handleInput("r");
  h.panel.update({ project: "test", enabled: true, entries: entries(3).slice(1), scannedBytes: 1 }, { name: "entry-0000", missing: true, error: "missing" });
  assert.equal(h.panel.getState().page, "list"); assert.match(h.text(), /entry-0000 no longer exists/);
  assert.equal(h.panel.getState().selectedName, "entry-0001");
  // A missing topic requested from the list leaves the list with a notice.
  h.panel.handleInput(keys.enter); h.panel.showDetail({ name: "entry-0001", missing: true });
  assert.equal(h.panel.getState().page, "list"); assert.match(h.text(), /no longer exists/);
});

it("empty, no-match, loading, capacity/corrupt/permission errors and disabled states are distinct", () => {
  const cases: [Partial<PanelSnapshot>, RegExp, RegExp?][] = [
    [{}, /No memories yet/],
    [{ diagnostic: "Memory directory exceeds 2000 entries; no partial index or mutation is allowed." }, /Memories unavailable[\s\S]*2000 entries|2000 entries[\s\S]*Memories unavailable/, /No memories yet/],
    [{ diagnostic: "Malformed or oversized memory frontmatter." }, /frontmatter/, /No memories yet/],
    [{ diagnostic: "Memory operation failed due to a filesystem or permission error. Inspect the private agent directory." }, /permission/, /No memories yet/],
    [{ enabled: false, entries: entries(1) }, /Disabled[\s\S]*writes rejected/],
    [{ enabled: undefined, diagnostic: "Memory configuration is malformed or exceeds 1KiB." }, /Unknown[\s\S]*configuration/],
  ];
  for (const [snapshot, expected, absent] of cases) {
    const h = make(snapshot, 24, 120);
    const text = h.text();
    assert.match(text, expected); if (absent) assert.doesNotMatch(text, absent);
    h.panel.dispose();
  }
  const loading = make({}, 24, 120); loading.text(); loading.panel.handleInput("r");
  assert.match(loading.text(), /Loading memories/); assert.doesNotMatch(loading.text(), /No memories yet/);
  const nomatch = make({ entries: entries(2) }, 24, 120); nomatch.panel.handleInput("/"); nomatch.panel.handleInput("zzz");
  assert.match(nomatch.text(), /No matching memories/); assert.doesNotMatch(nomatch.text(), /No memories yet/);
  const detail = make({ entries: entries(1) }, 24, 120); detail.panel.handleInput(keys.enter);
  detail.panel.showDetail({ name: "entry-0000", error: "Memory file is not a private regular file." });
  assert.match(detail.text(), /private regular file/); assert.match(detail.text(), /Esc/);
});

it("resize keeps a previously visible selection visible but never pulls back a wheeled-away selection", () => {
  const h = make({ entries: entries(40) }, 30, 120);
  h.text(120);
  for (let i = 0; i < 3; i++) h.panel.handleInput(keys.down);
  h.text(120); assert.equal(h.panel.getState().listScrollTop, 0);
  // Shrink both dimensions: the 1-row viewport must follow the selection.
  h.tui.terminal.rows = 6; h.tui.terminal.columns = 40;
  let lines = h.panel.render(40);
  assert.equal(h.panel.getState().selectedName, "entry-0003");
  assert.ok(lines.some(line => line.includes("entry-0003")), lines.join("\n"));
  assert.ok(!lines.some(line => line.includes("entry-0000")));
  // Width-only change while visible also keeps it visible.
  h.tui.terminal.columns = 60; lines = h.panel.render(60);
  assert.ok(lines.some(line => line.includes("entry-0003")));
  // Resize while in detail; returning to the list converges for the new size.
  h.panel.handleInput(keys.enter); h.panel.showDetail(detailOf("entry-0003", "body"));
  h.tui.terminal.rows = 30; h.tui.terminal.columns = 120; h.text(120);
  h.panel.handleInput(keys.escape); lines = h.panel.render(120);
  assert.ok(lines.some(line => line.includes("entry-0003")));
  // Wheeled out of view: a later resize keeps the user's viewport.
  const w = make({ entries: entries(40) }, 30, 120);
  w.text(120); for (let i = 0; i < 3; i++) w.panel.handleInput(keys.down); w.text(120);
  w.panel.handleMouse(wheel(5, 6, 10)); assert.equal(w.panel.getState().listScrollTop, 10);
  w.tui.terminal.rows = 6; w.tui.terminal.columns = 40;
  lines = w.panel.render(40);
  assert.equal(w.panel.getState().listScrollTop, 10); assert.equal(w.panel.getState().selectedName, "entry-0003");
  assert.ok(!lines.some(line => line.includes("entry-0003")));
});

it("incompatible native layout refuses once: notifies, closes and never throws through render or input", () => {
  const h = make({ entries: entries(5) });
  h.layout.fail = new Error("Missing layout capabilities");
  const lines = h.panel.render(40);
  assert.equal(lines.length, 14); assert.match(lines[0], /Memory unavailable/); assert.ok(lines.every(line => visibleWidth(line) === 40));
  h.panel.render(40); h.panel.handleInput(keys.down); h.panel.handleMouse(wheel(1, 5, 1));
  assert.deepEqual(h.actions, [{ kind: "close" }]); assert.equal(h.unavailable.length, 1);
  assert.match(h.unavailable[0], /no custom scrollbar fallback/);
});

it("local oversized detail is bounded/read-only, rejects unsafe files/metadata/secrets and leaves tool budget unchanged", async t => {
  const f = fixture(t); await f.store.write(input());
  const old = f.store.read("preference"); const path = old.path;
  fs.writeFileSync(path, header(old.metadata) + "中文".repeat(TOPIC_BYTES));
  assert.throws(() => f.store.read("preference"), /budget/);
  const preview = readDetail(f.store, "preference"); assert.equal(preview.revision, undefined); assert.match(preview.warning!, /Truncated.*read-only/);
  assert.ok(Buffer.byteLength(preview.body) < TOPIC_BYTES); assert.ok(preview.body.endsWith("中文") || preview.body.endsWith("中"));
  // The bounded preview renders as truncated/read-only without any complete revision.
  const h = make({ entries: [old.metadata] }, 30, 100); h.panel.handleInput(keys.enter);
  h.panel.showDetail({ name: "preference", detail: preview });
  assert.match(h.text(), /Truncated preview[\s\S]*No complete revision[\s\S]*read-only/i);
  fs.writeFileSync(path, header(old.metadata) + "sk-" + "X".repeat(30) + "x".repeat(TOPIC_BYTES));
  assert.throws(() => readDetail(f.store, "preference"), /Values are not displayed/);
  fs.writeFileSync(path, "bad\n" + "x".repeat(TOPIC_BYTES)); assert.throws(() => readDetail(f.store, "preference"), /frontmatter/);
  fs.writeFileSync(path, Buffer.concat([Buffer.from(header(old.metadata) + "x".repeat(TOPIC_BYTES)), Buffer.from([0xff])]));
  // Interior invalid bytes within the bounded preview cannot be repaired by trimming.
  const invalid = fs.readFileSync(path); invalid[TOPIC_BYTES - 1] = 0xff; fs.writeFileSync(path, invalid);
  assert.throws(() => readDetail(f.store, "preference"), /valid UTF-8/);
  fs.unlinkSync(path); fs.symlinkSync(join(f.root, "outside"), path); assert.throws(() => readDetail(f.store, "preference"), /private regular/);
});

it("oversize preview trims only valid incomplete UTF-8 prefixes and reads at most 16KiB+1", async t => {
  const f = fixture(t); await f.store.write(input()); const record = f.store.read("preference");
  const prefix = Buffer.from(header(record.metadata));
  for (const bytes of [[0xe0, 0x80], [0xed, 0xa0], [0xf0, 0x80, 0x80], [0xf4, 0x90, 0x80]]) {
    fs.writeFileSync(record.path, Buffer.concat([prefix, Buffer.alloc(TOPIC_BYTES - prefix.length - bytes.length, 0x78), Buffer.from(bytes), Buffer.from([0x80, 0x78])]));
    assert.throws(() => readDetail(f.store, "preference"), /valid UTF-8/);
  }
  for (const bytes of [[0xc2], [0xe0, 0xa0], [0xed, 0x9f], [0xf0, 0x90, 0x80], [0xf4, 0x8f, 0x80]]) {
    fs.writeFileSync(record.path, Buffer.concat([prefix, Buffer.alloc(TOPIC_BYTES - prefix.length - bytes.length, 0x78), Buffer.from(bytes), Buffer.from([0x80, 0x78])]));
    const detail = readDetail(f.store, "preference");
    assert.equal(detail.revision, undefined); assert.ok(detail.body.endsWith("x"));
  }
});
