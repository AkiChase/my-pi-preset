import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { appendFileSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { matchesKey, visibleWidth } from "@earendil-works/pi-tui";
import { BgTaskPanel, openBgListPanel, panelJobs } from "../ui.ts";
import { BackgroundRegistry } from "../state.ts";
import { DEFAULTS } from "../config.ts";
import { add, createRunningJob, stopSidebarTicker, sweepTerminal } from "../registry.ts";
import { markTerminal } from "../lifecycle.ts";
import { FINISHED_LINGER_MS, TERMINAL_RETENTION_MS, type UiContext } from "../types.ts";

function harness() {
    const dir = mkdtempSync(join(tmpdir(), "pi-bg-panel-"));
    const reg = new BackgroundRegistry();
    const copied: string[] = [];
    const notices: string[] = [];
    let renders = 0;
    let closed = 0;
    const terminal = { rows: 40 };
    const tui = { terminal, requestRender: () => { renders++; } };
    const theme = { fg: (_c: string, text: string) => text };
    const keys = { matches: (_data: string, _action?: string) => false };
    const ctx = { mode: "tui", ui: { notify: (text: string) => notices.push(text), setStatus() {}, setWidget() {}, select() { throw new Error("no nested select"); }, editor() { throw new Error("no nested editor"); }, theme } } as unknown as UiContext;
    const addJob = (id: string, startTime: number, text: string) => {
        const path = join(dir, `${id}.log`);
        writeFileSync(path, text);
        const job = createRunningJob({ id, name: id, command: `command-${id}`, pid: 0, logPath: path, toolCallId: id });
        job.startTime = startTime;
        return add(reg, job);
    };
    const panel = () => new BgTaskPanel({ reg, ctx, tui: tui as never, theme, keys, done: () => { closed++; }, copy: async (text) => { copied.push(text); } });
    return { reg, ctx, tui, theme, keys, addJob, panel, copied, notices, terminal, getRenders: () => renders, getClosed: () => closed, dispose: () => { stopSidebarTicker(reg); rmSync(dir, { recursive: true, force: true }); } };
}

void describe("Background Tasks overlay", () => {
    void it("selection instantly changes details; Tab switches arrows to output scrolling", () => {
        const h = harness();
        h.addJob("first", 2, Array.from({ length: 50 }, (_, i) => `FIRST-${i}`).join("\n"));
        h.addJob("second", 1, "SECOND-OUTPUT");
        const p = h.panel();
        try {
            assert.match(p.render(100).join("\n"), /command-first/);
            p.handleInput("\u001b[B");
            assert.match(p.render(100).join("\n"), /command-second/);
            p.handleInput("k");
            const tail = p.render(100).join("\n");
            assert.match(tail, /FIRST-49/);
            p.handleInput("\t");
            p.handleInput("\u001b[A");
            const scrolled = p.render(100).join("\n");
            assert.match(scrolled, /command-first/, "output arrows do not select second");
            assert.doesNotMatch(scrolled, /FIRST-49/);
            p.handleInput("\u001b[5~");
            assert.doesNotMatch(p.render(100).join("\n"), /FIRST-48/);
            p.handleInput("\t");
            p.handleInput("j");
            assert.match(p.render(100).join("\n"), /SECOND-OUTPUT/);
            assert.match(p.render(100).join("\n"), /Tab switch/);
        } finally { p.dispose(); h.dispose(); }
    });
    void it("live tail follows new lines, but does not force a scrolled reader back to the bottom", () => {
        const h = harness();
        const j = h.addJob("first", 1, Array.from({ length: 50 }, (_, i) => `LINE-${i}`).join("\n"));
        const p = h.panel();
        try {
            p.render(100);
            appendFileSync(j.logPath, "\nNEW-TAIL\n");
            assert.match(p.render(100).join("\n"), /NEW-TAIL/);
            p.handleInput("\t");
            p.handleInput("\u001b[5~");
            appendFileSync(j.logPath, "DO-NOT-JUMP\n");
            assert.doesNotMatch(p.render(100).join("\n"), /DO-NOT-JUMP/);
            p.handleInput("\u001b[F");
            assert.match(p.render(100).join("\n"), /DO-NOT-JUMP/);
        } finally { p.dispose(); h.dispose(); }
    });
    void it("copies absolute log path, kills only the selection, and hides the kill hint after completion", async () => {
        const h = harness();
        const first = h.addJob("first", 2, "hello");
        const other = h.addJob("other", 1, "other");
        const p = h.panel();
        try {
            p.handleInput("c");
            await Promise.resolve();
            assert.deepEqual(h.copied, [resolve(first.logPath)]);
            assert.match(h.notices[0], /Copied:/);
            p.handleInput("x");
            assert.equal(first.status, "killed");
            assert.equal(other.status, "running");
            assert.equal(h.reg.killedCount, 1);
            assert.doesNotMatch(p.render(100).join("\n"), /x kill/);
            p.handleInput("x");
            assert.equal(h.reg.killedCount, 1);
            p.handleInput("\u001b");
            assert.equal(h.getClosed(), 1);
            p.close();
            assert.equal(h.getClosed(), 1);
        } finally { p.dispose(); h.dispose(); }
    });
    void it("all terminal statuses hide at four seconds, but the viewed snapshot survives shrink and sweep", () => {
        const h = harness();
        const now = Date.now();
        const viewed = h.addJob("viewed", now, "FINAL-OUTPUT");
        const p = h.panel();
        try {
            p.render(100);
            p.handleInput("\t");
            for (const status of ["completed", "failed", "killed"] as const) {
                const j = status === "completed" ? viewed : h.addJob(status, now - 1, "done");
                markTerminal(h.reg, j, status);
                j.endedAt = now;
            }
            assert.equal(panelJobs(h.reg, now + FINISHED_LINGER_MS - 1).length, 3);
            assert.equal(panelJobs(h.reg, now + FINISHED_LINGER_MS).length, 0);
            p.render(100); // capture the terminal metadata before registry expiry
            sweepTerminal(h.reg, now + TERMINAL_RETENTION_MS);
            assert.equal(h.reg.jobs.size, 0);
            const body = p.render(100).join("\n");
            assert.match(body, /command-viewed/);
            assert.match(body, /FINAL-OUTPUT/);
            assert.doesNotMatch(body, /x kill/);
            assert.match(body, /Tab switch/);
        } finally { p.dispose(); h.dispose(); }
    });
    void it("width-safe rendering handles wide text, resizing, controls and narrow terminals", () => {
        const h = harness();
        const j = h.addJob("wide", 1, "中文😀".repeat(200) + "\u001b]0;BAD-TITLE\u0007\n");
        j.name = "中文😀".repeat(30);
        const p = h.panel();
        try {
            for (const width of [1, 7, 8, 20, 60, 100]) {
                p.invalidate();
                const lines = p.render(width);
                assert.ok(lines.every((line) => visibleWidth(line) <= width));
                assert.ok(lines.length <= Math.floor(h.terminal.rows * 0.7));
                assert.doesNotMatch(lines.join("\n"), /BAD-TITLE|\u0007/);
            }
            h.terminal.rows = 8;
            assert.ok(p.render(100).length <= Math.floor(8 * 0.7));
        } finally { p.dispose(); h.dispose(); }
    });
    void it("large logs show the skipped-byte range instead of pretending to contain the entire file", () => {
        const h = harness();
        h.addJob("large", 1, "x".repeat(DEFAULTS.outputPreviewChars * 3));
        const p = h.panel();
        try { assert.match(p.render(160).join("\n"), /earlier bytes omitted.*bytes 24000–36000 \/ 36000/); }
        finally { p.dispose(); h.dispose(); }
    });
    void it("disposal stops the refresh timer and input, including key release events", (t) => {
        t.mock.timers.enable({ apis: ["setInterval"] });
        const h = harness();
        h.addJob("first", 2, "first");
        h.addJob("second", 1, "second");
        const p = h.panel();
        try {
            p.handleInput("\u001b[106;1:3u");
            assert.match(p.render(100).join("\n"), /command-first/);
            t.mock.timers.tick(1000);
            const count = h.getRenders();
            assert.ok(count > 0);
            p.dispose();
            t.mock.timers.tick(3000);
            p.handleInput("j");
            assert.equal(h.getRenders(), count);
        } finally { p.dispose(); h.dispose(); }
    });
    void it("opens exactly one custom overlay, prevents duplicate opens and releases it on shutdown", async () => {
        const h = harness();
        h.addJob("first", 1, "first");
        let calls = 0;
        let component: BgTaskPanel | undefined;
        h.ctx.ui.custom = ((factory, options) => {
            calls++;
            assert.equal(options?.overlay, true);
            return new Promise<void>((done) => {
                component = factory(h.tui as never, h.theme as never, h.keys as never, done as never) as BgTaskPanel;
            });
        }) as NonNullable<UiContext["ui"]["custom"]>;
        try {
            const pending = openBgListPanel(h.reg, h.ctx);
            await openBgListPanel(h.reg, h.ctx);
            assert.equal(calls, 1);
            assert.ok(component);
            assert.ok(h.reg.panelOpen);
            h.reg.closePanel?.();
            await pending;
            assert.equal(h.reg.panelOpen, false);
            assert.equal(h.reg.closePanel, undefined);
        } finally { component?.dispose(); h.dispose(); }
    });
    void it("uses configurable navigation bindings inside the overlay only", () => {
        const h = harness();
        h.addJob("first", 2, "first");
        h.addJob("second", 1, "second");
        h.keys.matches = (data: string, action?: string) => action === "tui.select.down" && matchesKey(data, "ctrl+n");
        const p = h.panel();
        try { p.handleInput("\u000e"); assert.match(p.render(100).join("\n"), /command-second/); }
        finally { p.dispose(); h.dispose(); }
    });
});
