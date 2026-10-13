import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

// Environment isolation must precede imports: both SDK and Pretty read config at load time.
export const agentDir = mkdtempSync(join(tmpdir(), "pretty-prototype-"));
process.env.PI_CODING_AGENT_DIR = agentDir;
process.env.PRETTY_CONFIG_DIR = agentDir;
process.env.PRETTY_DISABLE_TOOLS = "read,bash,find,grep,ls";
writeFileSync(join(agentDir, "pi-input-history.json"), JSON.stringify({ searchShortcut: "alt+r" }));
writeFileSync(join(agentDir, "pi-pretty.json"), JSON.stringify({
  workingIndicator: { text: ["PROTOTYPE-WORKING"], sessionAccent: false },
  thinkingIndicator: { enabled: false },
}));

const sdkUrl = import.meta.resolve("@earendil-works/pi-coding-agent");
const sdkRoot = resolve(dirname(fileURLToPath(sdkUrl)), "..");
const requireSdk = createRequire(sdkUrl);
const { createJiti } = requireSdk("jiti");
const jiti = createJiti(import.meta.url, {
  fsCache: false,
  alias: Object.fromEntries(["pi-coding-agent", "pi-tui", "pi-ai"].map((name) => [
    `@earendil-works/${name}`, fileURLToPath(import.meta.resolve(`@earendil-works/${name}`)),
  ])),
});
export const sdk = await import("@earendil-works/pi-coding-agent");
export const tuiSdk = await import("@earendil-works/pi-tui");
const { KeybindingsManager } = await import(join(sdkRoot, "dist/core/keybindings.js"));
const interactive = await import(join(sdkRoot, "dist/modes/interactive/interactive-mode.js"));
export const { StatusIndicator } = await import(join(sdkRoot, "dist/modes/interactive/components/status-indicator.js"));
export const themeSdk = await import(join(sdkRoot, "dist/modes/interactive/theme/theme.js"));
themeSdk.initTheme("dark", false);
export async function loadUnified() {
  return (await jiti.import(fileURLToPath(new URL("../../bash-unified.ts", import.meta.url)))).default;
}
export const pretty = (await jiti.import(fileURLToPath(import.meta.resolve("@heyhuynhgiabuu/pi-pretty/src/index.ts")))).default;
export const { createPromptEditorClass } = await jiti.import(fileURLToPath(import.meta.resolve("@heyhuynhgiabuu/pi-pretty/src/prompt-editor.ts")));
// History behavior is offline and independent of personal package installations.
export { default as inputHistory } from "./history-fixture.mjs";

// FFF indexing is outside this prototype; prevent native scanning via its shared service seam.
const fff = await jiti.import(fileURLToPath(import.meta.resolve("@heyhuynhgiabuu/pi-pretty/src/fff.ts")));
fff.getSharedFffService(undefined, agentDir).tryLoadModule = async () => false;
export function cleanup() { fff.resetSharedFffServiceForTests(); rmSync(agentDir, { recursive: true, force: true }); }

const terminal = {
  columns: 80, rows: 24, kittyProtocolActive: false,
  start() {}, stop() {}, async drainInput() {}, write() {}, moveBy() {}, hideCursor() {}, showCursor() {},
  clearLine() {}, clearFromCursor() {}, clearScreen() {}, setTitle() {}, setProgress() {}, setProgramStatus() {},
};

export function makeHost(name) {
  const cwd = join(agentDir, name);
  const sessionManager = sdk.SessionManager.create(cwd);
  const kb = new KeybindingsManager();
  tuiSdk.setKeybindings(kb);
  const tui = new tuiSdk.TuiMainScreen({ ...terminal });
  // Use real TUI focus/Editor machinery but never start a terminal or render loop.
  tui.requestRender = () => {};
  const defaultEditor = new sdk.CustomEditor(tui, themeSdk.getEditorTheme(), kb, { embedWorkingStatus: true });
  const provider = {
    async getSuggestions() { return { items: [{ value: "completed", label: "completed" }], prefix: "co" }; },
    applyCompletion() { return { lines: ["completed"], cursorLine: 0, cursorCol: 9 }; },
  };
  const counts = { change: 0, submit: [], escape: 0, exit: 0, paste: 0, model: 0, extension: 0 };
  defaultEditor.onSubmit = (text) => { counts.submit.push(text); defaultEditor.addToHistory(text); };
  defaultEditor.onChange = () => { counts.change++; };
  defaultEditor.onEscape = () => { counts.escape++; };
  defaultEditor.onCtrlD = () => { counts.exit++; };
  defaultEditor.onPasteImage = () => { counts.paste++; };
  defaultEditor.onExtensionShortcut = (data) => {
    if (data !== "\x1bx") return false;
    counts.extension++;
    return true;
  };
  defaultEditor.onAction("app.model.cycleForward", () => { counts.model++; });
  defaultEditor.setAutocompleteProvider(provider);
  const diagnostics = [];
  const host = {
    ui: tui, keybindings: kb, editor: defaultEditor, defaultEditor, autocompleteProvider: provider,
    editorContainer: new tuiSdk.Container(), statusContainer: new tuiSdk.Container(),
    session: { isStreaming: false, thinkingLevel: "off" }, options: { tuiMode: "regular" },
    activeWorkingIndicatorEmbedded: false,
    /** @type {InstanceType<typeof StatusIndicator> | undefined} */
    activeStatusIndicator: undefined,
    /** @type {{ frames?: string[], intervalMs?: number } | undefined} */
    workingIndicatorOptions: undefined,
    /** @type {string | undefined} */
    workingMessage: undefined,
    defaultWorkingMessage: "Working...", idleStatus: { invalidate() {}, render() { return []; } },
    clearExtensionTerminalInputListeners() {}, setExtensionFooter() {}, setExtensionHeader() {},
    clearExtensionWidgets() {}, footerDataProvider: { clearExtensionStatuses() {}, setExtensionStatus() {} }, footer: { invalidate() {} },
    autocompleteProviderWrappers: [],
    setupAutocompleteProvider() { host.editor.setAutocompleteProvider(provider); }, updateTerminalTitle() {},
    disposeActiveSelector() {}, showExtensionNotify(message) { diagnostics.push(message); },
    setToolsExpanded() {}, setExtensionStatus() {}, setExtensionWidget() {}, setHiddenThinkingLabel() {},
  };
  // These are the actual SDK methods, including text/callback/appearance/autocomplete/focus
  // wiring and embedded status ownership. No copied setter implementation.
  for (const key of ["setCustomEditorComponent", "setEditorWorkingStatusIndicator", "showStatusIndicator",
    "clearStatusIndicator", "showWorkingStatusIndicator", "setWorkingVisible", "setWorkingIndicator"]) {
    host[key] = interactive.InteractiveMode.prototype[key];
  }
  const ui = interactive.InteractiveMode.prototype.createExtensionUIContext.call(host);
  // Search fixture uses real SDK Input but never starts a terminal/overlay loop.
  let searchKeys = ["\r"];
  ui.custom = async (factory) => {
    let result;
    let completed = false;
    const component = factory(tui, themeSdk.theme, kb, (value) => { completed = true; result = value; });
    // Down's public TUI probe completes synchronously and is never mounted.
    if (completed) return result;
    assert.ok(component.render(60).join("\n").includes("reverse-search"));
    for (const key of searchKeys) component.handleInput(key);
    return result;
  };
  const ctx = { mode: "tui", cwd, ui, sessionManager, thinkingLevel: "off" };
  const handlers = new Map();
  const shortcuts = new Map();
  const tools = [];
  const bus = new Map();
  const pi = {
    events: {
      on(event, handler) {
        const listeners = bus.get(event) ?? new Set();
        listeners.add(handler); bus.set(event, listeners);
        return () => listeners.delete(handler);
      },
      emit(event, payload) { for (const handler of bus.get(event) ?? []) handler(payload); },
    },
    registerEntryRenderer() {},
    getAllTools() { return tools; },
    getActiveTools() { return tools.map((tool) => tool.name); },
    setActiveTools() {},
    setAutocompleteProvider() {},
    on(event, handler) { handlers.set(event, [...(handlers.get(event) ?? []), handler]); },
    registerCommand() {}, registerFlag() {}, registerMarkdownTransformer() {}, getFlag() {},
    registerMessageRenderer() {}, registerTool(tool) { tools.push(tool); }, registerShortcut(key, options) { shortcuts.set(key, options.handler); },
  };
  return {
    host, tui, kb, provider, counts, pi, ctx, shortcuts, diagnostics, tools,
    get editor() { return host.editor; },
    searchWith(...keys) { searchKeys = keys; },
    async fire(event) {
      if (event === "agent_start") host.session.isStreaming = true;
      if (event === "agent_end") host.session.isStreaming = false;
      for (const handler of handlers.get(event) ?? []) await handler({ type: event }, ctx);
    },
    seed(...texts) {
      const previous = sdk.SessionManager.create(cwd);
      for (const text of texts) previous.appendMessage({ role: "user", content: text, timestamp: Date.now() });
    },
    resetExtensionUI() {
      // Run the ACTUAL SDK reset, including factory, autocomplete, status and
      // shortcut reset, before old-runner shutdown (/reload and invalidation).
      interactive.InteractiveMode.prototype.resetExtensionUI.call(host);
    },
    resetEmptySession() {
      host.editor.setText("");
      host.defaultEditor.setText("");
      ctx.sessionManager = sdk.SessionManager.create(cwd);
    },
    replaceExtensionRuntime() {
      handlers.clear();
      shortcuts.clear();
    },
    dispose() { host.clearStatusIndicator(); tui.stop(); },
  };
}
