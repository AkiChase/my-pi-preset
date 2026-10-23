import { runOverlay } from "../shared/interaction/overlay.ts";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { layoutError, loadNativeLayout } from "../shared/scroll-panel/native-layout.ts";
import type { NativeLayout } from "../shared/scroll-panel/native-layout.ts";
import { readEnabled, setEnabled } from "./config.ts";
import { PublishedError } from "./paths.ts";
import { MemoryError, fail } from "./policy.ts";
import { MemoryPanel } from "./panel.ts";
import type { DetailResult, PanelAction, PanelSnapshot } from "./panel.ts";
import { commandDiagnostic, displayText, readDetail } from "./preview.ts";
import type { MemoryStore } from "./store.ts";

export interface CommandOrigin { agentDir: string; store?: MemoryStore; diagnostic?: string; assertActive: () => void }
export interface MemoryCommandOptions {
  /** Native bounded layout provider; injectable so tests never depend on the host internals. */
  loadLayout?: () => Promise<NativeLayout>;
}
const HELP = "Memory: /memory opens the read-only project browser in TUI; /memory list [query], /memory on, /memory off, /memory help. Disabled memory remains readable; existing conversation context is not revoked.";

/**
 * Activation-owned command. The browser is read-only: no editor/input/select/confirm dialogs,
 * no store mutation, index publication or model call. Only `/memory on|off` writes configuration.
 */
export function registerMemoryCommand(pi: ExtensionAPI, getOrigin: (cwd: string) => CommandOrigin, options: MemoryCommandOptions = {}): { close: () => void } {
  const loadLayout = options.loadLayout ?? loadNativeLayout;
  let operation: object | undefined;
  let closePanel: (() => void) | undefined;
  function close(): void {
    operation = undefined;
    const closeOwned = closePanel; closePanel = undefined;
    closeOwned?.();
  }
  pi.registerCommand("memory", {
    description: "Browse project memory (read-only); list [query], on, off, help",
    handler: async (args, ctx) => {
      if (operation) { ctx.ui.notify("Memory interaction already open.", "warning"); return; }
      const token = {}; operation = token;
      const cwd = ctx.cwd;
      let origin: CommandOrigin | undefined;
      const check = () => { if (operation !== token || ctx.cwd !== cwd) fail("closed", "Memory interaction is closed."); origin!.assertActive(); };
      const notify = (message: string, type: "info" | "warning" | "error" = "info") => { check(); ctx.ui.notify(displayText(message), type); check(); };
      try {
        origin = getOrigin(ctx.cwd); check();
        const text = args.trim();
        if (text === "help") { notify(HELP); return; }
        if (text === "on" || text === "off") {
          const notice = await toggle(origin, text === "on", check); check(); notify(notice, "warning"); return;
        }
        if (text === "list" || text.startsWith("list ")) {
          if (!origin.store) { notify(origin.diagnostic ?? "Memory project unavailable.", "error"); return; }
          const page = origin.store.list(text.slice(4).trim()); check(); notify(page.text); return;
        }
        if (text) { notify(HELP, "warning"); return; }
        if (ctx.mode !== "tui") {
          const snapshot = loadSnapshot(origin, check);
          notify(`Memory · ${snapshot.project} · ${snapshot.enabled === undefined ? "Unknown" : snapshot.enabled ? "Enabled" : "Disabled"} · ${snapshot.entries.length} memories · ${snapshot.scannedBytes} metadata bytes\n${snapshot.diagnostic ?? ""}\n${HELP}`); return;
        }
        let layout: NativeLayout;
        // Incompatible hosts refuse to open: no manual slicing or custom scrollbar fallback.
        try { layout = await loadLayout(); } catch (error) { check(); notify(layoutError(error, "Memory").message, "error"); return; }
        check();
        const owner = origin;
        const snapshot = loadSnapshot(owner, check);
        let panel: MemoryPanel | undefined;
        let ended = false;
        let detailSeq = 0;
        let refreshSeq = 0;
        const controller = new AbortController();
        const closeInteraction = () => controller.abort();
        const current = () => { try { check(); return true; } catch { return false; } };
        let interactionSignal: AbortSignal | undefined;
        const live = () => !ended && !controller.signal.aborted && !interactionSignal?.aborted && current();
        // Reads run after the input callback returns: render/handleInput never perform I/O.
        const later = (task: () => void) => { void Promise.resolve().then(() => { if (live()) task(); }).catch(() => {}); };
        const onAction = (action: PanelAction) => {
          if (action.kind === "close") { cancelPanel?.(); return; }
          if (!live()) return;
          if (action.kind === "back") { detailSeq++; return; }
          if (action.kind === "detail") {
            const seq = ++detailSeq;
            later(() => { const result = loadDetail(owner, action.name); if (seq === detailSeq && live()) panel?.showDetail(result); });
            return;
          }
          const seq = ++refreshSeq;
          const detailName = action.detail;
          later(() => {
            const next = loadSnapshot(owner, check);
            const result = detailName ? loadDetail(owner, detailName) : undefined;
            if (seq === refreshSeq && live()) panel?.update(next, result, "Reloaded from disk (read-only).");
          });
        };
        let cancelPanel: (() => void) | undefined;
        if (operation === token) closePanel = closeInteraction;
        const result = await runOverlay<void>(ctx, {
          signal: controller.signal,
          isCurrent: current,
          overlayOptions: { width: "100%", maxHeight: "100%", anchor: "top-left", margin: 0 },
          create(tui, theme, _keys, interaction) {
            interactionSignal = interaction.signal;
            cancelPanel = interaction.cancel;
            panel = new MemoryPanel({ snapshot, theme, tui, layout, onAction, unavailable: error => { if (live()) { try { ctx.ui.notify(error.message, "error"); } catch { /* host may be closing */ } } } });
            return panel;
          },
        });
        ended = true;
        if (result.kind === "error") throw result.error;
        if (operation === token) closePanel = undefined;
      } catch (error) {
        if (operation === token) {
          try {
            if (ctx.cwd !== cwd) return;
            origin?.assertActive();
            ctx.ui.notify(commandDiagnostic(error), "error");
          } catch { /* Retired callbacks cannot publish to another session. */ }
        }
      } finally { if (operation === token) { operation = undefined; closePanel = undefined; } }
    },
  });
  return { close };
}

/** Read-only bounded metadata scan; never refreshes or publishes MEMORY.md. */
export function loadSnapshot(origin: CommandOrigin, check: () => void): PanelSnapshot {
  check();
  const snapshot: PanelSnapshot = { project: origin.store?.project.name ?? "Current project", entries: [], scannedBytes: 0 };
  try { snapshot.enabled = readEnabled(origin.agentDir); } catch (error) { snapshot.diagnostic = commandDiagnostic(error); }
  if (!origin.store) { snapshot.diagnostic = origin.diagnostic ?? "Memory project unavailable."; return snapshot; }
  try { const scan = origin.store.scan(); snapshot.entries = scan.entries; snapshot.scannedBytes = scan.scannedBytes; }
  catch (error) { snapshot.diagnostic = commandDiagnostic(error); }
  check(); return snapshot;
}
/** Bounded detail read; a missing topic is distinguished from corrupt or unreadable data. */
export function loadDetail(origin: CommandOrigin, name: string): DetailResult {
  if (!origin.store) return { name, error: origin.diagnostic ?? "Memory project unavailable." };
  try { return { name, detail: readDetail(origin.store, name) }; }
  catch (error) {
    const missing = (error instanceof MemoryError && error.code === "missing") ||
      (typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT");
    return { name, error: commandDiagnostic(error), ...(missing ? { missing: true } : {}) };
  }
}
async function toggle(origin: CommandOrigin, enabled: boolean, check: () => void): Promise<string> {
  check();
  try { await setEnabled(origin.agentDir, enabled, check); check(); }
  catch (error) {
    check();
    if (!(error instanceof PublishedError)) throw error;
    const actual = readEnabled(origin.agentDir); check();
    return `Memory is ${actual ? "Enabled" : "Disabled"} on disk, but durability confirmation failed. Existing conversation context is not revoked.`;
  }
  return `Memory ${enabled ? "Enabled" : "Disabled"}. Existing conversation context is not revoked.`;
}
