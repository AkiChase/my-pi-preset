import assert from "node:assert/strict";
import { it } from "node:test";
import type { ExtensionContext, ExtensionUIContext } from "@earendil-works/pi-coding-agent";
import { runOverlay } from "../overlay.ts";
import type { OverlayComponent, OverlayInteraction } from "../overlay.ts";

function harness() {
    let installed = false, doneCount = 0, disposeCount = 0;
    let install!: () => void;
    let dispose!: () => void;
    let interaction!: OverlayInteraction<string>;
    const owner = new AbortController();
    const ctx = { mode: "tui", hasUI: true, ui: {
        custom: ((factory, options) => new Promise(resolve => {
            const component = factory({} as never, {} as never, {} as never, result => {
                assert.ok(installed, "must not complete before own installation");
                doneCount++; resolve(result);
                void Promise.resolve(component).then(component => component.dispose?.());
            });
            dispose = () => { void Promise.resolve(component).then(component => component.dispose?.()); };
            install = () => { installed = true; options?.onHandle?.({} as never); };
        })) as ExtensionUIContext["custom"],
    } } as Pick<ExtensionContext, "mode" | "hasUI" | "ui">;
    const start = (inside?: (runtime: OverlayInteraction<string>) => void) => runOverlay(ctx, {
        isCurrent: () => true, signal: owner.signal,
        create(_tui, _theme, _keys, runtime) {
            interaction = runtime;
            inside?.(runtime);
            return { render: () => [], invalidate() {}, dispose() { disposeCount++; } };
        },
    });
    return { start, owner, ctx, install: () => install(), dispose: () => dispose(), runtime: () => interaction,
        doneCount: () => doneCount, disposeCount: () => disposeCount };
}

it("completion during creation waits for installation and disposes exactly once", async () => {
    const h = harness();
    const pending = h.start(runtime => runtime.complete("value"));
    assert.equal(h.doneCount(), 0); assert.equal(h.disposeCount(), 1);
    h.install(); h.install();
    assert.deepEqual(await pending, { kind: "completed", value: "value" });
    h.runtime().cancel();
    assert.equal(h.doneCount(), 1); assert.equal(h.disposeCount(), 1);
});
it("user cancellation and external owner cancellation have distinct results", async () => {
    const h = harness(), pending = h.start();
    h.install(); h.runtime().cancel();
    assert.deepEqual(await pending, { kind: "cancelled" });
    const next = harness(), stale = next.start();
    next.owner.abort();
    assert.equal(next.doneCount(), 0); assert.ok(next.runtime().signal.aborted);
    next.install();
    assert.deepEqual(await stale, { kind: "stale" });
    assert.equal(next.disposeCount(), 1);
});
it("external host disposal is stale and owned pending work is drained", async () => {
    const h = harness(), pending = h.start();
    h.install(); h.dispose();
    assert.deepEqual(await pending, { kind: "stale" });
    assert.equal(h.doneCount(), 1); assert.equal(h.disposeCount(), 1);
    let release!: () => void, runtime!: OverlayInteraction<void>, drained = false;
    const work = new Promise<void>(resolve => { release = resolve; });
    const next = runOverlay(h.ctx, { isCurrent: () => true,
        create(_tui, _theme, _keys, value) {
            runtime = value;
            return { render: () => [], invalidate() {}, async waitForPending() { await work; drained = true; } };
        },
    });
    h.install(); runtime.cancel();
    await Promise.resolve(); assert.equal(drained, false);
    release(); assert.equal((await next).kind, "cancelled"); assert.equal(drained, true);
});
it("mode preflight and factory failures do not install UI or notify", async () => {
    const h = harness();
    for (const mode of ["rpc", "json", "print"] as const) {
        h.ctx.mode = mode;
        assert.deepEqual(await h.start(), { kind: "unsupported", mode });
    }
    h.ctx.mode = "tui";
    const error = new Error("factory failed");
    assert.deepEqual(await runOverlay(h.ctx, { isCurrent: () => true, create() { throw error; } }), { kind: "error", error });
    h.owner.abort(); assert.deepEqual(await h.start(), { kind: "stale" });
});

it("ownership predicate exceptions return typed errors before and during installation", async () => {
    const error = new Error("ownership failed"), h = harness();
    assert.deepEqual(await runOverlay(h.ctx, { isCurrent() { throw error; }, create() { throw new Error("must not create"); } }), { kind: "error", error });
    let throws = false;
    const pending = runOverlay(h.ctx, {
        isCurrent() { if (throws) throw error; return true; },
        create() { return { render: () => [], invalidate() {} }; },
    });
    throws = true;
    assert.doesNotThrow(() => h.install());
    assert.deepEqual(await pending, { kind: "error", error });
    assert.equal(h.doneCount(), 1);
});

function synchronousHost(config: { doneError?: Error; afterInstallError?: Error } = {}) {
    let doneCount = 0;
    const ctx = { mode: "tui", hasUI: true, ui: {
        custom: ((factory, options) => new Promise((resolve, reject) => {
            let component: OverlayComponent;
            component = factory({} as never, {} as never, {} as never, result => {
                doneCount++;
                if (config.doneError) throw config.doneError;
                // Exercise disposal reentrancy in the done call itself, not a later microtask.
                component.dispose?.();
                resolve(result);
            }) as OverlayComponent;
            options?.onHandle?.({} as never);
            if (config.afterInstallError) reject(config.afterInstallError);
        })) as ExtensionUIContext["custom"],
    } } as Pick<ExtensionContext, "mode" | "hasUI" | "ui">;
    return { ctx, doneCount: () => doneCount };
}

it("a host failure after installation still closes and drains the installed component", async () => {
    const error = new Error("host failed after installation"), h = synchronousHost({ afterInstallError: error });
    const events: string[] = [];
    const result = await runOverlay(h.ctx, { isCurrent: () => true,
        create(_tui, _theme, _keys, runtime) {
            runtime.signal.addEventListener("abort", () => events.push("abort"));
            return { render: () => [], invalidate() {}, dispose() { events.push("dispose"); },
                async waitForPending() { events.push("drain"); } };
        },
    });
    assert.deepEqual(result, { kind: "error", error });
    assert.equal(h.doneCount(), 1);
    assert.deepEqual(events, ["abort", "dispose", "drain"]);
});

it("a throwing done callback does not escape or leave the runtime pending", async () => {
    const error = new Error("done failed"), h = synchronousHost({ doneError: error });
    let runtime!: OverlayInteraction<void>, disposeCount = 0, drainCount = 0;
    const pending = runOverlay(h.ctx, { isCurrent: () => true,
        create(_tui, _theme, _keys, interaction) {
            runtime = interaction;
            return { render: () => [], invalidate() {}, dispose() { disposeCount++; },
                async waitForPending() { drainCount++; } };
        },
    });
    assert.doesNotThrow(() => runtime.cancel());
    assert.deepEqual(await pending, { kind: "error", error });
    runtime.cancel();
    assert.equal(h.doneCount(), 1); assert.equal(disposeCount, 1); assert.equal(drainCount, 1);
});

it("synchronous disposal reentrancy preserves completion and cleanup failure classification", async () => {
    const h = synchronousHost();
    let runtime!: OverlayInteraction<string>, disposeCount = 0;
    const pending = runOverlay(h.ctx, { isCurrent: () => true,
        create(_tui, _theme, _keys, interaction) {
            runtime = interaction;
            return { render: () => [], invalidate() {}, dispose() { disposeCount++; runtime.cancel(); } };
        },
    });
    runtime.complete("value");
    assert.deepEqual(await pending, { kind: "completed", value: "value" });
    assert.equal(h.doneCount(), 1); assert.equal(disposeCount, 1);
    for (const stale of [false, true]) {
        const owner = new AbortController(), next = synchronousHost(), error = new Error("cleanup failed");
        let interaction!: OverlayInteraction<void>, drained = false;
        const work = runOverlay(next.ctx, { isCurrent: () => true, signal: owner.signal,
            create(_tui, _theme, _keys, value) {
                interaction = value;
                return { render: () => [], invalidate() {}, dispose() { throw error; },
                    async waitForPending() { drained = true; throw error; } };
            },
        });
        if (stale) owner.abort(); else interaction.cancel();
        assert.deepEqual(await work, stale ? { kind: "stale" } : { kind: "error", error });
        assert.equal(drained, true); assert.equal(next.doneCount(), 1);
    }
});

it("ownership changes at installation and while draining cannot yield old completion", async () => {
    const h = harness();
    let current = true, runtime!: OverlayInteraction<string>, release!: () => void;
    const drain = new Promise<void>(resolve => { release = resolve; });
    const pending = runOverlay(h.ctx, { isCurrent: () => current,
        create(_tui, _theme, _keys, interaction) {
            runtime = interaction;
            return { render: () => [], invalidate() {}, async waitForPending() { await drain; } };
        },
    });
    h.install(); runtime.complete("old"); current = false; release();
    assert.deepEqual(await pending, { kind: "stale" });
    const next = harness(); current = true;
    const stale = runOverlay(next.ctx, { isCurrent: () => current,
        create(_tui, _theme, _keys, interaction) {
            runtime = interaction;
            return { render: () => [], invalidate() {} };
        },
    });
    current = false; next.install();
    assert.ok(runtime.signal.aborted); assert.equal(runtime.isCurrent(), false);
    assert.deepEqual(await stale, { kind: "stale" });
});
