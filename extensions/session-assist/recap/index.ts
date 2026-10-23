import { createDialogOwner } from "../../shared/interaction/dialog.ts";
import { createWidgetClient } from "../../shared/widget-display/client.ts";
import { performance } from "node:perf_hooks";
import { getAgentDir, type ExtensionAPI, type ExtensionCommandContext, type ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import { failureDetail } from "../shared/errors.ts";
import { generateText, RequestCancelled } from "../shared/request.ts";
import { getSupportedThinkingLevels } from "@earendil-works/pi-ai";
import { DEFAULTS, loadConfig, parseConfig, resolveModel, saveConfig, type ConfigState, type RecapConfig } from "./config.ts";
import { buildMaterial, type Material } from "../shared/material.ts";
import { cleanText, OUTPUT_LIMIT, readRecap, RECAP_PROMPT } from "./output.ts";

export const STATE_TYPE = "preset.recap.v1";
interface Stored { version: 1; text: string; material: string }
interface Publication { token: number; ctx: ExtensionContext; value: Stored; valid: () => boolean }
interface Window { token: number; since: number; attempted: boolean; material: string; restore: boolean }
export interface RecapClock { now(): number; set(callback: () => void, delay: number): unknown; clear(timer: unknown): void }
export interface RecapDependencies { clock?: RecapClock; directory?: () => string }
const systemClock: RecapClock = { now: () => performance.now(), set: (callback, delay) => setTimeout(callback, delay),
    clear: timer => clearTimeout(timer as ReturnType<typeof setTimeout>) };

/** All state belongs to this factory activation, never the imported module. */
export default function registerRecap(pi: ExtensionAPI, dependencies: RecapDependencies = {}): void {
    const widget = createWidgetClient(pi, "recap");
    const clock = dependencies.clock ?? systemClock;
    const directory = dependencies.directory ?? getAgentDir;
    let active = false;
    let closed = false;
    let context: ExtensionContext | undefined;
    let sessionId: string | undefined;
    let epoch = 0;
    let activity = 0;
    let lastActivityAt = clock.now();
    let running = false;
    let paused = false;
    let compacting = false;
    let compactPrevious: Window | undefined;
    let compactAdmitted = false;
    const tools = new Set<string>();
    let config: ConfigState = { config: { ...DEFAULTS }, issues: [] };
    let window: Window | undefined;
    let windowToken = 0;
    let timer: unknown;
    let request: AbortController | undefined;
    const configuration = createDialogOwner();
    let commandVersion = 0;
    let manualPending: number | undefined;
    let manualWait: AbortController | undefined;
    let widgetPublication: Publication | undefined;
    let publicationToken = 0;
    const unconfirmed = new WeakMap<ExtensionContext["sessionManager"], Set<string>>();
    let saved: Stored | undefined;

    function owns(ctx: ExtensionContext): boolean { return active && !closed && ctx.sessionManager.getSessionId() === sessionId && context?.sessionManager === ctx.sessionManager; }
    function clearTimer(): void { if (timer !== undefined) { clock.clear(timer); timer = undefined; } }
    function currentPublication(): Publication | undefined { return widgetPublication; }
    function hide(): void {
        const previous = widgetPublication;
        widgetPublication = undefined;
        if (previous) {
            try { widget.set(previous.ctx, undefined); } catch { /* Retired UI sinks cannot block cleanup. */ }
            const newer = currentPublication();
            if (newer && newer.token > previous.token && newer.valid()) publish(newer);
        }
    }
    function cancelRequest(): void { const old = request; request = undefined; old?.abort(); }
    function invalidate(): void { epoch++; clearTimer(); cancelRequest(); hide(); }
    function closeDialog(): void {
        commandVersion++; manualPending = undefined;
        const waiting = manualWait; manualWait = undefined; waiting?.abort();
        configuration.cancel();
    }
    async function waitForIdle(ctx: ExtensionCommandContext, controller: AbortController): Promise<boolean> {
        if (controller.signal.aborted) return false;
        let release = () => {};
        const cancelled = new Promise<false>(resolve => { release = () => resolve(false); });
        controller.signal.addEventListener("abort", release, { once: true });
        try {
            // The host wait is not cancellable. Race releases our continuation and handles its late rejection.
            const hostWait = Promise.resolve(ctx.waitForIdle()).then(() => true);
            return await Promise.race([hostWait, cancelled]);
        } finally { controller.signal.removeEventListener("abort", release); }
    }
    function display(value: unknown, limit = 160): string {
        const text = cleanText(String(value)).replace(/\u061c/g, "");
        const points = Array.from(text);
        return points.length > limit ? `${points.slice(0, limit - 1).join("")}…` : text;
    }
    function observe(ctx: ExtensionContext): void {
        if (!owns(ctx)) return;
        context = ctx;
        lastActivityAt = clock.now(); activity++;
        invalidate();
        window = undefined;
    }
    function pause(ctx: ExtensionContext): void {
        if (!owns(ctx)) return;
        observe(ctx); paused = true; closeDialog();
    }
    function notify(ctx: ExtensionContext, text: string, severity: "info" | "warning" | "error"): void {
        if (!owns(ctx)) return;
        // Print/JSON notify is a public no-op: do not describe it as visible delivery.
        try { ctx.ui.notify(text, severity); } catch { /* Delivery failure must not mutate persisted state. */ }
    }
    function material(ctx: ExtensionContext, budget = config.config.maxContextChars): Material { return buildMaterial(ctx.sessionManager, budget); }
    function stored(ctx: ExtensionContext): Stored | undefined {
        const latest = unconfirmed.get(ctx.sessionManager);
        for (const entry of ctx.sessionManager.getBranch().toReversed()) {
            if (entry.type !== "custom" || entry.customType !== STATE_TYPE || latest?.has(entry.id) || !entry.data || typeof entry.data !== "object") continue;
            const value = entry.data as Partial<Stored>;
            if (value.version === 1 && typeof value.text === "string" && value.text === cleanText(value.text) && value.text.length > 0 &&
                Array.from(value.text).length <= OUTPUT_LIMIT && typeof value.material === "string" && /^[a-f0-9]{64}$/.test(value.material)) return value as Stored;
        }
        return undefined;
    }
    function publish(publication: Publication): void {
        const { ctx, value } = publication;
        try {
            const accepted = widget.set(ctx, (_tui, theme) => {
                if (!publication.valid()) {
                    if (widgetPublication === publication) hide();
                    return new Text("", 0, 0);
                }
                return new Text(theme.fg("muted", `Recap: ${value.text}`), 0, 0);
            });
            if (!accepted && widgetPublication === publication) widgetPublication = undefined;
        }
        catch { if (widgetPublication === publication) widgetPublication = undefined; }
        if (widgetPublication === publication && publication.valid()) return;
        const newer = widgetPublication;
        if (newer && newer.token > publication.token && newer.valid()) {
            // An outer setter can publish after a nested setter. Restore the newer owner, never remove it.
            publish(newer);
        } else {
            // hide() may already have cleared ownership before this setter's late installation.
            if (widgetPublication === publication || (newer === widgetPublication && newer && !newer.valid())) widgetPublication = undefined;
            try { widget.set(ctx, undefined); } catch { /* Best-effort rollback of our publication only. */ }
            const replacement = currentPublication();
            if (replacement && replacement.token > publication.token && replacement.valid()) publish(replacement);
        }
    }
    function show(ctx: ExtensionContext, value: Stored, valid: () => boolean): void {
        const version = epoch;
        const activityVersion = activity;
        const admitted = () => owns(ctx) && epoch === version && activity === activityVersion && valid();
        if (!admitted() || ctx.mode !== "tui" || !ctx.hasUI) return;
        const publication: Publication = { token: ++publicationToken, ctx, value,
            // Published state outlives its completed request, but not activity or context changes.
            valid: () => owns(ctx) && epoch === version && activity === activityVersion && idle(ctx) && material(ctx).identity === value.material };
        widgetPublication = publication;
        publish(publication);
    }
    function idle(ctx: ExtensionContext): boolean { return owns(ctx) && !running && !compacting && !tools.size && ctx.isIdle() && !ctx.hasPendingMessages(); }
    function establish(ctx: ExtensionContext, identity: string, restore = false): void {
        window = { token: ++windowToken, since: lastActivityAt, attempted: false, material: identity, restore };
        schedule(ctx);
    }
    function schedule(ctx: ExtensionContext): void {
        clearTimer();
        const current = window;
        if (!owns(ctx) || !current || current.attempted || paused || !config.config.automatic || manualPending !== undefined || request) return;
        const wait = current.restore ? 0 : Math.max(0, current.since + config.config.idleMinutes * 60_000 - clock.now());
        const token = current.token;
        timer = clock.set(() => {
            timer = undefined;
            if (!owns(ctx) || window?.token !== token || paused || window.attempted || !config.config.automatic) return;
            // One check only. Busy has no public all-listeners-complete hook: abandon, never poll.
            if (!idle(ctx)) { window.attempted = true; return; }
            const remaining = window.restore ? 0 : window.since + config.config.idleMinutes * 60_000 - clock.now();
            if (remaining > 0) { schedule(ctx); return; }
            void evaluate(ctx, false).catch(() => {});
        }, wait);
    }
    function restore(ctx: ExtensionContext): void {
        if (closed) return;
        invalidate(); closeDialog(); active = true; context = ctx; sessionId = ctx.sessionManager.getSessionId();
        running = false; paused = false; compacting = false; compactPrevious = undefined; compactAdmitted = false; tools.clear();
        activity++; lastActivityAt = clock.now(); window = undefined;
        try { config = loadConfig(directory()); } catch (error) { config = { config: { ...DEFAULTS }, issues: [`Cannot read recap.json: ${failureDetail(error)}`] }; }
        saved = stored(ctx);
        const current = material(ctx);
        if (current.empty) return;
        if (saved?.material === current.identity) {
            const restoreEpoch = epoch;
            const value = saved;
            // session_tree is emitted before cleanup; use one task, not an idle polling loop.
            timer = clock.set(() => { timer = undefined; show(ctx, value, () => owns(ctx) && epoch === restoreEpoch && idle(ctx) && material(ctx).identity === value.material); }, 0);
            window = { token: ++windowToken, since: lastActivityAt, attempted: true, material: current.identity, restore: true };
        } else if (config.config.automatic) establish(ctx, current.identity, true);
    }
    async function evaluate(ctx: ExtensionContext, manual: boolean): Promise<void> {
        if (!idle(ctx) || (!manual && (paused || !window || window.attempted || !config.config.automatic))) return;
        const current = material(ctx);
        if (current.empty) { if (window) window.attempted = true; if (manual) notify(ctx, "No conversation available for Recap; nothing saved.", "warning"); return; }
        if (!manual && window && current.identity !== window.material) { window.attempted = true; return; }
        clearTimer();
        if (window) window.attempted = true;
        // Explicit commands refresh; only restoration/automatic evaluation can reuse saved material.
        saved = stored(ctx);
        if (!manual && saved?.material === current.identity) {
            const value = saved;
            show(ctx, value, () => idle(ctx) && material(ctx).identity === value.material);
            return;
        }
        const previousSaved = saved;
        let persistenceFailed = false;
        const version = epoch;
        const activityVersion = activity;
        const snapshot = { config: { ...config.config }, issues: [...config.issues] };
        const controller = new AbortController(); request = controller;
        const valid = () => owns(ctx) && epoch === version && activity === activityVersion && request === controller && !controller.signal.aborted &&
            idle(ctx) && material(ctx, snapshot.config.maxContextChars).identity === current.identity;
        try {
            const selection = resolveModel(snapshot, ctx.modelRegistry);
            if (!valid()) return;
            const result = await generateText({ registry: ctx.modelRegistry, ...selection, sessionId: ctx.sessionManager.getSessionId(),
                systemPrompt: RECAP_PROMPT, data: undefined, textMaterial: current.text, signal: controller.signal });
            if (!valid()) return;
            const text = readRecap(result);
            if (!valid()) return;
            const value: Stored = { version: 1, text, material: current.identity };
            const beforeIds = new Set(ctx.sessionManager.getEntries().filter(entry => entry.type === "custom" && entry.customType === STATE_TYPE).map(entry => entry.id));
            try { pi.appendEntry(STATE_TYPE, value); }
            catch (error) {
                persistenceFailed = true;
                const excluded = unconfirmed.get(ctx.sessionManager) ?? new Set<string>();
                for (const entry of ctx.sessionManager.getEntries()) {
                    if (entry.type === "custom" && entry.customType === STATE_TYPE && !beforeIds.has(entry.id)) excluded.add(entry.id);
                }
                unconfirmed.set(ctx.sessionManager, excluded);
                // Public append is not atomic: retain prior usable state without altering append-only history.
                if (valid()) saved = previousSaved;
                throw error;
            }
            if (!valid()) return;
            saved = value;
            show(ctx, value, valid);
            if (!valid()) return;
            if (manual && ctx.mode !== "tui") notify(ctx, `Recap: ${value.text}`, "info");
        } catch (error) {
            if (error instanceof RequestCancelled || !valid()) return;
            const consequence = persistenceFailed ? "Persistence not confirmed; in-memory state may have changed. Unconfirmed recap will not be reused in this activation." :
                previousSaved ? "Saved recap was not overwritten." : "No recap was saved.";
            notify(ctx, `${manual ? "Recap" : "Automatic recap"} ${persistenceFailed ? "persistence" : "generation"} failed: ${failureDetail(error)}; ${consequence}${manual ? "" : " No automatic retry in this idle window."}`, "error");
        } finally { if (request === controller) request = undefined; }
    }
    function compactTerminal(ctx: ExtensionContext, reason: string, willRetry: boolean): void {
        if (!owns(ctx)) return;
        const previous = compactPrevious ?? window;
        const admitted = compactAdmitted || (!compacting && !paused && !running && (!!window || !!saved));
        invalidate(); compacting = false; tools.clear(); compactPrevious = undefined; compactAdmitted = false;
        lastActivityAt = clock.now(); activity++;
        if (reason !== "manual" || willRetry || running || paused || !admitted) { window = undefined; return; }
        const current = material(ctx);
        if (current.empty) { window = undefined; return; }
        if (previous?.material === current.identity) {
            window = { ...previous, since: lastActivityAt, restore: false }; schedule(ctx);
        } else establish(ctx, current.identity);
    }
    async function configure(ctx: ExtensionCommandContext): Promise<void> {
        if (!ctx.hasUI) { notify(ctx, "Recap configuration requires a dialog-capable UI; edit recap.json in the agent directory.", "warning"); return; }
        closeDialog();
        const token = commandVersion;
        const version = epoch;
        clearTimer();
        await configuration.run(ctx, {
            isCurrent: () => owns(ctx) && commandVersion === token && epoch === version,
            onSettled(result) {
                if (owns(ctx)) schedule(ctx);
                // Notification can synchronously start a new configuration; do no old-flow work after it.
                if (result.kind === "error") notify(ctx, `Could not save Recap configuration: ${failureDetail(result.error)}; file unchanged.`, "error");
            },
        }, async flow => {
            let fresh: ConfigState;
            try { fresh = loadConfig(directory()); } catch (error) { notify(ctx, `Cannot edit recap.json: ${failureDetail(error)}; file unchanged.`, "error"); return; }
            let issues = [...fresh.issues];
            if (!issues.length) try { resolveModel(fresh, ctx.modelRegistry); } catch (error) { issues = [failureDetail(error)]; }
            const c = fresh.config;
            const choice = await flow.select(display(`Recap (model ${display(c.model ?? "missing")}, thinking ${display(c.thinking ?? "missing")}, automatic ${display(c.automatic)}, idle ${display(c.idleMinutes)}m, budget ${display(c.maxContextChars)})${issues.length ? ` — ${issues.map(issue => display(issue)).join("; ")}` : ""}`, 800),
                ["Set model", "Set thinking", "Toggle automatic", "Set idle minutes", "Set context budget"]);
            if (!["Set model", "Set thinking", "Toggle automatic", "Set idle minutes", "Set context budget"].includes(choice)) throw new Error("Unknown Recap configuration choice");
            const patch: Partial<RecapConfig> = {};
            if (choice === "Toggle automatic") patch.automatic = !c.automatic;
            else if (choice === "Set model" || choice === "Set thinking") {
                const models = ctx.modelRegistry.getAvailable().filter(model => model.input.includes("text") &&
                    ctx.modelRegistry.hasConfiguredAuth(model) && parseConfig({ model: `${model.provider}/${model.id}`, thinking: "off" }).config.model)
                    .sort((a, b) => `${a.provider}/${a.id}`.localeCompare(`${b.provider}/${b.id}`));
                let selected = models.find(model => `${model.provider}/${model.id}` === c.model);
                if (choice === "Set model") {
                    if (!models.length) { notify(ctx, "No authenticated text models available for Recap; configure a provider first. File unchanged.", "warning"); return; }
                    // Numbered, bounded labels remain unique even when long identifiers are truncated.
                    const labels = models.map((model, index) => `${index + 1}. ${display(`${model.provider}/${model.id}`, 760)}`);
                    const raw = await flow.select("Recap model (authenticated text models)", labels);
                    const index = labels.indexOf(raw);
                    if (index < 0) throw new Error("Unknown Recap model selection");
                    selected = models[index];
                    patch.model = `${selected.provider}/${selected.id}`;
                }
                if (!selected) { notify(ctx, "Select an available Recap model with Set model before choosing thinking. File unchanged.", "warning"); return; }
                const levels = getSupportedThinkingLevels(selected);
                if (choice === "Set thinking" || c.thinking === undefined || !levels.includes(c.thinking)) {
                    const raw = await flow.select(display(`Recap thinking for ${selected.provider}/${selected.id}`, 800), levels);
                    const level = levels.find(level => level === raw);
                    if (level === undefined) throw new Error("Unsupported Recap thinking selection");
                    patch.thinking = level;
                }
                // Registry/auth may change while the dialog is open. Never save an unavailable selection.
                const resolved = resolveModel(parseConfig({ ...c, ...patch }), ctx.modelRegistry);
                if (!resolved.model.input.includes("text")) throw new Error("Recap model no longer supports text input");
            } else {
                const key = choice === "Set idle minutes" ? "idleMinutes" : "maxContextChars";
                const raw = await flow.input(key === "idleMinutes" ? "Idle minutes (0.01–1440)" : "Context characters (256–1000000)", display(c[key]));
                if (!raw.trim()) throw new Error(`${key} cannot be empty`);
                patch[key] = Number(raw);
            }
            flow.checkpoint();
            config = saveConfig(patch, directory(), flow.isCurrent);
            flow.checkpoint();
            notify(ctx, "Recap configuration saved; active requests keep their captured parameters.", "info");
        });
    }

    pi.on("session_start", (_event, ctx) => restore(ctx));
    pi.on("session_tree", (_event, ctx) => restore(ctx));
    pi.on("session_before_tree", (_event, ctx) => pause(ctx));
    pi.on("session_before_switch", (_event, ctx) => pause(ctx));
    pi.on("session_before_fork", (_event, ctx) => pause(ctx));
    pi.on("input", (_event, ctx) => pause(ctx));
    pi.on("before_agent_start", (_event, ctx) => { if (owns(ctx)) { observe(ctx); running = true; paused = true; closeDialog(); } });
    pi.on("agent_start", (_event, ctx) => { if (owns(ctx)) { observe(ctx); running = true; paused = true; closeDialog(); } });
    pi.on("message_update", (event, ctx) => {
        const delta = event.assistantMessageEvent;
        if ((delta.type === "text_delta" || delta.type === "thinking_delta" || delta.type === "toolcall_delta") && delta.delta) observe(ctx);
    });
    pi.on("tool_execution_start", (event, ctx) => { if (owns(ctx)) { tools.add(event.toolCallId); observe(ctx); } });
    pi.on("tool_execution_update", (_event, ctx) => observe(ctx));
    pi.on("tool_execution_end", (event, ctx) => { if (owns(ctx)) { tools.delete(event.toolCallId); observe(ctx); } });
    pi.on("agent_settled", (event, ctx) => {
        if (!owns(ctx)) return;
        if (!running && window && !event.aborted) return; // Duplicate final notifications do not reopen attempts.
        observe(ctx); running = false; compacting = false; tools.clear(); compactPrevious = undefined; compactAdmitted = false;
        paused = event.aborted;
        if (event.aborted) return;
        const current = material(ctx);
        if (!current.empty) establish(ctx, current.identity);
    });
    pi.on("session_before_compact", (event, ctx) => {
        if (!owns(ctx)) return;
        compactPrevious = window;
        compactAdmitted = !paused && !running && (!!window || !!saved);
        invalidate(); closeDialog(); activity++; lastActivityAt = clock.now(); compacting = true; window = undefined;
        if (event.reason !== "manual") compactAdmitted = false;
    });
    pi.on("session_compact", (event, ctx) => compactTerminal(ctx, event.reason, event.willRetry));
    pi.on("session_compact_failed", (event, ctx) => compactTerminal(ctx, event.reason, event.willRetry));
    pi.on("session_shutdown", () => {
        if (closed) return;
        closed = true; active = false; invalidate(); closeDialog(); context = undefined; sessionId = undefined; window = undefined;
        tools.clear(); saved = undefined; compactPrevious = undefined; widget.dispose();
    });
    pi.registerCommand("recap", {
        description: "Generate and show a short work recap, or configure its model and automatic idle generation",
        getArgumentCompletions: prefix => "config".startsWith(prefix) ? [{ value: "config", label: "config — configure Recap model, thinking and idle generation" }] : null,
        handler: async (args, ctx) => {
            if (closed) return;
            if (!active) restore(ctx);
            if (!owns(ctx)) return;
            if (args.trim() === "config") { await configure(ctx); return; }
            if (args.trim()) { notify(ctx, "Use /recap or /recap config.", "warning"); return; }
            closeDialog(); invalidate();
            const token = commandVersion;
            const controller = new AbortController(); manualWait = controller;
            manualPending = token;
            try {
                if (await waitForIdle(ctx, controller) && owns(ctx) && commandVersion === token && manualPending === token) await evaluate(ctx, true);
            } catch (error) {
                if (owns(ctx) && commandVersion === token && !controller.signal.aborted) notify(ctx, `Recap wait failed: ${failureDetail(error)}; no generation started.`, "error");
            } finally {
                if (manualWait === controller) manualWait = undefined;
                if (manualPending === token) { manualPending = undefined; if (owns(ctx)) schedule(ctx); }
            }
        },
    });
}
