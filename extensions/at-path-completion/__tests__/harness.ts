import assert from "node:assert/strict";
import { CustomEditor, type ExtensionAPI, type ExtensionContext } from "@earendil-works/pi-coding-agent";
import { CombinedAutocompleteProvider, Container, TuiMainScreen, setKeybindings, type AutocompleteProvider, type EditorComponent } from "@earendil-works/pi-tui";
import { InteractiveMode, KeybindingsManager, themeSdk } from "../../task-ui/__tests__/editor-host.mjs";
import atPathCompletion from "../index.ts";
export const pause = (ms = 100) => new Promise<void>(resolve => setTimeout(resolve, ms));
export function harness() {
  const keys = new KeybindingsManager(); setKeybindings(keys);
  const tui = new TuiMainScreen({ columns: 80, rows: 24, kittyProtocolActive: false, start() {}, stop() {}, async drainInput() {}, write() {}, moveBy() {}, hideCursor() {}, showCursor() {}, clearLine() {}, clearFromCursor() {}, clearScreen() {}, setTitle() {}, setProgress() {}, setProgramStatus() {} });
  tui.requestRender = () => {};
  const original = new CustomEditor(tui, themeSdk.getEditorTheme(), keys);
  const counts = { submit: [] as string[], change: 0, shortcut: 0, escape: 0, raw: 0, query: [] as { prefix: string; force?: boolean; signal: AbortSignal }[], applyReceiver: true, queryReceiver: true };
  original.onSubmit = text => counts.submit.push(text);
  original.onChange = () => { counts.change++; };
  original.onEscape = () => { counts.escape++; };
  original.onExtensionShortcut = data => { if (data !== '\x1bx') return false; counts.shortcut++; return true; };
  const native = new CombinedAutocompleteProvider([], '/tmp', null);
  let suggest: AutocompleteProvider['getSuggestions'] = async (lines, line, col) => {
    const prefix = lines[line]!.slice(0, col);
    return { prefix, items: [{ value: prefix.endsWith('/') ? `${prefix}child/` : `${prefix}/`, label: 'directory/' }] };
  };
  const base: AutocompleteProvider = {
    triggerCharacters: ['#'],
    async getSuggestions(lines, line, col, options) {
      counts.queryReceiver &&= this === base;
      counts.query.push({ prefix: lines[line]!.slice(0, col), force: options.force, signal: options.signal });
      return suggest(lines, line, col, options);
    },
    applyCompletion(lines, line, col, item, prefix) { counts.applyReceiver &&= this === base; return native.applyCompletion(lines, line, col, item, prefix); },
    shouldTriggerFileCompletion() { assert.equal(this, base); return true; },
  };
  original.setAutocompleteProvider(base);
  const host = {
    ui: tui, editor: original as EditorComponent, defaultEditor: original, keybindings: keys,
    autocompleteProvider: base, autocompleteProviderWrappers: [] as ((current: AutocompleteProvider) => AutocompleteProvider)[],
    editorContainer: new Container(), statusContainer: new Container(), activeStatusIndicator: undefined,
    editorComponentFactory: undefined as NonNullable<Parameters<ExtensionContext['ui']['setEditorComponent']>[0]> | undefined,
    disposeActiveSelector() {}, setExtensionStatus() {}, showExtensionNotify() {},
    addExtensionTerminalInputListener() { counts.raw++; return () => {}; },
    createBaseAutocompleteProvider: () => base,
    setupAutocompleteProvider: InteractiveMode.prototype.setupAutocompleteProvider,
    showExtensionCustom: InteractiveMode.prototype.showExtensionCustom,
    setCustomEditorComponent: InteractiveMode.prototype.setCustomEditorComponent,
  };
  host.editorContainer.addChild(original); tui.setFocus(original);
  const ui = InteractiveMode.prototype.createExtensionUIContext.call(host);
  const ctx = { mode: 'tui', ui } as unknown as ExtensionContext;
  const events = new Map<string, Set<(event: unknown, ctx: ExtensionContext) => unknown>>();
  const bus = new Map<string, Set<(payload: unknown) => void>>();
  const pi = { events: {
    on(name: string, handler: (payload: unknown) => void) {
      const listeners = bus.get(name) ?? new Set(); listeners.add(handler); bus.set(name, listeners);
      return () => { listeners.delete(handler); };
    },
    emit(name: string, payload: unknown) { for (const handler of bus.get(name) ?? []) handler(payload); },
  }, on(name: string, fn: (event: unknown, ctx: ExtensionContext) => unknown) {
    const handlers = events.get(name) ?? new Set(); events.set(name, handlers); handlers.add(fn); return () => handlers.delete(fn);
  } } as unknown as ExtensionAPI;
  async function emit(name: string) { for (const fn of [...(events.get(name) ?? [])]) await fn({}, ctx); }
  return { keys, tui, host, ctx, pi, counts, base,
    get editor() { return host.editor as CustomEditor; },
    setSuggestions(fn: AutocompleteProvider['getSuggestions']) { suggest = fn; },
    install() { atPathCompletion(pi); }, start: () => emit('session_start'),
    dispatch(data: string) { (tui as unknown as { handleTerminalInput(data: string): void }).handleTerminalInput(data); },
    async close() { await emit('session_shutdown'); tui.stop(); },
  };
}
