import type { ExtensionContext, ExtensionUIContext, Theme, KeybindingsManager } from "@earendil-works/pi-coding-agent";
import type { Component, TUI } from "@earendil-works/pi-tui";

export type InteractionResult<T> =
    | { kind: "completed"; value: T }
    | { kind: "cancelled" }
    | { kind: "stale" }
    | { kind: "unsupported"; mode: ExtensionContext["mode"] }
    | { kind: "error"; error: unknown };

export interface OverlayInteraction<T> {
    readonly signal: AbortSignal;
    isCurrent(): boolean;
    complete(value: T): void;
    cancel(): void;
}

export type OverlayComponent = Component & { dispose?(): void; waitForPending?(): Promise<void> };
export interface RunOverlayOptions<T> {
    isCurrent(): boolean;
    signal?: AbortSignal;
    overlayOptions?: NonNullable<Parameters<ExtensionUIContext["custom"]>[1]>["overlayOptions"];
    create(tui: TUI, theme: Theme, keys: KeybindingsManager, interaction: OverlayInteraction<T>): OverlayComponent;
}

/** Consumer-called overlay lifecycle. No session subscriptions, domain state, or notifications. */
export async function runOverlay<T>(
    ctx: Pick<ExtensionContext, "mode" | "hasUI" | "ui">,
    options: RunOverlayOptions<T>,
): Promise<InteractionResult<T>> {
    const controller = new AbortController();
    let outcome: InteractionResult<T> | undefined;
    let component: OverlayComponent | undefined;
    let installed = false, disposed = false, doneCalled = false;
    let done: ((result: InteractionResult<T>) => void) | undefined;
    let failHost!: (result: InteractionResult<T>) => void;
    const hostFailure = new Promise<InteractionResult<T>>(resolve => { failHost = resolve; });
    let ownershipError: { error: unknown } | undefined;
    const owns = () => {
        if (options.signal?.aborted) return false;
        try { return options.isCurrent(); }
        catch (error) { ownershipError = { error }; return false; }
    };
    const dispose = () => {
        if (disposed || !component) return;
        disposed = true;
        try { component.dispose?.(); }
        catch (error) { if (outcome?.kind !== "stale") outcome = { kind: "error", error }; }
    };
    const finishHost = () => {
        if (!installed || !done || !outcome || doneCalled) return;
        doneCalled = true;
        try { done(outcome); }
        catch (error) {
            if (outcome.kind !== "stale") outcome = { kind: "error", error };
            // A failed callback may never settle custom(). Release our wait without retrying done.
            failHost(outcome);
        }
    };
    const finish = (result: InteractionResult<T>) => {
        if (outcome) return;
        outcome = owns() ? result : { kind: "stale" };
        controller.abort(new DOMException("Overlay interaction ended", "AbortError"));
        dispose();
        finishHost();
    };
    const invalidate = () => finish({ kind: "stale" });
    const interaction: OverlayInteraction<T> = {
        signal: controller.signal,
        isCurrent: () => !outcome && owns(),
        complete: value => finish({ kind: "completed", value }),
        cancel: () => finish({ kind: "cancelled" }),
    };
    try {
        if (!owns()) return ownershipError ? { kind: "error", error: ownershipError.error } : { kind: "stale" };
        if (ctx.mode !== "tui" || !ctx.hasUI || typeof ctx.ui.custom !== "function") {
            return { kind: "unsupported", mode: ctx.mode };
        }
        options.signal?.addEventListener("abort", invalidate, { once: true });
        const custom = ctx.ui.custom<InteractionResult<T>>((tui, theme, keys, complete) => {
            done = complete;
            component = options.create(tui, theme, keys, interaction);
            // A factory or host call can synchronously reenter owner shutdown.
            if (!owns()) invalidate();
            if (outcome) dispose();
            // Keep native component identity/focus/mouse capabilities while owning disposal.
            return new Proxy(component, {
                get(target, property) {
                    if (property === "dispose") return () => { invalidate(); dispose(); };
                    const value = Reflect.get(target, property, target);
                    return typeof value === "function" ? value.bind(target) : value;
                },
                set(target, property, value) { return Reflect.set(target, property, value, target); },
            });
        }, {
            overlay: true,
            overlayOptions: options.overlayOptions,
            onHandle: () => {
                installed = true;
                if (!owns()) invalidate();
                finishHost();
            },
        });
        const result = await Promise.race([custom, hostFailure]);
        if (!outcome) finish(result ?? { kind: "stale" });
    } catch (error) {
        if (!outcome || outcome.kind !== "stale") outcome = owns() ? { kind: "error", error } : { kind: "stale" };
    } finally {
        options.signal?.removeEventListener("abort", invalidate);
        controller.abort(new DOMException("Overlay interaction disposed", "AbortError"));
        dispose();
        finishHost();
        try { await component?.waitForPending?.(); }
        catch (error) { if (outcome?.kind !== "stale") outcome = { kind: "error", error }; }
    }
    const current = owns();
    if (ownershipError && !options.signal?.aborted) return { kind: "error", error: ownershipError.error };
    return current ? outcome ?? { kind: "stale" } : { kind: "stale" };
}
