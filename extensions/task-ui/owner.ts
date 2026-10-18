import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { TaskCoordinator } from "./coordinator.ts";
import type { TaskLifecycle } from "./lifecycle.ts";
import type { TaskUIConfig } from "./config.ts";
import { TaskPanel } from "./panel.ts";
import { taskSummary, TaskPanelModel } from "./model.ts";
import { layoutError, loadNativeLayout, type NativeLayout } from "../shared/scroll-panel/native-layout.ts";

/** Exactly one footer/subscriber/overlay owner per activation, never a backend UI. */
export function createTaskUIOwner(pi: ExtensionAPI, coordinator: TaskCoordinator, lifecycle: TaskLifecycle, config: TaskUIConfig, options: { loadLayout?: () => Promise<NativeLayout> } = {}) {
    let closed = !lifecycle.active;
    let ctx: ExtensionContext | undefined;
    let offSource: (() => void) | undefined;
    let lastStatus: string | undefined;
    type Interaction = { panel?: TaskPanel; close: () => void };
    let interaction: Interaction | undefined;
    let offStart: (() => void) | undefined;
    const active = () => !closed && lifecycle.active;
    const update = () => {
        if (!active() || !ctx || ctx.mode !== "tui") return;
        const theme = ctx.ui.theme;
        const summary = taskSummary(coordinator.list(), theme);
        const text = summary ? summary + theme.fg("dim", " · ") + theme.fg("accent", config.shortcutTaskPanel[0] ?? "/tasks") : undefined;
        if (text === lastStatus) return;
        lastStatus = text;
        const origin = ctx;
        origin.ui.setStatus("task-ui", text);
        // setStatus can synchronously close this owner. Never register afterward.
    };
    const dispose = () => {
        if (closed) return;
        closed = true;
        const origin = ctx, current = interaction;
        ctx = undefined; interaction = undefined;
        try { offSource?.(); } catch { /* isolate cleanup owners */ } offSource = undefined;
        try { offStart?.(); } catch { /* isolate cleanup owners */ } offStart = undefined;
        try { current?.panel?.dispose(); } catch { /* completion still closes overlay */ }
        try { current?.close(); } catch { /* footer cleanup still runs */ }
        try { origin?.ui.setStatus("task-ui", undefined); } catch { /* cleanup survives optional host errors */ }
    };
    const offClose = lifecycle.onClose(dispose);
    offStart = pi.on("session_start", (_event, fresh) => {
        if (!active()) return;
        ctx = fresh;
        lastStatus = undefined;
        // Capture subscription ownership before calling external setters.
        if (!offSource) offSource = coordinator.subscribe(update);
        update();
    });
    if (!active()) offStart?.();
    return {
        canOpen(): boolean {
            if (!active() || interaction) return false;
            // Use a fresh model: selected detail pinning belongs only to an open interaction.
            const model = new TaskPanelModel();
            try { return model.refresh(coordinator.list()).length > 0; } finally { model.dispose(); }
        },
        async openPanel(origin: ExtensionContext): Promise<void> {
            if (!active() || interaction) return;
            if (origin.mode !== "tui" || !origin.ui.custom) {
                origin.ui.notify("Task Panel requires interactive TUI mode; use process_manage or agent_manage for details.", "info"); return;
            }
            let installed = false, closeRequested = false, completed = false;
            let done: (() => void) | undefined;
            const finish = () => {
                if (!installed || !done || completed) return;
                completed = true;
                current.panel?.dispose();
                done();
            };
            const current: Interaction = { close() { closeRequested = true; finish(); } };
            interaction = current; // Publish BEFORE layout/custom can reenter shutdown.
            const live = () => active() && interaction === current && !closeRequested && !completed;
            try {
                let layout: NativeLayout;
                try { layout = await (options.loadLayout ?? loadNativeLayout)(); }
                catch (cause) { if (live()) origin.ui.notify(layoutError(cause, "Task Panel").message, "error"); return; }
                if (!live()) return;
                await origin.ui.custom<void>((tui, _theme, keys, complete) => {
                    done = () => complete();
                    const panel = new TaskPanel({ coordinator, config, layout, ctx: origin, tui, theme: () => origin.ui.theme, keys, done: current.close });
                    current.panel = panel;
                    if (!live()) { panel.dispose(); current.close(); }
                    return panel;
                }, { overlay: true, overlayOptions: { anchor: "top-left", width: "100%", maxHeight: "100%", margin: 0 }, onHandle: () => {
                    // Wait for our handle: setup cancellation must not close an
                    // unrelated overlay on hosts with pre-install completion semantics.
                    installed = true;
                    if (!live()) closeRequested = true;
                    if (closeRequested) finish();
                } });
            } finally {
                completed = true;
                current.panel?.dispose();
                if (interaction === current) interaction = undefined;
            }
        },
        dispose() { dispose(); offStart?.(); offClose(); },
    };
}
