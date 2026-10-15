/**
 * S3: workflow failure classification.
 *
 * `parallel()` and `pipeline()` keep their null tolerance for a subtask that
 * failed, but a script-author error must end the run instead of becoming
 * another null — otherwise `opts.modle` reads exactly like a dead agent and the
 * run quietly returns a shorter array. These drive the real worker through the
 * real message channel, so the classification is proven end to end rather than
 * against a copy of the logic.
 */
import "./source-loader.mjs";
import assert from "node:assert/strict";
import { it } from "node:test";
import type { WorkflowHost } from "../src/workflow/runtime.ts";
import type { WorkflowEntry } from "../src/workflow/progress.ts";
const { runWorkflow } = await import("../src/workflow/runtime.ts");

const meta = 'export const meta = { name: "failure classification", description: "offline" };';

function hosts() {
    const spawned: string[] = [];
    const host: WorkflowHost = {
        async spawnAgent(request) {
            spawned.push(request.prompt);
            // The prompt doubles as the scripted outcome, so a case can ask for a
            // dead agent without a second seam.
            return request.prompt.includes("DIE")
                ? { ok: false, error: "agent died" }
                : { ok: true, text: `answer:${request.prompt}`, tokens: 1, toolCalls: 0 };
        },
        abortAgent() {},
    };
    return { host, spawned };
}

function logs(progress: readonly WorkflowEntry[]): string[] {
    return progress.filter(entry => entry.type === "workflow_log").map(entry => (entry as { message: string }).message);
}

void it("an unrecognised agent option fails the run instead of resolving to null", { timeout: 10_000 }, async () => {
    const { host } = hosts();
    // `modle` for `model`: before this, the typo became a null inside parallel()
    // and the run completed with a hole where an answer should have been.
    const result = await runWorkflow({
        script: `${meta}\nconst out = await parallel([() => agent("a", { modle: "haiku" })]);\nreturn out;`,
        host,
    });
    assert.equal(result.status, "failed");
    assert.match(result.error ?? "", /modle/);
    assert.match(result.error ?? "", /not a recognised option/);
});

void it("an invalid effort fails the run and names the accepted levels", { timeout: 10_000 }, async () => {
    const { host } = hosts();
    const result = await runWorkflow({
        script: `${meta}\nreturn await pipeline([1], item => agent("b", { effort: "hyper" }));`,
        host,
    });
    assert.equal(result.status, "failed");
    assert.match(result.error ?? "", /effort/);
    assert.match(result.error ?? "", /minimal|low|medium|high/);
});

void it("a resume/start-option conflict fails the run rather than silently replaying", { timeout: 10_000 }, async () => {
    const { host } = hosts();
    const result = await runWorkflow({
        script: `${meta}\nreturn await parallel([() => agent("c", { resume: "child-1", model: "haiku" })]);`,
        host,
    });
    assert.equal(result.status, "failed");
    assert.match(result.error ?? "", /resume and opts\.model are mutually exclusive/);
});

void it("a dead subtask stays a null, reported by the agent entry itself", { timeout: 10_000 }, async () => {
    const { host, spawned } = hosts();
    const progress: WorkflowEntry[] = [];
    const result = await runWorkflow({
        script: `${meta}\nconst out = await parallel([() => agent("DIE"), () => agent("fine")]);\nreturn out.filter(Boolean);`,
        host,
        onProgress: entries => progress.push(...entries),
    });
    assert.equal(result.status, "completed", "one dead agent must not fail the run");
    assert.deepEqual(result.value, ["answer:fine"]);
    assert.deepEqual(spawned, ["DIE", "fine"], "both branches still ran");
    // A failed agent arrives as `ok: false`, which the host already records with
    // its reason before answering — the worker resolves null rather than
    // throwing, so this is not a case `parallel()`'s catch ever sees.
    const failed = progress.filter(entry => entry.type === "workflow_agent" && entry.state === "error");
    assert.equal(failed.length, 1);
    assert.equal((failed[0] as { error?: string }).error, "agent died");
    assert.ok(!logs(progress).some(line => line.includes("parallel()")), "a dead agent is not a dropped branch");
});

void it("a throwing thunk stays a null and is logged with its branch and reason", { timeout: 10_000 }, async () => {
    const { host } = hosts();
    const progress: WorkflowEntry[] = [];
    const result = await runWorkflow({
        script: `${meta}\nconst out = await parallel([() => { throw new Error("thunk exploded"); }, () => agent("fine")]);\nreturn out;`,
        host,
        onProgress: entries => progress.push(...entries),
    });
    assert.equal(result.status, "completed", "an ordinary throw is tolerated by design");
    assert.deepEqual(result.value, [null, "answer:fine"]);
    const reported = logs(progress).filter(line => line.includes("parallel()"));
    assert.equal(reported.length, 1, "exactly the dropped branch is reported");
    assert.match(reported[0]!, /branch 0/);
    assert.match(reported[0]!, /thunk exploded/);
});

void it("a throwing pipeline stage stays a null and is logged with its item and stage", { timeout: 10_000 }, async () => {
    const { host } = hosts();
    const progress: WorkflowEntry[] = [];
    const result = await runWorkflow({
        script: `${meta}\nconst out = await pipeline([1, 2], (item) => { if (item === 1) throw new Error("stage exploded"); return agent("ok"); });\nreturn out;`,
        host,
        onProgress: entries => progress.push(...entries),
    });
    assert.equal(result.status, "completed");
    assert.deepEqual(result.value, [null, "answer:ok"]);
    const reported = logs(progress).filter(line => line.includes("pipeline()"));
    assert.equal(reported.length, 1);
    assert.match(reported[0]!, /item 0 stage 0/);
    assert.match(reported[0]!, /stage exploded/);
});

void it("a stage-naming mistake is an author error, never a dropped item", { timeout: 10_000 }, async () => {
    const { host } = hosts();
    const result = await runWorkflow({
        script: `${meta}\nreturn await pipeline([1], "not a function");`,
        host,
    });
    assert.equal(result.status, "failed");
    assert.match(result.error ?? "", /stage 0 is not one/);
});

void it("the run-level error carries which agents failed and why", async () => {
    const { workflowResultText, workflowFailureSummary, formatWorkflowNotification } = await import("../src/workflow/task.ts");
    const base = {
        id: "wf_test", status: "failed" as const, script: "", agentCount: 2, totalTokens: 0, totalToolCalls: 0,
        workflowProgress: [
            { type: "workflow_agent" as const, index: 0, label: "a", phaseTitle: "Scan", state: "error" as const, error: "model refused" },
            { type: "workflow_agent" as const, index: 1, label: "b", state: "done" as const },
        ],
        logs: [], error: "Workflow aborted.",
    };
    const task = base as unknown as Parameters<typeof workflowResultText>[0];
    const text = workflowResultText(task);
    // The run-level reason alone left the caller knowing the workflow stopped but
    // not which child was responsible, and `task_manage output` returned the same
    // text — so this section is what makes the failure diagnosable in place.
    assert.match(text, /Workflow aborted\./);
    assert.match(text, /Failed agents \(1\)/);
    assert.match(text, /#0 Scan: model refused/);
    assert.ok(!text.includes("#1"), "a successful agent is not listed");

    // The notification renders the same text, so the reason travels with it.
    assert.match(formatWorkflowNotification(task, 0), /model refused/);

    // Bounded: five listed, the rest counted.
    const many = { ...base, workflowProgress: Array.from({ length: 8 }, (_, i) => ({ type: "workflow_agent" as const, index: i, label: `a${i}`, state: "error" as const, error: "boom" })) } as unknown as Parameters<typeof workflowResultText>[0];
    const summary = workflowFailureSummary(many);
    assert.match(summary, /Failed agents \(8\)/);
    assert.match(summary, /and 3 more/);

    // A clean run adds nothing.
    assert.equal(workflowFailureSummary({ ...base, workflowProgress: [base.workflowProgress[1]!] } as unknown as Parameters<typeof workflowResultText>[0]), "");
    assert.equal(workflowResultText({ ...base, error: undefined, value: "ok", workflowProgress: [base.workflowProgress[1]!] } as unknown as Parameters<typeof workflowResultText>[0]), "ok");
});
