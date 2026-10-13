import type { EditorComponent } from "@earendil-works/pi-tui";
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

/** Pi 1.1's setter redundantly rewires even the SAME live instance. Shield only that
 * synchronous handoff: setText otherwise destroys history draft, cursor, pastes and completion.
 * All properties here are public EditorComponent/CustomEditor API, not editing internals. */
export function preserveHandoff(editor: LiveEditor): () => void {
    const restores: (() => void)[] = [];
    try {
        const setText = editor.setText;
        restores.push(interpose(editor, "setText", { writable: true, value: function (this: LiveEditor, text: string) {
            if (text !== this.getText()) setText.call(this, text);
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
