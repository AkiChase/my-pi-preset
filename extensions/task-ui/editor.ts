import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { CustomEditor } from "@earendil-works/pi-coding-agent";
import { isKeyRelease, isKeyRepeat, matchesKey, type EditorComponent, type TUI } from "@earendil-works/pi-tui";
import type { TaskLifecycle } from "./lifecycle.ts";
import { interpose, preserveHandoff, type LiveEditor } from "../editor-handoff/index.ts";

type EditorFactory = NonNullable<Parameters<ExtensionContext["ui"]["setEditorComponent"]>[0]>;
type FocusScreen = TUI & { getFocusedComponent(): unknown };
export interface DownPanelAccess { canOpen(): boolean; openPanel(ctx: ExtensionContext): Promise<void> }
interface Resources { ctx: ExtensionContext; panel: DownPanelAccess; leases: Set<() => void>; editors: WeakSet<EditorComponent> }
interface Cell { resources?: Resources }

function liveEditor(component: unknown): component is LiveEditor {
    if (!component || typeof component !== "object") return false;
    const candidate = component as Partial<LiveEditor>;
    return typeof candidate.handleInput === "function" && typeof candidate.getText === "function" &&
        typeof candidate.setText === "function" && typeof candidate.isShowingAutocomplete === "function" &&
        typeof candidate.focused === "boolean";
}

// A retained opaque plugin wrapper keeps only the original input function and an empty cell
// after close. It must not capture the activation's ctx/coordinator/TUI through an outer scope.
function inputForwarder(cell: Cell, screen: FocusScreen | undefined, target: LiveEditor | undefined, original: LiveEditor["handleInput"]) {
    const handleInput = function (this: LiveEditor, data: string): void {
        const resources = cell.resources;
        if (resources && screen && this === target && !isKeyRelease(data) && !isKeyRepeat(data) && matchesKey(data, "down") &&
            this.getText() === "" && this.focused && screen.getFocusedComponent() === this &&
            !screen.hasOverlay() && !this.isShowingAutocomplete() && resources.panel.canOpen()) {
            void resources.panel.openPanel(resources.ctx).catch(error => console.error("[task-ui] Down panel:", error));
            return;
        }
        original.call(this, data);
    };
    return { handleInput, release: () => { screen = undefined; target = undefined; } };
}

function decorate(cell: Cell, tui: TUI, editor: EditorComponent): EditorComponent {
    const resources = cell.resources;
    const screen = ("getFocusedComponent" in tui && typeof tui.getFocusedComponent === "function") ? tui as FocusScreen : undefined;
    if (!resources || !liveEditor(editor) || resources.editors.has(editor) || !screen) return editor;
    const forwarder = inputForwarder(cell, screen, editor, editor.handleInput);
    const restore = interpose(editor, "handleInput", { writable: true, value: forwarder.handleInput });
    const release = () => {
        forwarder.release();
        try { restore(); } finally { resources.leases.delete(release); }
    };
    resources.editors.add(editor);
    resources.leases.add(release);
    return editor;
}

type Handoff = { initial: boolean; editor?: LiveEditor; restore?: () => void };
function factoryLease(cell: Cell, previous: EditorFactory | undefined, transaction: Handoff): EditorFactory {
    return (tui, theme, keys) => {
        if (transaction.initial && transaction.editor && cell.resources) {
            transaction.initial = false;
            const editor = transaction.editor;
            transaction.editor = undefined;
            return editor;
        }
        // Retired factories remain resource-free delegates. Never restore via the host setter:
        // it would reconstruct the predecessor and discard live undo/history state on shutdown.
        const editor = previous ? previous(tui, theme, keys) : new CustomEditor(tui, theme, keys);
        return decorate(cell, tui, editor);
    };
}

/** Independent live-instance decoration; safe before or after appearance installation. */
export function registerDownOpener(pi: ExtensionAPI, lifecycle: TaskLifecycle, enabled: boolean, panel: DownPanelAccess): () => void {
    if (!enabled || !lifecycle.active) return () => {};
    const cell: Cell = {};
    let installed = false, closed = false;
    let offStart: (() => void) | undefined;
    let access: DownPanelAccess | undefined = panel;
    const close = () => {
        if (closed) return;
        closed = true;
        const resources = cell.resources;
        cell.resources = undefined; access = undefined;
        offStart?.(); offStart = undefined;
        for (const release of [...(resources?.leases ?? [])]) {
            try { release(); } catch (error) { console.error("[task-ui] editor lease cleanup:", error); }
        }
    };
    const offClose = lifecycle.onClose(close);
    offStart = pi.on("session_start", async (_event, ctx) => {
        if (closed || !lifecycle.active || installed || ctx.mode !== "tui" || !access) return;
        if (typeof ctx.ui.getEditorComponent !== "function" || typeof ctx.ui.setEditorComponent !== "function" || typeof ctx.ui.custom !== "function") return;
        installed = true;
        const transaction: Handoff = { initial: true };
        try {
            let screen: TUI | undefined;
            // Capture the public TUI before the destructive editor setter. Complete
            // synchronously so the SDK never mounts this probe. If another overlay
            // is already present, reject without done(): done would hide that overlay.
            await ctx.ui.custom<void>((tui, _theme, _keys, done) => {
                if (tui.hasOverlay()) throw new Error("Down opener installation deferred by an active overlay");
                screen = tui;
                done();
                return { render: () => [], invalidate() {} };
            }, { overlay: true });
            if (closed || !lifecycle.active || !screen || !access) return;
            if (!("getFocusedComponent" in screen) || typeof screen.getFocusedComponent !== "function") throw new Error("Down opener requires public TUI.getFocusedComponent");
            const editor = screen.getFocusedComponent();
            if (!liveEditor(editor) || !editor.focused || screen.hasOverlay()) throw new Error("Down opener needs the focused live editor during installation");
            const previous = ctx.ui.getEditorComponent();
            if (closed || !lifecycle.active) return;
            // All potentially failing descriptor work occurs while the old editor
            // is still mounted; unsupported editors therefore need no UI rollback.
            transaction.restore = preserveHandoff(editor);
            cell.resources = { ctx, panel: access, leases: new Set(), editors: new WeakSet() };
            transaction.editor = decorate(cell, screen, editor) as LiveEditor;
            const factory = factoryLease(cell, previous, transaction);
            ctx.ui.setEditorComponent(factory);
        } catch (error) {
            close();
            console.error("[task-ui] Down opener installation failed:", error);
        } finally { transaction.restore?.(); transaction.restore = undefined; transaction.editor = undefined; }
    });
    if (closed) offStart?.();
    return () => { close(); offClose(); };
}
