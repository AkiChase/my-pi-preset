import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { TaskCoordinator } from "./coordinator.ts";
import type { TaskLifecycle } from "./lifecycle.ts";
import type { TaskUIConfig } from "./config.ts";
import { TaskPanel } from "./panel.ts";
import { taskSummary, TaskPanelModel } from "./model.ts";

/** Exactly one footer/subscriber/overlay owner per activation, never a backend UI. */
export function createTaskUIOwner(pi: ExtensionAPI, coordinator: TaskCoordinator, lifecycle: TaskLifecycle, config: TaskUIConfig) {
    let closed = !lifecycle.active;
    let ctx: ExtensionContext | undefined;
    let offSource: (() => void) | undefined;
    let lastStatus: string | undefined;
    type Interaction = { panel?: TaskPanel; done?: () => void };
    let interaction: Interaction | undefined;
    let offStart: (() => void) | undefined;
    const active = () => !closed && lifecycle.active;
    const update = () => {
        if (!active() || !ctx || ctx.mode !== "tui") return;
        const summary = taskSummary(coordinator.list());
        const text = summary ? `${summary} · ${config.shortcutTaskPanel[0] ?? "/tasks"}` : undefined;
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
        try { current?.done?.(); } catch { /* footer cleanup still runs */ }
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
                origin.ui.notify("Task Panel requires interactive TUI mode; use jobs/get_subagent_result for details.", "info"); return;
            }
            const current: Interaction = {};
            interaction = current; // Publish owner BEFORE custom can reenter shutdown.
            try {
                await origin.ui.custom<void>((tui, theme, keys, done) => {
                    let completed = false;
                    const finish = () => { if (!completed) { completed = true; done(); } };
                    current.done = finish;
                    const panel = new TaskPanel({ coordinator, config, ctx: origin, tui, theme, keys, done: finish });
                    current.panel = panel;
                    if (!active() || interaction !== current) { panel.dispose(); finish(); }
                    return panel;
                }, { overlay: true, overlayOptions: { anchor: "center", width: "90%", maxHeight: "70%" } });
            } finally {
                current.panel?.dispose();
                if (interaction === current) interaction = undefined;
            }
        },
        dispose() { dispose(); offStart?.(); offClose(); },
    };
}
