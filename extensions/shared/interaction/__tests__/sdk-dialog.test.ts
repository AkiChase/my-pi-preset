import assert from "node:assert/strict";
import { getEventListeners } from "node:events";
import { it } from "node:test";
import type { ExtensionContext, ExtensionUIContext } from "@earendil-works/pi-coding-agent";
import { InteractiveMode } from "../../../task-ui/__tests__/editor-host.mjs";
import { createDialogOwner } from "../dialog.ts";

const flush = () => new Promise<void>(resolve => setImmediate(resolve));
function hostContext() {
    const mounted: { handleInput(data: string): void }[] = [];
    const removed: unknown[] = [];
    const host = {
        ui: { requestRender() {} },
        pushExtensionDialog(component: typeof mounted[number]) { mounted.push(component); },
        removeExtensionDialog(component: unknown) { removed.push(component); },
        showExtensionSelector: InteractiveMode.prototype.showExtensionSelector,
    };
    const ui = {
        select: InteractiveMode.prototype.showExtensionSelector.bind(host),
        input: InteractiveMode.prototype.showExtensionInput.bind(host),
        confirm: InteractiveMode.prototype.showExtensionConfirm.bind(host),
    } as ExtensionUIContext;
    return { mounted, removed, ctx: { mode: "tui", hasUI: true, ui } as Pick<ExtensionContext, "mode" | "hasUI" | "ui"> };
}
it("installed SDK selector and input return native values and retire their own components", async () => {
    const h = hostContext(), owner = createDialogOwner(); let signal!: AbortSignal;
    const pending = owner.run(h.ctx, { isCurrent: () => true }, async flow => {
        signal = flow.signal;
        const selected = await flow.select("Select", ["first", "second"]);
        const input = await flow.input("Input"); return { selected, input };
    });
    await flush(); h.mounted[0].handleInput("\r");
    await flush(); h.mounted[1].handleInput("\r");
    assert.deepEqual(await pending, { kind: "completed", value: { selected: "first", input: "" } });
    assert.deepEqual(h.removed, h.mounted);
    assert.equal(getEventListeners(signal, "abort").length, 0);
});
it("installed SDK abort closes only the owned dialog and never starts its next step", async () => {
    for (const method of ["select", "input", "confirm"] as const) {
        const h = hostContext(), owner = createDialogOwner(); let next = false; let signal!: AbortSignal;
        const pending = owner.run(h.ctx, { isCurrent: () => true }, async flow => {
            signal = flow.signal;
            if (method === "select") await flow.select("Select", ["one"]);
            else if (method === "input") await flow.input("Input");
            else await flow.confirm("Confirm", "Message");
            next = true;
        });
        await flush(); const own = h.mounted[0];
        const other = { handleInput() {} }; h.mounted.push(other);
        owner.cancel(); assert.deepEqual(await pending, { kind: "stale" });
        assert.deepEqual(h.removed, [own]); assert.equal(next, false);
        assert.equal(getEventListeners(signal, "abort").length, 0);
    }
});
it("installed SDK user cancellation is undefined for selection but false for confirmation", async () => {
    const h = hostContext(), owner = createDialogOwner();
    const selected = owner.run(h.ctx, { isCurrent: () => true }, flow => flow.select("Select", ["one"]));
    await flush(); h.mounted.at(-1)!.handleInput("\x1b"); assert.deepEqual(await selected, { kind: "cancelled" });
    const confirmed = owner.run(h.ctx, { isCurrent: () => true }, flow => flow.confirm("Confirm", "Message"));
    await flush(); h.mounted.at(-1)!.handleInput("\x1b"); assert.deepEqual(await confirmed, { kind: "completed", value: false });
});
