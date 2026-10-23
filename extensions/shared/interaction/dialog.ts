import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { InteractionResult } from "./result.ts";

export type DialogOptions = { timeout?: number };
export interface DialogScope {
    readonly signal: AbortSignal;
    isCurrent(): boolean;
    checkpoint(): void;
    select(title: string, options: string[], opts?: DialogOptions): Promise<string>;
    input(title: string, placeholder?: string, opts?: DialogOptions): Promise<string>;
    confirm(title: string, message: string, opts?: DialogOptions): Promise<boolean>;
}
export interface DialogRunOptions<T> {
    isCurrent(): boolean;
    signal?: AbortSignal;
    /** Synchronous domain settlement, only while this execution still owns the slot. */
    onSettled?(result: InteractionResult<T>): void;
}
type DialogContext = Pick<ExtensionContext, "ui" | "mode" | "hasUI">;
interface Execution { stop(): void }
export interface DialogOwner {
    cancel(): void;
    run<T>(ctx: DialogContext, options: DialogRunOptions<T>, callback: (flow: DialogScope) => Promise<T> | T): Promise<InteractionResult<T>>;
}

/** One consumer-owned dialog slot. Lifecycle policy and side effects stay with the caller. */
export function createDialogOwner(): DialogOwner {
    let current: Execution | undefined;
    return {
        cancel() {
            const previous = current;
            current = undefined;
            previous?.stop();
        },
        async run<T>(ctx: DialogContext, options: DialogRunOptions<T>, callback: (flow: DialogScope) => Promise<T> | T): Promise<InteractionResult<T>> {
            const controller = new AbortController();
            const exit = Symbol("Dialog scope ended");
            let ended = false;
            let outcome: InteractionResult<T> | undefined;
            let release!: (result: InteractionResult<T>) => void;
            const terminal = new Promise<InteractionResult<T>>(resolve => { release = resolve; });
            const execution: Execution = { stop: () => end({ kind: "stale" }) };
            function end(result: InteractionResult<T>): void {
                if (ended) return;
                ended = true;
                outcome = result;
                release(result);
                controller.abort();
            }
            function admitted(): boolean {
                if (current !== execution || options.signal?.aborted) return false;
                const valid = options.isCurrent();
                // Consumer predicates may synchronously cancel or replace this execution.
                return valid && current === execution && !options.signal?.aborted;
            }
            function checkpoint(): void {
                if (!ended) {
                    try { if (!admitted()) end({ kind: "stale" }); }
                    catch (error) { end({ kind: "error", error }); }
                }
                if (ended) throw exit;
            }
            const previous = current;
            // Publish the new slot before aborting: an abort listener's newer run wins.
            current = execution;
            previous?.stop();
            const onAbort = () => execution.stop();
            options.signal?.addEventListener("abort", onAbort, { once: true });
            async function dialog<V>(method: "select" | "input" | "confirm", invoke: () => Promise<V>, cancelled: (value: V) => boolean): Promise<V> {
                checkpoint();
                if (typeof ctx.ui[method] !== "function") { end({ kind: "unsupported", mode: ctx.mode }); throw exit; }
                // Both branches remain observed even when a non-cooperative host never settles.
                const host = Promise.resolve(invoke()).then(value => ({ value }));
                const response = await Promise.race([host, terminal.then(() => { throw exit; })]);
                checkpoint();
                if (cancelled(response.value)) { end({ kind: "cancelled" }); throw exit; }
                return response.value;
            }
            const flow: DialogScope = {
                signal: controller.signal,
                isCurrent() { try { checkpoint(); return true; } catch { return false; } },
                checkpoint,
                async select(title, items, opts) {
                    const value = await dialog("select", () => ctx.ui.select(title, items, { ...opts, signal: controller.signal }), value => value === undefined);
                    return value!;
                },
                async input(title, placeholder, opts) {
                    const value = await dialog("input", () => ctx.ui.input(title, placeholder, { ...opts, signal: controller.signal }), value => value === undefined);
                    return value!;
                },
                confirm: (title, message, opts) => dialog("confirm", () => ctx.ui.confirm(title, message, { ...opts, signal: controller.signal }), () => false),
            };
            try {
                checkpoint();
                if (!ctx.hasUI) {
                    end({ kind: "unsupported", mode: ctx.mode });
                } else {
                    const work = Promise.resolve().then(() => { checkpoint(); return callback(flow); }).then(
                        value => { if (!ended) { checkpoint(); end({ kind: "completed", value }); } return outcome!; },
                        error => {
                            if (!ended) {
                                try { checkpoint(); end({ kind: "error", error }); } catch { /* checkpoint recorded the terminal result. */ }
                            }
                            return outcome!;
                        },
                    );
                    await Promise.race([work, terminal]);
                }
            } catch (error) {
                if (!ended) end({ kind: "error", error });
            } finally {
                options.signal?.removeEventListener("abort", onAbort);
                if (!ended) end({ kind: "stale" });
            }
            let result = outcome!;
            try {
                if (!admitted()) result = { kind: "stale" };
                else options.onSettled?.(result);
            } catch (error) { result = { kind: "error", error }; }
            // The settlement hook can reenter run/cancel; never clear its replacement.
            if (current === execution) current = undefined;
            else result = { kind: "stale" };
            return result;
        },
    };
}
