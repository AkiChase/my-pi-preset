import assert from "node:assert/strict";
import { getEventListeners } from "node:events";
import { it } from "node:test";
import type { ExtensionContext, ExtensionUIContext } from "@earendil-works/pi-coding-agent";
import { createDialogOwner, type DialogScope } from "../dialog.ts";

function deferred<T>() { let resolve!: (value: T) => void; let reject!: (error: Error) => void;
    const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }
const flush = () => new Promise<void>(resolve => setImmediate(resolve));
function context(ui: Partial<ExtensionUIContext> = {}, mode: ExtensionContext["mode"] = "tui") {
    return { mode, hasUI: mode !== "print", ui: { select: async () => "chosen", input: async () => "", confirm: async () => false, ...ui } } as Pick<ExtensionContext, "mode" | "hasUI" | "ui">;
}
it("a predicate's synchronous cancellation or replacement closes admission before callbacks and settlement", async () => {
    for (const phase of ["initial", "step", "settlement"] as const) {
        for (const action of ["cancel", "replace"] as const) {
            const owner = createDialogOwner(); let callbacks = 0, hostCalls = 0, hooks = 0;
            let nested: Promise<unknown> | undefined; let reentered = false; let scope: DialogScope | undefined;
            const pending = owner.run(context({ input: async () => { hostCalls++; return "value"; } }), {
                isCurrent() {
                    const trigger = phase === "initial" || (phase === "step" && !!scope) || (phase === "settlement" && !!scope?.signal.aborted);
                    if (trigger && !reentered) {
                        reentered = true;
                        if (action === "cancel") owner.cancel();
                        else nested = owner.run(context(), { isCurrent: () => true }, () => "new");
                    }
                    return true;
                },
                onSettled() { hooks++; },
            }, async flow => {
                callbacks++; scope = flow;
                return phase === "step" ? flow.input("old") : "old";
            });
            assert.deepEqual(await pending, { kind: "stale" }, `${phase}/${action}`);
            assert.equal(callbacks, phase === "initial" ? 0 : 1);
            assert.equal(hostCalls, 0); assert.equal(hooks, 0);
            if (nested) assert.deepEqual(await nested, { kind: "completed", value: "new" });
        }
    }
});
it("cancel promptly releases non-dialog callback work and observes late rejection", async () => {
    const owner = createDialogOwner(), gate = deferred<string>(); let scope!: DialogScope; let hooks = 0;
    const pending = owner.run(context(), { isCurrent: () => true, onSettled() { hooks++; } }, flow => {
        scope = flow; return gate.promise;
    });
    await flush(); owner.cancel(); assert.deepEqual(await pending, { kind: "stale" });
    assert.equal(scope.isCurrent(), false); assert.equal(scope.signal.aborted, true);
    gate.reject(new Error("late callback failure")); await flush(); assert.equal(hooks, 0);
});
it("ordinary host AbortError and missing dialog methods retain their distinct results", async () => {
    const owner = createDialogOwner(), error = new DOMException("host failed", "AbortError");
    for (const synchronous of [false, true]) {
        assert.deepEqual(await owner.run(context({ input: () => {
            if (synchronous) throw error; return Promise.reject(error);
        } }), { isCurrent: () => true }, flow => flow.input("Input")), { kind: "error", error });
    }
    assert.deepEqual(await owner.run(context({ select: undefined }, "rpc"), { isCurrent: () => true }, flow => flow.select("Select", [])), { kind: "unsupported", mode: "rpc" });
});
it("external listeners are removed for every terminal path and retired steps never reach the host", async () => {
    for (const kind of ["completed", "cancelled", "error", "unsupported", "stale"] as const) {
        const owner = createDialogOwner(), external = new AbortController(); let scope: DialogScope | undefined; let calls = 0;
        const ctx = context({ input: async () => { calls++; return undefined; } });
        const result = await owner.run(ctx, { isCurrent: () => true, signal: external.signal }, async flow => {
            scope = flow;
            if (kind === "cancelled") return flow.input("Input");
            if (kind === "error") throw new Error("business failure");
            if (kind === "unsupported") { ctx.ui.select = undefined as unknown as ExtensionUIContext["select"]; return flow.select("Select", []); }
            if (kind === "stale") { external.abort(); flow.checkpoint(); }
            return "ok";
        });
        assert.equal(result.kind, kind); assert.equal(getEventListeners(external.signal, "abort").length, 0);
        assert.equal(scope!.signal.aborted, true); assert.equal(scope!.isCurrent(), false);
        await assert.rejects(scope!.input("Retired")); assert.equal(calls, kind === "cancelled" ? 1 : 0);
    }
});
it("normal termination abort reentry cannot settle old domain state or clear the newer slot", async () => {
    const owner = createDialogOwner(), gate = deferred<string>(); let nested: Promise<unknown> | undefined; let hooks = 0;
    const old = owner.run(context(), { isCurrent: () => true, onSettled() { hooks++; } }, flow => {
        flow.signal.addEventListener("abort", () => {
            nested = owner.run(context(), { isCurrent: () => true }, () => gate.promise);
        }, { once: true });
        return "old";
    });
    assert.deepEqual(await old, { kind: "stale" }); assert.equal(hooks, 0);
    owner.cancel(); assert.deepEqual(await nested, { kind: "stale" }); gate.resolve("late"); await flush();
});

it("an old abort listener can cancel an outer replacement before callback admission", async () => {
    const owner = createDialogOwner(), gate = deferred<string>(); let callbacks = 0;
    const first = owner.run(context(), { isCurrent: () => true }, flow => {
        flow.signal.addEventListener("abort", () => owner.cancel(), { once: true });
        return gate.promise;
    });
    await flush();
    const replacement = owner.run(context(), { isCurrent: () => true }, () => { callbacks++; return "new"; });
    assert.deepEqual(await first, { kind: "stale" }); assert.deepEqual(await replacement, { kind: "stale" });
    assert.equal(callbacks, 0); gate.resolve("late"); await flush();
});

it("steps inherit signal/timeout, empty input and false confirmation preserve native semantics", async () => {
    const owner = createDialogOwner(); let scope!: DialogScope;
    const ctx = context({ select: async (_title, _items, opts) => { assert.equal(opts?.signal, scope.signal); assert.equal(opts?.timeout, 25); return "chosen"; } }, "rpc");
    assert.deepEqual(await owner.run(ctx, { isCurrent: () => true }, async flow => {
        scope = flow; assert.equal(await flow.select("title", ["chosen"], { timeout: 25 }), "chosen");
        assert.equal(await flow.input("input"), ""); return await flow.confirm("title", "message");
    }), { kind: "completed", value: false });
    assert.equal(scope.signal.aborted, true); assert.equal(scope.isCurrent(), false);
    assert.throws(() => scope.checkpoint());
});
it("undefined cancels the whole flow even if a business catch swallows its private exit", async () => {
    const owner = createDialogOwner(); let steps = 0;
    const result = await owner.run(context({ select: async () => undefined }), { isCurrent: () => true }, async flow => {
        try { await flow.select("title", []); } catch { /* Deliberate hostile callback. */ }
        try { await flow.input("next"); steps++; } catch { /* Still retired. */ }
        return "incorrect success";
    });
    assert.deepEqual(result, { kind: "cancelled" }); assert.equal(steps, 0);
});
it("cancel releases a noncooperative host and observes late rejection without applying it", async () => {
    const owner = createDialogOwner(), gate = deferred<string | undefined>(); let applied = false; let signal!: AbortSignal;
    const pending = owner.run(context({ input: async (_title, _hint, opts) => { signal = opts!.signal!; return gate.promise; } }), { isCurrent: () => true }, async flow => {
        await flow.input("input"); applied = true;
    });
    await flush(); owner.cancel(); assert.deepEqual(await pending, { kind: "stale" }); assert.equal(signal.aborted, true);
    gate.reject(new Error("late host failure")); await flush(); assert.equal(applied, false);
});
it("new execution owns settlement; old late completion cannot clear it", async () => {
    const owner = createDialogOwner(), first = deferred<string | undefined>(), second = deferred<string | undefined>(); let hooks = 0;
    const a = owner.run(context({ select: () => first.promise }), { isCurrent: () => true, onSettled: () => { hooks++; } }, flow => flow.select("a", []));
    await flush();
    const b = owner.run(context({ select: () => second.promise }), { isCurrent: () => true, onSettled: () => { hooks++; } }, flow => flow.select("b", []));
    assert.deepEqual(await a, { kind: "stale" }); first.resolve("late"); await flush();
    second.resolve("new"); assert.deepEqual(await b, { kind: "completed", value: "new" }); assert.equal(hooks, 1);
});
it("abort listener reentry supersedes the outer replacement before it opens a dialog", async () => {
    const owner = createDialogOwner(), gate = deferred<string | undefined>(); let nested: Promise<unknown> | undefined; let outerCalls = 0;
    const first = owner.run(context({ select: () => gate.promise }), { isCurrent: () => true }, async flow => {
        flow.signal.addEventListener("abort", () => { nested = owner.run(context(), { isCurrent: () => true }, () => "nested"); }, { once: true });
        return flow.select("first", []);
    });
    await flush();
    const outer = owner.run(context(), { isCurrent: () => true }, () => { outerCalls++; return "outer"; });
    assert.deepEqual(await first, { kind: "stale" }); assert.deepEqual(await outer, { kind: "stale" });
    assert.deepEqual(await nested, { kind: "completed", value: "nested" }); assert.equal(outerCalls, 0); gate.resolve(undefined);
});
it("external abort, stale predicates, unsupported UI and exceptions are distinct", async () => {
    const owner = createDialogOwner(), external = new AbortController(); external.abort();
    assert.deepEqual(await owner.run(context(), { isCurrent: () => true, signal: external.signal }, () => "no"), { kind: "stale" });
    assert.deepEqual(await owner.run(context(), { isCurrent: () => false }, () => "no"), { kind: "stale" });
    assert.deepEqual(await owner.run(context({}, "print"), { isCurrent: () => true }, () => "no"), { kind: "unsupported", mode: "print" });
    const error = new Error("ordinary failure");
    assert.deepEqual(await owner.run(context(), { isCurrent: () => true }, () => { throw error; }), { kind: "error", error });
    assert.deepEqual(await owner.run(context(), { isCurrent: () => { throw error; } }, () => "no"), { kind: "error", error });
    assert.deepEqual(await owner.run(context(), { isCurrent: () => true, onSettled: () => { throw error; } }, () => "yes"), { kind: "error", error });
});
it("stale response cannot open the next step; settlement reentry retains replacement", async () => {
    const owner = createDialogOwner(), gate = deferred<string | undefined>(); let valid = true; let next = 0;
    const pending = owner.run(context({ select: () => gate.promise, input: async () => { next++; return "input"; } }), { isCurrent: () => valid }, async flow => {
        await flow.select("a", []); return flow.input("b");
    });
    await flush(); valid = false; gate.resolve("a"); assert.deepEqual(await pending, { kind: "stale" }); assert.equal(next, 0);
    let replacement: Promise<unknown> | undefined;
    const result = await owner.run(context(), { isCurrent: () => true, onSettled: () => {
        replacement = owner.run(context(), { isCurrent: () => true }, () => "replacement");
    } }, () => "old");
    assert.deepEqual(result, { kind: "stale" }); assert.deepEqual(await replacement, { kind: "completed", value: "replacement" });
});
