import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { TaskCoordinator } from "./coordinator.ts";
import type { TaskLifecycle } from "./lifecycle.ts";
import type { TaskUIConfig } from "./config.ts";
import { TaskPanel } from "./panel.ts";
import { TaskOverviewModel, overviewLines, overviewRootCount } from "./overview.ts";
import { createWidgetClient } from "../shared/widget-display/client.ts";
import { FINISHED_LINGER_MS, isTerminal, taskSummary, TaskPanelModel } from "./model.ts";
import { layoutError, loadNativeLayout, type NativeLayout } from "../shared/scroll-panel/native-layout.ts";

/** Exactly one footer/subscriber/overlay owner per activation, never a backend UI. */
export function createTaskUIOwner(pi: ExtensionAPI, coordinator: TaskCoordinator, lifecycle: TaskLifecycle, config: TaskUIConfig, options: { loadLayout?: () => Promise<NativeLayout> } = {}) {
    const widget = createWidgetClient(pi, "agent_overview");
    const overview = new TaskOverviewModel();
    let timer: NodeJS.Timeout | undefined;
    let epoch = 0;
    let updating = false, queued = false;
    let closed = false;
    let ctx: ExtensionContext | undefined;
    let offSource: (() => void) | undefined;
    let lastStatus: string | undefined;
    let statusKnown = false;
    type Interaction = { panel?: TaskPanel; close: () => void };
    let interaction: Interaction | undefined;
    let offStart: (() => void) | undefined;
    const active = () => !closed && lifecycle.active;
    const update = () => {
        if (!active() || !ctx || ctx.mode !== "tui") return;
        if (updating) {
            if (!queued) { queued = true; queueMicrotask(() => { queued = false; update(); }); }
            return;
        }
        updating = true;
        const origin = ctx, stamp = epoch;
        const live = () => active() && ctx === origin && stamp === epoch;
        try {
            const views = coordinator.list();
            if (!live()) return;
            const now = Date.now(), roots = overview.refresh(views, now);
            clearTimeout(timer); timer = undefined;
            // No empty/unchanging clock. Terminal expiry still runs after backend sweep.
            const expiry = roots.filter(isTerminal).map(view => Math.max(1, view.endedAt! + FINISHED_LINGER_MS - now));
            const delays = [...expiry, ...roots.flatMap(view => !isTerminal(view) && view.startedAt !== undefined ? [1000] : [])];
            const theme = origin.ui.theme;
            const summary = taskSummary(views, theme);
            const waiting = coordinator.waitCount ? theme.fg("warning", `waiting ${coordinator.waitCount}`) + theme.fg("dim", " · ") +
                theme.fg("accent", `${config.shortcutBackground.join("/") || "/task-detach"} Detach all waits`) : undefined;
            const text = [summary, waiting].filter(Boolean).join(theme.fg("dim", " · "));
            const status = text ? text + theme.fg("dim", " · ") + theme.fg("accent", config.shortcutTaskPanel[0] ?? "/tasks") : undefined;
            if (!statusKnown || status !== lastStatus) {
                lastStatus = status; statusKnown = true;
                try { origin.ui.setStatus("task-ui", status); } catch { statusKnown = false; /* independent optional footer */ }
            }
            if (!live()) return;
            let visibleActivity = false;
            const published = widget.set(origin, roots.length ? (tui) => {
                const rows = tui.terminal.rows || 24;
                visibleActivity = tui.terminal.columns > 0 && roots.slice(0, overviewRootCount(roots.length, rows))
                    .some(view => view.status === "starting" || view.status === "running");
                return {
                    render(width) { return live() ? overviewLines(roots, width, tui.terminal.rows || 24, origin.ui.theme, Date.now(),
                        config.animations === false ? undefined : Math.floor(Date.now() / 250)) : []; },
                    invalidate() {},
                };
            } : undefined);
            if (!live()) return;
            // One aligned clock for every visible root. Source updates do not reset the
            // animation phase or postpone its next tick; failed sinks keep only expiry.
            const nextDelays = published ? delays : expiry;
            if (published && visibleActivity && config.animations !== false) nextDelays.push(250 - now % 250);
            if (nextDelays.length) {
                timer = setTimeout(() => { timer = undefined; if (live()) update(); }, Math.min(...nextDelays));
                timer.unref();
            }
            // Both setters can synchronously reset/shut down; ownership was captured first.
        } finally { updating = false; }
    };
    const dispose = () => {
        if (closed) return;
        closed = true; epoch++;
        clearTimeout(timer); timer = undefined; overview.clear();
        try { widget.dispose(); } catch { /* optional display must not block footer/panel cleanup */ }
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
        epoch++; clearTimeout(timer); timer = undefined; overview.clear();
        ctx = fresh;
        lastStatus = undefined; statusKnown = false;
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
