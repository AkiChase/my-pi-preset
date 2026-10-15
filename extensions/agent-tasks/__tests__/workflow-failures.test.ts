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
import vm from "node:vm";
import { WORKER_SOURCE } from "../src/workflow/worker-source.ts";
// Check the actual extracted JavaScript before any worker tests are admitted.
new vm.Script(WORKER_SOURCE, { filename: "workflow-worker.js" });
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

void it("effort accepts every level the host thinking parameter advertises, including off", { timeout: 10_000 }, async () => {
    // The two lists live in different files — a worker template literal cannot
    // import `invocation-config.ts` — so this is what keeps them from drifting.
    const { host } = hosts();
    for (const level of ["off", "minimal", "low", "medium", "high", "xhigh", "max"]) {
        const result = await runWorkflow({
            script: `${meta}\nreturn await agent("ok", { effort: ${JSON.stringify(level)} });`,
            host,
        });
        assert.equal(result.status, "completed", `effort=${level} must be accepted: ${String(result.error)}`);
    }
    const rejected = await runWorkflow({
        script: `${meta}\nreturn await agent("ok", { effort: "offf" });`,
        host,
    });
    assert.equal(rejected.status, "failed");
    assert.match(rejected.error ?? "", /off/);
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
    assert.match(text, /#0 a \[phase Scan\]: model refused/);
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

const authorCases = [
    { body: 'return await agent(" ");', reason: /agent\(prompt\).*non-empty/ },
    ...["label", "phase", "model", "agentType", "isolation", "gate", "resume", "effort"].map(option => ({
        body: `return await agent("a", { ${option}: " " });`, reason: new RegExp(`opts\\.${option}.*non-empty`),
    })),
    { body: 'phase(" ");', reason: /phase\(title\).*non-empty/ },
    { body: 'await parallel(null);', reason: /parallel\(thunks\).*array/ },
    { body: 'await parallel([42]);', reason: /item 0/ },
    { body: 'await parallel([() => 1, () => 2]);', reason: /over the limit/ , itemCap: 1 },
    { body: 'await pipeline(null, x => x);', reason: /pipeline.*array/ },
    { body: 'await pipeline([1, 2], x => x);', reason: /over the limit/, itemCap: 1 },
    { body: 'await pipeline([1], 42);', reason: /stage 0/ },
    { body: 'await agent("a", { schema: { const: 1n } });', reason: /BigInt.*opts.schema/ },
    { body: 'const schema = {}; schema.self = schema; await agent("a", { schema });', reason: /circular.*opts.schema/ },
    { body: 'await agent("a", { schema: { type: "not-a-type" } });', reason: /schema|type/ },
    { body: 'await workflow(" ");', reason: /non-empty name/ },
    { body: 'await workflow({ scriptPath: " " });', reason: /scriptPath.*non-empty/ },
    { body: 'await workflow({ name: " " });', reason: /name.*non-empty/ },
    { body: 'await workflow({});', reason: /name.*scriptPath/ },
    { body: 'await workflow(42);', reason: /saved workflow name/ },
    { body: 'await workflow("child", { n: 1n });', reason: /BigInt.*args/ },
    { body: 'const args = {}; args.self = args; await workflow("child", args);', reason: /circular.*args/ },
];
for (const construct of ["parallel", "pipeline"]) {
    for (const [index, example] of authorCases.entries()) void it(`${construct} propagates helper author validation ${index}: ${example.body}`, { timeout: 10_000 }, async () => {
        const { host, spawned } = hosts();
        let loads = 0;
        host.loadWorkflow = () => { loads++; return { ok: true, script: `${meta}\nreturn "child";` }; };
        const wrap = construct === "parallel"
            ? `return await parallel([async () => { ${example.body} }]);`
            : `return await pipeline([1], async () => { ${example.body} });`;
        const result = await runWorkflow({ script: `${meta}\n${wrap}`, host, ...("itemCap" in example ? { itemCap: example.itemCap } : {}) });
        assert.equal(result.status, "failed");
        assert.match(result.error ?? "", example.reason);
        assert.deepEqual(spawned, [], "validation must not spawn an agent");
        assert.equal(loads, 0, "validation must precede loading nested source");
        assert.deepEqual(logs(result.progress), [], "author errors are never logged as tolerated nulls");
    });
}

for (const construct of ["parallel", "pipeline"]) {
    for (const [name, child] of [
        ["missing", undefined],
        ["syntax", 'return (;'],
        ["invalid meta", 'export const meta = { name: "" }; return 1;'],
        ["nested author", 'await agent("a", { modle: "typo" });'],
        ["nested depth", 'await workflow("grandchild");'],
        ["nested boundary", 'return { value: 1n };'],
    ] as const) void it(`${construct} propagates ${name} nested workflow author errors`, { timeout: 10_000 }, async () => {
        const { host, spawned } = hosts();
        host.loadWorkflow = () => child === undefined ? { ok: false, message: "No workflow named missing." } : {
            ok: true, script: name === "invalid meta" ? child : `${meta}\n${child}`,
        };
        const call = 'workflow("child")';
        const wrapped = construct === "parallel" ? `return await parallel([() => ${call}]);` : `return await pipeline([1], () => ${call});`;
        const result = await runWorkflow({ script: `${meta}\n${wrapped}`, host });
        assert.equal(result.status, "failed");
        assert.match(result.error ?? "", /workflow\("child"\)/);
        if (name === "nested author") assert.match(result.error ?? "", /modle/);
        assert.deepEqual(spawned, []);
        assert.ok(!logs(result.progress).some(line => line.includes("resolved to null")));
    });
}

void it("explicit script try/catch can handle tagged author errors and nested resolution/compile failures", { timeout: 10_000 }, async () => {
    const { host, spawned } = hosts();
    host.loadWorkflow = ref => ref.name === "missing" ? { ok: false, message: "unknown saved workflow" } : { ok: true, script: `${meta}\nreturn (;` };
    const result = await runWorkflow({ script: `${meta}\nconst caught = [];
        for (const run of [() => agent(" "), () => workflow("missing"), () => workflow("syntax")]) {
            try { await run(); } catch (error) { caught.push(error.message); }
        }
        return caught;`, host });
    assert.equal(result.status, "completed");
    assert.equal((result.value as string[]).length, 3);
    assert.match((result.value as string[])[1]!, /workflow\("missing"\).*unknown saved/);
    assert.deepEqual(spawned, []);
});

void it("nested ordinary throws remain tolerant and attribute their child, phase, item and stage", { timeout: 10_000 }, async () => {
    const { host } = hosts();
    host.loadWorkflow = () => ({ ok: true, script: `${meta}\nphase("Check"); return await pipeline([1], () => { throw new Error("nested stage exploded"); });` });
    const result = await runWorkflow({ script: `${meta}\nreturn await workflow("child");`, host });
    assert.equal(result.status, "completed");
    assert.deepEqual(result.value, [null]);
    const reported = logs(result.progress).join("\n");
    assert.match(reported, /failure classification.*Check.*pipeline\(\) item 0 stage 0.*nested stage exploded/);
    host.loadWorkflow = () => ({ ok: true, script: `${meta}\nthrow new Error("ordinary child throw");` });
    const ordinary = await runWorkflow({ script: `${meta}\nreturn await parallel([() => workflow("child")]);`, host });
    assert.equal(ordinary.status, "completed");
    assert.deepEqual(ordinary.value, [null]);
    assert.match(logs(ordinary.progress).join("\n"), /branch 0.*workflow\("child"\).*ordinary child throw/);
});

void it("a failed gate is a tolerant child null with index/label/phase/reason in all task results", { timeout: 10_000 }, async () => {
    const { host } = hosts();
    host.runGate = async () => ({ ok: false, output: "gate refused unsafe change" });
    const result = await runWorkflow({ script: `${meta}\nphase("Verify"); return await pipeline([1], () => agent("work", { label: "gate-child", gate: "verify" }));`, host });
    assert.equal(result.status, "completed");
    assert.deepEqual(result.value, [null]);
    const { createWorkflowTask, updateWorkflowProgressBatch, completeWorkflowTask, workflowResultText, formatWorkflowNotification } = await import("../src/workflow/task.ts");
    const task = createWorkflowTask({ id: "wf_gate", script: "" });
    updateWorkflowProgressBatch(task, result.progress); completeWorkflowTask(task, result);
    for (const text of [workflowResultText(task), (await task.terminal).text, formatWorkflowNotification(task)]) {
        assert.match(text, /#0 gate-child \[phase Verify\]: gate refused unsafe change/);
    }
    assert.deepEqual(task.value, [null]);
});

void it("failure summaries are bounded, precede long script values, disclose omitted entries and preserve value", { timeout: 10_000 }, async () => {
    const { host } = hosts();
    const result = await runWorkflow({ script: `${meta}\nphase("Scan");
        log("parallel() looks like a failure but is just an ordinary log");
        await parallel(Array.from({ length: 8 }, (_, index) => () => { throw new Error("reason-" + index + "x".repeat(500)); }));
        return "value".repeat(2000);`, host });
    const { createWorkflowTask, updateWorkflowProgressBatch, completeWorkflowTask, workflowResultText, formatWorkflowNotification } = await import("../src/workflow/task.ts");
    const task = createWorkflowTask({ id: "wf_long", script: "" });
    updateWorkflowProgressBatch(task, result.progress); completeWorkflowTask(task, result);
    const text = workflowResultText(task);
    assert.match(text.slice(0, 500), /Tolerated failures \(8\).*\n.*Scan.*branch 0.*reason-0/s);
    assert.match(text, /and 3 more.*truncated/);
    assert.match(text, /reason-0.*truncated/);
    assert.ok(text.length < String(result.value).length + 2200);
    assert.match(text.slice(0, 500), /summary truncated/);
    assert.ok(text.endsWith(String(result.value)));
    assert.equal(task.value, result.value);
    assert.match(formatWorkflowNotification(task), /branch 0.*reason-0/);
    assert.match(formatWorkflowNotification(task), /truncated/);
});

void it("mixed child and thunk diagnostics share the host preview and long phases cannot hide reasons", { timeout: 10_000 }, async () => {
    const { host } = hosts();
    const result = await runWorkflow({ script: `${meta}\nphase("Scan" + "x".repeat(2000));
        await parallel([() => agent("DIE", { label: "failed-child" }), () => { throw new Error("distinct thunk reason"); }]);
        return "v".repeat(10000);`, host });
    assert.equal(result.status, "completed");
    const { createWorkflowTask, updateWorkflowProgressBatch, completeWorkflowTask, workflowResultText } = await import("../src/workflow/task.ts");
    const task = createWorkflowTask({ id: "wf_mixed", script: "" });
    updateWorkflowProgressBatch(task, result.progress); completeWorkflowTask(task, result);
    const preview = workflowResultText(task).slice(0, 500);
    assert.match(preview, /#0 failed-child.*agent died/);
    assert.match(preview, /parallel\(\) branch 1.*distinct thunk reason/);
    assert.match(preview, /truncated/);
    assert.equal(task.value, result.value);
});
