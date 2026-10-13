import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readLastLine } from "../output.ts";
import { BackgroundRegistry } from "../state.ts";
import { add, renderSidebar, createRunningJob, stopSidebarTicker } from "../registry.ts";
import type { UiContext } from "../types.ts";

const dir = mkdtempSync(join(tmpdir(), "pi-progress-"));
const ESC = String.fromCharCode(27);

function tmpLog(name: string, content: string): string {
    const p = join(dir, name);
    writeFileSync(p, content);
    return p;
}

void describe("readLastLine — live progress source", () => {
    void it("returns the last non-empty line", () => {
        const p = tmpLog("a.log", "line one\nline two\nline three\n");
        assert.equal(readLastLine(p), "line three");
    });

    void it("ignores trailing blank lines", () => {
        const p = tmpLog("b.log", "real progress\n\n\n");
        assert.equal(readLastLine(p), "real progress");
    });

    void it("strips ANSI colour codes but keeps literal brackets (JSON)", () => {
        const p = tmpLog("c.log", `${ESC}[32m{"indexed":[1,2,3],"status":"grey"}${ESC}[0m\n`);
        assert.equal(readLastLine(p), '{"indexed":[1,2,3],"status":"grey"}');
    });

    void it("collapses a carriage-return progress bar to its final segment", () => {
        const p = tmpLog("d.log", "downloading 10%\rdownloading 50%\rdownloading 99%");
        assert.equal(readLastLine(p), "downloading 99%");
    });

    void it("strips OSC sequences, tabs, and stray control chars (no escape injection)", () => {
        const BEL = String.fromCharCode(7);
        const p = tmpLog(
            "f.log",
            `${ESC}]0;window-title${BEL}col1\tcol2${BEL} done\n`
        );
        const out = readLastLine(p);
        assert.doesNotMatch(out, /window-title/, "OSC title sequence stripped");
        assert.doesNotMatch(out, new RegExp(`[${ESC}${BEL}\\t]`), "no control chars remain");
        assert.match(out, /col1 col2 done/);
    });

    void it("returns empty string when there is no output yet", () => {
        const p = tmpLog("e.log", "");
        assert.equal(readLastLine(p), "");
    });

    void it("returns empty string for a missing file", () => {
        assert.equal(readLastLine(join(dir, "nope.log")), "");
    });
});

void describe("renderSidebar — source publication and hint only", () => {
    function ctxStub() {
        const widgets: unknown[] = [];
        const statuses: (string | undefined)[] = [];
        const ctx = {
            ui: {
                notify() {},
                setWidget: (...args: unknown[]) => widgets.push(args),
                setStatus: (_name: string, content: string | undefined) => statuses.push(content),
                theme: { fg: (_c: string, t: string) => t },
            },
        } as unknown as UiContext;
        return { ctx, widgets, statuses };
    }
    void it("publishes both foreground and background source changes without a competing footer", () => {
        const reg = new BackgroundRegistry();
        for (const [id, background, kind] of [["shell", true, "shell"], ["monitor", true, "monitor"], ["foreground", false, "shell"]] as const) {
            add(reg, createRunningJob({ id, isBackgrounded: background, kind, command: "build", pid: 0, logPath: "/tmp/missing", toolCallId: id }));
        }
        const { ctx, widgets, statuses } = ctxStub();
        try {
            const revision = reg.revision;
            renderSidebar(reg, ctx);
            assert.deepEqual(statuses, [], "shared owner alone writes the task footer");
            assert.equal(widgets.length, 0, "never writes a background task widget");
            renderSidebar(reg, ctx);
            assert.equal(reg.revision, revision + 2, "source updates still publish for all modes");
            for (const job of reg.jobs.values()) job.status = "completed";
            renderSidebar(reg, ctx);
            assert.deepEqual(statuses, []);
            assert.equal(reg.sidebarTimer, undefined);
        } finally { stopSidebarTicker(reg); }
    });
    void it("foreground-only work does not appear in the footer", () => {
        const reg = new BackgroundRegistry();
        add(reg, createRunningJob({ id: "fg", isBackgrounded: false, command: "build", pid: 0, logPath: "/tmp/missing", toolCallId: "t" }));
        const { ctx, widgets, statuses } = ctxStub();
        try {
            renderSidebar(reg, ctx);
            assert.deepEqual(statuses, []);
            assert.deepEqual(widgets, []);
            assert.ok(reg.sidebarTimer, "foreground hint still has a duration ticker");
        } finally { stopSidebarTicker(reg); }
    });
});

process.on("exit", () => {
    try { rmSync(dir, { recursive: true, force: true }); } catch { /* best-effort */ }
});
