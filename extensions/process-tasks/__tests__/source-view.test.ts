import assert from "node:assert/strict";
import { it } from "node:test";
import { BackgroundRegistry } from "../state.ts";
import { DEFAULTS } from "../config.ts";
import { createProcessTaskSource } from "../source.ts";
import { createRunningJob } from "../registry.ts";

void it("process read projection falls back for blank names while retaining full command and identity", () => {
    const reg = new BackgroundRegistry(DEFAULTS);
    const source = createProcessTaskSource(reg);
    try {
        for (const [index, name] of [undefined, "", " \n\t", " Run checks "].entries()) {
            const command = "TRELLIS_CONTEXT_ID=original printf '完整命令'";
            const job = createRunningJob({ id: `b${index}`, name, command, pid: 0, logPath: "/unused", toolCallId: `call${index}` });
            reg.jobs.set(job.id, job);
            const row = source.list().find(row => row.taskId === job.id)!;
            assert.equal(row.title, name?.trim() ? name : command);
            assert.equal(row.description, command);
            assert.equal(row.runId, job.id);
            assert.equal(job.command, command); assert.equal(job.name, name);
        }
    } finally { source.dispose(); reg.coordinator.dispose(); }
});
