import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { EditorComponent, TUI } from "@earendil-works/pi-tui";

/** Probe without mounting UI, then retry outside session_start's await chain.
 * Reload restores focus only AFTER all session_start handlers return. */
export async function installWhenEditorFocused(
    ctx: ExtensionContext,
    inactive: () => boolean,
    install: (screen: TUI, editor: unknown) => void,
    fail: (error: unknown) => void,
): Promise<() => void> {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const cancel = () => { cancelled = true; if (timer !== undefined) clearTimeout(timer); timer = undefined; };
    try {
        let screen: TUI | undefined;
        await ctx.ui.custom<void>((tui, _theme, _keys, done) => {
            screen = tui;
            done();
            return { render: () => [], invalidate() {} };
        }, { overlay: true });
        if (inactive()) return cancel;
        if (!screen || !("getFocusedComponent" in screen) || typeof screen.getFocusedComponent !== "function") {
            throw new Error("Editor installation requires public TUI.getFocusedComponent");
        }
        const focus = screen as TUI & { getFocusedComponent(): unknown };
        const attempt = () => {
            timer = undefined;
            if (cancelled || inactive()) return;
            try {
                const editor = focus.getFocusedComponent();
                // Containers/dialogs and overlays are temporary focus owners, not editors.
                // Once an editor is focused, each consumer performs its own capability preflight.
                if (focus.hasOverlay() || !editor || typeof editor !== "object" ||
                    typeof Reflect.get(editor, "getText") !== "function" || Reflect.get(editor, "focused") !== true) {
                    timer = setTimeout(attempt, 25);
                    return;
                }
                install(focus, editor);
            } catch (error) { cancel(); fail(error); }
        };
        attempt();
    } catch (error) { cancel(); fail(error); }
    return cancel;
}

export type LiveEditor = EditorComponent & { focused: boolean; isShowingAutocomplete(): boolean };

/** Restore only a descriptor still owned by this lease, including inherited methods. */
export function interpose(target: object, key: PropertyKey, descriptor: PropertyDescriptor): () => void {
    const previous = Object.getOwnPropertyDescriptor(target, key);
    let owner: object | null = target;
    while (owner) {
        const existing = Object.getOwnPropertyDescriptor(owner, key);
        if (existing) {
            if (!("value" in existing) || (owner === target && existing.configurable !== true)) {
                throw new Error(`Editor handoff cannot safely shadow ${String(key)}`);
            }
            break;
        }
        owner = Object.getPrototypeOf(owner) as object | null;
    }
    const replacement = { configurable: true, enumerable: previous?.enumerable ?? false, ...descriptor };
    try { Object.defineProperty(target, key, replacement); }
    catch (error) {
        // A proxy can define the property and then throw. Roll back this transaction.
        const current = Object.getOwnPropertyDescriptor(target, key);
        if (current?.value === replacement.value && current?.get === replacement.get && current?.set === replacement.set &&
            current?.configurable === replacement.configurable && current?.enumerable === replacement.enumerable &&
            current?.writable === replacement.writable) {
            if (previous) Object.defineProperty(target, key, previous); else Reflect.deleteProperty(target, key);
        }
        throw error;
    }
    return () => {
        const current = Object.getOwnPropertyDescriptor(target, key);
        if (current?.value !== descriptor.value || current?.get !== descriptor.get || current?.set !== descriptor.set ||
            current?.configurable !== replacement.configurable || current?.enumerable !== replacement.enumerable ||
            ("value" in descriptor && current?.writable !== (descriptor.writable ?? false))) return;
        if (previous) Object.defineProperty(target, key, previous); else Reflect.deleteProperty(target, key);
    };
}

/** The host setter redundantly rewires even the SAME live instance, using displayed
 * or expanded text. Shield only that synchronous handoff: setText otherwise destroys
 * history draft, cursor, pastes and completion.
 * All properties here are public EditorComponent/CustomEditor API, not editing internals. */
export function preserveHandoff(editor: LiveEditor): () => void {
    const restores: (() => void)[] = [];
    try {
        const setText = editor.setText;
        restores.push(interpose(editor, "setText", { writable: true, value: function (this: LiveEditor, text: string) {
            if (text !== this.getText() && (typeof this.getExpandedText !== "function" || text !== this.getExpandedText())) {
                setText.call(this, text);
            }
        } }));
        for (const key of ["setAutocompleteProvider", "setPaddingX", "setAutocompleteMaxVisible"] as const) {
            if (typeof editor[key] === "function") restores.push(interpose(editor, key, { writable: true, value: () => {} }));
        }
        for (const key of ["onSubmit", "onChange", "borderColor"] as const) {
            const value = editor[key];
            restores.push(interpose(editor, key, { get: () => value, set: () => {} }));
        }
        // actionHandlers is a PUBLIC CustomEditor Map. Give the host an empty temporary
        // wiring sink so its default handlers cannot overwrite custom onAction registrations.
        if ("actionHandlers" in editor && editor.actionHandlers instanceof Map) {
            restores.push(interpose(editor, "actionHandlers", { writable: true, value: new Map() }));
            for (const key of ["onEscape", "onCtrlD", "onPasteImage", "onExtensionShortcut"] as const) {
                const value = Reflect.get(editor, key);
                restores.push(interpose(editor, key, { get: () => value, set: () => {} }));
            }
        }
    } catch (error) { for (const restore of restores.reverse()) restore(); throw error; }
    return () => { for (const restore of restores.reverse()) restore(); };
}
