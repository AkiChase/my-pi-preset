/**
 * Failure notifications inline the tail of the job's log (local deviation from
 * upstream v2.0.0, which sent only "... failed with exit code N" and so forced
 * a `jobs output` round-trip on every failure).
 */

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BackgroundRegistry } from "../state.ts";
import { buildTaskNotification, failureTail, sendTaskNotification } from "../notify.ts";
import { readTailLines } from "../output.ts";
import type { Job } from "../types.ts";
import { DEFAULTS } from "../config.ts";

// A real temp dir, never ~/.pi — tests must stay offline and self-contained.
let dir: string;
before(() => {
    dir = mkdtempSync(join(tmpdir(), "bg-tasks-tail-"));
});
after(() => {
    rmSync(dir, { recursive: true, force: true });
});

function writeLog(name: string, content: string): string {
    const path = join(dir, name);
    writeFileSync(path, content);
    return path;
}

function mkJob(over: Partial<Job>): Job {
    return {
        id: "job-1-1",
        command: "npm test",
        pid: 100,
        startTime: Date.now(),
        status: "failed",
        exitCode: 1,
        logPath: join(dir, "missing.log"),
        toolCallId: "tc-42",
        isBackgrounded: true,
        ...over,
    } as Job;
}

function harness() {
    const messages: {
        content: string;
        details?: { status?: string; outputTail?: string };
    }[] = [];
    const pi = { sendMessage: (m: never) => messages.push(m) };
    return { reg: new BackgroundRegistry(), pi, messages };
}

void describe("readTailLines", () => {
    void it("returns the last N non-empty lines", () => {
        const path = writeLog("many.log", "a\nb\nc\nd\ne\n");
        assert.equal(readTailLines(path, 2, 1_000), "d\ne");
    });
    void it("drops blank lines so the budget is spent on content", () => {
        const path = writeLog("blanks.log", "err1\n\n\n   \nerr2\n");
        assert.equal(readTailLines(path, 5, 1_000), "err1\nerr2");
    });
    void it("strips ANSI colour and collapses \\r progress redraws", () => {
        // A download bar would otherwise eat the whole budget and push the real
        // error out of the window.
        const path = writeLog(
            "ansi.log",
            "10%\r50%\r100%\n\u001b[31mFATAL: boom\u001b[0m\n"
        );
        assert.equal(readTailLines(path, 2, 1_000), "100%\nFATAL: boom");
    });
    void it("returns '' for an empty file", () => {
        assert.equal(readTailLines(writeLog("empty.log", ""), 5, 1_000), "");
    });
    void it("returns '' for a missing file rather than throwing", () => {
        assert.equal(readTailLines(join(dir, "nope.log"), 5, 1_000), "");
    });
    void it("honours the char bound, keeping the END of a huge log", () => {
        const path = writeLog("huge.log", `${"x".repeat(50_000)}\nLAST LINE\n`);
        const out = readTailLines(path, DEFAULTS.failureTailLines, DEFAULTS.failureTailChars);
        assert.ok(out.endsWith("LAST LINE"));
        // The truncation marker readBoundedTail prepends counts as a line, so
        // allow a little slack over the raw char budget.
        assert.ok(out.length < DEFAULTS.failureTailChars + 200);
    });
});

void describe("failureTail", () => {
    void it("is empty for a completed job — success costs no context", () => {
        const job = mkJob({ status: "completed", exitCode: 0, logPath: writeLog("ok.log", "all good\n") });
        assert.equal(failureTail(job, "completed"), "");
    });
    void it("carries the log tail for a failed job", () => {
        const job = mkJob({ logPath: writeLog("fail.log", "compiling\nERROR: missing semicolon\n") });
        assert.equal(failureTail(job, "failed"), "compiling\nERROR: missing semicolon");
    });
    void it("carries the log tail for a signal death (killed)", () => {
        // An external kill / OOM still notifies, and its tail is the only clue.
        const job = mkJob({ status: "killed", logPath: writeLog("oom.log", "allocating\n") });
        assert.equal(failureTail(job, "killed"), "allocating");
    });
    void it("says '(no output)' when a job failed having printed nothing", () => {
        assert.equal(failureTail(mkJob({}), "failed"), "(no output)");
    });
});

void describe("buildTaskNotification — <output_tail>", () => {
    void it("omits the element when there is no tail", () => {
        const xml = buildTaskNotification({
            taskId: "b1",
            outputFile: "/tmp/b1.log",
            status: "completed",
            summary: "done",
        });
        assert.ok(!xml.includes("<output_tail>"));
    });
    void it("includes and escapes the tail when present", () => {
        const xml = buildTaskNotification({
            taskId: "b1",
            outputFile: "/tmp/b1.log",
            status: "failed",
            summary: "failed",
            outputTail: "error in <main> & co",
        });
        assert.match(xml, /<output_tail>\nerror in &lt;main&gt; &amp; co\n<\/output_tail>/);
    });
});

void describe("sendTaskNotification — failure carries its own output", () => {
    void it("inlines the tail in both the XML and details", () => {
        const { reg, pi, messages } = harness();
        const job = mkJob({ logPath: writeLog("send-fail.log", "ERROR: boom\n") });
        sendTaskNotification({ reg, pi: pi as never, job });
        assert.equal(messages.length, 1);
        assert.match(messages[0]!.content, /<output_tail>\nERROR: boom\n<\/output_tail>/);
        assert.equal(messages[0]!.details?.outputTail, "ERROR: boom");
    });
    void it("sends no tail for a completed job", () => {
        const { reg, pi, messages } = harness();
        const job = mkJob({
            status: "completed",
            exitCode: 0,
            logPath: writeLog("send-ok.log", "fine\n"),
        });
        sendTaskNotification({ reg, pi: pi as never, job });
        assert.ok(!messages[0]!.content.includes("<output_tail>"));
        assert.equal(messages[0]!.details?.outputTail, undefined);
    });
});
