import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createBashToolDefinition } from "@earendil-works/pi-coding-agent";
import { validateToolArguments } from "@earendil-works/pi-ai";
import { BackgroundRegistry } from "../state.ts";
import { DEFAULTS } from "../config.ts";
import { registerBashTool } from "../tools/bash.ts";
import { createProcessLifecycleParticipant } from "../lifecycle.ts";
import { processExists } from "../spawn.ts";
import { EVENT } from "../types.ts";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

function harness() {
    const dir = mkdtempSync(join(tmpdir(), "bash-contract-test-"));
    const messages: Array<{ customType: string; content: unknown }> = [];
    let tool!: Parameters<ExtensionAPI["registerTool"]>[0];
    const reg = new BackgroundRegistry({ ...DEFAULTS, logDir: dir, timeoutMs: 20 });
    const pi = { registerTool: (def: typeof tool) => { tool = def; }, sendMessage: (m: typeof messages[number]) => { messages.push(m); } };
    registerBashTool(pi as never, reg, createBashToolDefinition(dir));
    const ctx = { cwd: dir, ui: { notify() {}, setWidget() {}, setStatus() {}, theme: { fg: (_c: string, t: string) => t } } };
    return { tool, reg, messages, ctx, async close() {
        const lifecycle = createProcessLifecycleParticipant(reg, () => {});
        lifecycle.freeze(); lifecycle.stop(); await lifecycle.drain(); lifecycle.dispose();
        rmSync(dir, { recursive: true, force: true });
    } };
}

void describe("bash execution contract", () => {
    it("background threshold detaches even an allowed sleep without killing or changing PID", async () => {
        const h = harness();
        try {
            const pending = h.tool.execute("detach", { command: "sleep 0.2", background_after_seconds: 0.01 }, undefined, undefined, h.ctx as never);
            const job = [...h.reg.jobs.values()][0]!;
            const pid = job.pid, logPath = job.logPath;
            const result = await pending;
            assert.equal(job.pid, pid);
            assert.equal(job.logPath, logPath);
            assert.equal(h.reg.totalStarted, 1);
            assert.match(JSON.stringify(result.content), /background/);
            assert.equal(job.isBackgrounded, true);
            assert.equal(processExists(job.pid), true);
            await h.reg.executions.get(job)!.done;
            assert.equal(job.status, "completed");
            assert.equal(h.messages.filter(m => m.customType === EVENT.taskNotification).length, 1);
        } finally { await h.close(); }
    });
    it("immediate background completion notifies automatically", async () => {
        const h = harness();
        try {
            await h.tool.execute("bg", { command: "sleep 0.1", run_in_background: true }, undefined, undefined, h.ctx as never);
            const job = [...h.reg.jobs.values()][0]!;
            await h.reg.executions.get(job)!.done;
            assert.equal(job.status, "completed");
            assert.equal(h.messages.filter(m => m.customType === EVENT.taskNotification).length, 1);
        } finally { await h.close(); }
    });
    it("non-interactive foreground waits beyond configured threshold without duplicate notification", async () => {
        const h = harness(); h.reg.nonInteractive = true;
        try {
            const result = await h.tool.execute("fg", { command: "sleep 0.1; printf done" }, undefined, undefined, h.ctx as never);
            assert.match(JSON.stringify(result.content), /done/);
            assert.equal([...h.reg.jobs.values()][0]!.isBackgrounded, false);
            assert.equal(h.messages.length, 0);
        } finally { await h.close(); }
    });
    it("interactive foreground completion returns inline without a completion notification", async () => {
        const h = harness();
        try {
            const result = await h.tool.execute("fg", { command: "printf done", background_after_seconds: 1 }, undefined, undefined, h.ctx as never);
            assert.match(JSON.stringify(result.content), /done/);
            assert.equal([...h.reg.jobs.values()][0]!.isBackgrounded, false);
            assert.equal(h.messages.length, 0);
        } finally { await h.close(); }
    });
    for (const fence of ["closed", "replaced"] as const) {
        it(`late background completion cannot notify or mutate a ${fence} session`, async () => {
            const h = harness();
            try {
                await h.tool.execute("old", { command: "sleep 0.1", run_in_background: true }, undefined, undefined, h.ctx as never);
                const job = [...h.reg.jobs.values()][0]!;
                const execution = h.reg.executions.get(job)!;
                if (fence === "closed") h.reg.closed = true;
                else h.reg.jobs.delete(job.id);
                await execution.done;
                assert.equal(h.reg.completedCount, 0);
                assert.equal(h.reg.failedCount, 0);
                assert.equal(h.messages.length, 0);
                assert.equal(processExists(job.pid), false);
            } finally { await h.close(); }
        });
    }
    it("rejects removed fields and incompatible modes before effects", async () => {
        const h = harness();
        try {
            for (const field of ["timeout", "notify"]) {
                const args = { command: "true", [field]: 1 };
                assert.throws(() => validateToolArguments(h.tool, { id: "bad", name: "bash", arguments: args } as never), new RegExp(field));
                await assert.rejects(h.tool.execute("bad", args, undefined, undefined, h.ctx as never), new RegExp(field));
            }
            await assert.rejects(h.tool.execute("bad", { command: "true", run_in_background: true, background_after_seconds: 1 }, undefined, undefined, h.ctx as never), /cannot be combined/);
            h.reg.nonInteractive = true;
            await assert.rejects(h.tool.execute("bad", { command: "true", background_after_seconds: 1 }, undefined, undefined, h.ctx as never), /non-interactive/);
            assert.equal(h.reg.totalStarted, 0);
        } finally { await h.close(); }
    });
});
