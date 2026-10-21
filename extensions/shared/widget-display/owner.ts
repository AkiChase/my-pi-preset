import type { ExtensionAPI, ExtensionContext, ReadonlyFooterDataProvider, Theme } from "@earendil-works/pi-coding-agent";
import { Container, Text, stripTerminalSequences, truncateToWidth, wrapTextWithAnsi, type TUI } from "@earendil-works/pi-tui";
import { CONNECT, SESSION_START, REGISTRY, type DisplayRegistry, type InlineComponent, type Region, type ConnectRequest, type WidgetComponent, type WidgetContent, type WidgetHandle } from "./contracts.ts";

type Placement = Region;
const placements = ["aboveEditor", "belowEditor", "footer"] as const;
interface Entry { token: object; revision: number; content?: WidgetContent; component?: WidgetComponent; building: boolean }
interface Mount { component: WidgetComponent; active: boolean; hostOwned: boolean }
interface Surface { retired?: boolean; entries: Map<string, Entry>; leases: Map<string, Entry>; mount?: Mount; tui?: TUI; theme?: Theme; footerData?: ReadonlyFooterDataProvider }
interface Session { manager: ExtensionContext["sessionManager"]; id: string; ctx: ExtensionContext; surfaces: Record<Placement, Surface> }
const key = (placement: Placement) => `preset.widgets.${placement}`;
const surface = (): Surface => ({ entries: new Map(), leases: new Map() });
function dispose(component?: WidgetComponent): void { try { component?.dispose?.(); } catch { /* Isolate consumer cleanup failures. */ } }
function textComponent(lines: readonly string[]): WidgetComponent {
    const container = new Container();
    for (const line of lines.slice(0, 10)) container.addChild(new Text(line, 1, 0));
    if (lines.length > 10) container.addChild(new Text("... (widget truncated)", 1, 0));
    return container;
}

/** Sole host widget/Footer publisher. State and event subscriptions belong to this activation. */
export default function registerWidgetDisplay(pi: ExtensionAPI, registry: DisplayRegistry = REGISTRY): void {
    for (const group of Object.values(registry.groups)) {
        if (!placements.includes(group.region) || !Number.isFinite(group.order) ||
            (group.layout !== "block" && group.layout !== "inline") ||
            (group.layout === "inline" && (typeof group.separator !== "string" || !["wrap", "truncate"].includes(group.overflow ?? "")))) throw new Error("Invalid display group");
    }
    for (const item of Object.values(registry.items)) if (!registry.groups[item.group] || !Number.isFinite(item.order)) throw new Error("Invalid display item");
    let closed = false;
    let current: Session | undefined;
    let started = false;
    // Serialize host writes: a nested publication is reconciled AFTER the outer setter returns.
    let writing = false;
    const pending = new Set<Placement>();
    const published = new Map<Placement, { session: Session; mount?: Mount }>();
    function owns(session: Session): boolean { return !closed && current === session && session.manager.getSessionId() === session.id; }
    function ordered(s: Surface): Entry[] {
        return [...s.entries].sort(([a], [b]) => {
            const ia = registry.items[a], ib = registry.items[b];
            const ga = registry.groups[ia.group], gb = registry.groups[ib.group];
            return ga.order - gb.order || ia.group.localeCompare(ib.group) || ia.order - ib.order || a.localeCompare(b);
        }).map(([, entry]) => entry);
    }
    function releaseEntry(entry: Entry): void { const old = entry.component; entry.component = undefined; dispose(old); }
    function retireMount(s: Surface): void {
        const mount = s.mount; s.mount = undefined;
        if (mount) mount.active = false;
        s.tui = undefined; s.theme = undefined; s.footerData = undefined;
    }
    function clear(session: Session): void {
        // Close ALL regions before any consumer cleanup can reenter.
        const entries = placements.flatMap(p => [...session.surfaces[p].entries.values()]);
        for (const placement of placements) {
            const s = session.surfaces[placement];
            s.entries.clear(); s.leases.clear(); retireMount(s); pending.add(placement);
        }
        for (const entry of entries) { entry.revision++; entry.content = undefined; releaseEntry(entry); }
        drain();
    }
    function activate(ctx: ExtensionContext, fromStart = false): Session | undefined {
        if (closed || (!fromStart && started && !current)) return undefined;
        if (!ctx.hasUI || (ctx.mode !== "tui" && ctx.mode !== "rpc")) {
            if (fromStart) { const previous = current; current = undefined; if (previous) clear(previous); }
            return undefined;
        }
        const manager = ctx.sessionManager, id = manager.getSessionId();
        if (current?.manager === manager && current.id === id) { current.ctx = ctx; return current; }
        // A captured client context cannot switch the owner back to an old session.
        if (current && !fromStart) return undefined;
        const previous = current;
        const next: Session = { manager, id, ctx, surfaces: { aboveEditor: surface(), belowEditor: surface(), footer: surface() } };
        current = next;
        if (previous) clear(previous);
        return owns(next) ? next : undefined;
    }
    function build(session: Session, s: Surface, entry: Entry): void {
        if (entry.building) return;
        while (owns(session) && s.mount?.active && s.entries.size && [...s.entries.values()].includes(entry) && !entry.component && entry.content && s.tui && s.theme) {
            const revision = entry.revision, content = entry.content;
            entry.building = true;
            let component: WidgetComponent | undefined;
            try { component = typeof content === "function" ? content(s.tui, s.theme) : Array.isArray(content) ? textComponent(content) :
                "kind" in content ? (content.kind === "footer" ? (s.footerData ? content.factory(s.tui, s.theme, s.footerData) : undefined) : content.factory(s.tui, s.theme, s.footerData)) : undefined; }
            catch {
                if (entry.revision === revision) {
                    for (const [slot, candidate] of s.entries) if (candidate === entry) s.entries.delete(slot);
                    entry.content = undefined; entry.revision++;
                }
            } finally { entry.building = false; }
            if (!component && entry.revision === revision) break;
            if (owns(session) && entry.revision === revision && [...s.entries.values()].includes(entry) && s.mount?.active) entry.component = component;
            else dispose(component);
        }
    }
    function makeMount(session: Session, placement: Placement, s: Surface): Mount {
        const mount: Mount = { active: true, hostOwned: false, component: {
            render(width) {
                if (!owns(session) || !mount.active || s.mount !== mount) return [];
                const rows: string[] = [];
                const groups = Object.entries(registry.groups).filter(([, g]) => g.region === placement)
                    .sort(([a, ga], [b, gb]) => ga.order - gb.order || a.localeCompare(b));
                for (const [name, group] of groups) {
                    const entries = [...s.entries].filter(([item]) => registry.items[item].group === name)
                        .sort(([a], [b]) => registry.items[a].order - registry.items[b].order || a.localeCompare(b));
                    const fragments: string[] = [];
                    for (const [, entry] of entries) {
                        if (!owns(session) || !mount.active || s.mount !== mount) return [];
                        try {
                            if (group.layout === "block") rows.push(...(entry.component?.render(width) ?? []));
                            else {
                                const text = (entry.component as InlineComponent | undefined)?.renderText(width) ?? "";
                                // Preserve ANSI styling; strip non-style controls and explicit line breaks.
                                const clean = text.replace(/\x1b\](?:(?!\x07|\x1b\\)[\s\S])*(?:\x07|\x1b\\|$)/g, "")
                                    .replace(/\x1b(?:\[[0-?]*[ -/]*[@-~]|[^[])/g, sequence => /^\x1b\[[0-9;:]*m$/.test(sequence) ? sequence : "")
                                    .replace(/[\x00-\x1f\x7f-\x9f]/g, c => c === "\x1b" ? c : " ").trim();
                                if (stripTerminalSequences(clean).trim()) fragments.push(clean);
                            }
                        } catch { /* A bad item must not break unrelated rendering. */ }
                    }
                    if (fragments.length && width > 0) {
                        let separator = group.separator ?? "", ellipsis = "…";
                        const theme = session.ctx.ui.theme ?? s.theme;
                        try { separator = theme?.fg("borderMuted", separator) ?? separator; } catch { /* Theme fallback. */ }
                        try { ellipsis = theme?.fg("dim", ellipsis) ?? ellipsis; } catch { /* Theme fallback. */ }
                        const text = fragments.join(separator);
                        rows.push(...(group.overflow === "wrap" ? wrapTextWithAnsi(text, width) : [truncateToWidth(text, width, ellipsis)]));
                    }
                }
                return owns(session) && mount.active && s.mount === mount ? rows : [];
            },
            invalidate() {
                if (!owns(session) || !mount.active || s.mount !== mount) return;
                for (const entry of ordered(s)) try { entry.component?.invalidate(); } catch { /* Isolate slot invalidation. */ }
            },
            dispose() {
                mount.hostOwned = false;
                if (!mount.active || s.mount !== mount) return;
                if (placement === "footer") s.retired = true;
                if (published.get(placement)?.mount === mount) published.delete(placement);
                retireMount(s);
                for (const entry of ordered(s)) releaseEntry(entry);
            },
        } };
        s.mount = mount;
        return mount;
    }
    function drain(): boolean {
        if (writing) return true;
        writing = true;
        let success = true;
        try {
            while (pending.size) {
                const placement = pending.values().next().value as Placement; pending.delete(placement);
                const old = published.get(placement);
                const session = current && owns(current) ? current : undefined;
                const s = session?.surfaces[placement];
                if (s?.retired && placement === "footer") continue;
                const rows = session?.ctx.mode === "rpc" && placement !== "footer" && s ? ordered(s).flatMap(entry => Array.isArray(entry.content) ? [...entry.content] : []) : undefined;
                const visible = s && (placement !== "footer" || session?.ctx.mode === "tui") && (rows ? rows.length > 0 : s.entries.size > 0);
                if (!session || !s || !visible) {
                    if (s) retireMount(s);
                    if (old) {
                        published.delete(placement);
                        try { if (placement === "footer") { if (old.mount?.hostOwned) old.session.ctx.ui.setFooter(undefined); } else old.session.ctx.ui.setWidget(key(placement), undefined); } catch { success = false; }
                    }
                    continue;
                }
                if (session.ctx.mode === "rpc" && placement !== "footer") {
                    published.set(placement, { session });
                    try { session.ctx.ui.setWidget(key(placement), rows, { placement }); }
                    catch {
                        published.delete(placement); success = false;
                        try { session.ctx.ui.setWidget(key(placement), undefined); } catch { /* Finite rollback. */ }
                    }
                    continue;
                }
                if (s.mount?.active && old?.session === session && old.mount === s.mount) {
                    for (const entry of ordered(s)) build(session, s, entry);
                    try { if (owns(session)) s.tui?.requestRender(); } catch { success = false; }
                    if (!s.entries.size) pending.add(placement);
                    continue;
                }
                const mount = s.mount?.active ? s.mount : makeMount(session, placement, s);
                published.set(placement, { session, mount });
                let failed = false;
                try {
                    const factory = (tui: TUI, theme: Theme, footerData?: ReadonlyFooterDataProvider) => {
                        mount.hostOwned = true;
                        if (owns(session) && mount.active && s.mount === mount) {
                            s.tui = tui; s.theme = theme; s.footerData = footerData;
                            for (const entry of ordered(s)) build(session, s, entry);
                            if (!s.entries.size) { pending.add(placement); if (!writing) drain(); }
                        }
                        return mount.component;
                    };
                    if (placement === "footer") session.ctx.ui.setFooter(factory);
                    else session.ctx.ui.setWidget(key(placement), factory, { placement });
                } catch {
                    failed = true; success = false;
                    if (s.mount === mount) {
                        retireMount(s);
                        for (const entry of ordered(s)) releaseEntry(entry);
                    }
                    // Roll back only while the supplied component still proves Footer ownership.
                    published.delete(placement);
                    try {
                        if (placement === "footer") { if (mount.hostOwned) session.ctx.ui.setFooter(undefined); }
                        else session.ctx.ui.setWidget(key(placement), undefined);
                    } catch { /* No recursive retries. */ }
                }
                if (!failed && (!owns(session) || !mount.active || s.mount !== mount)) pending.add(placement);
            }
        } finally { writing = false; }
        return success;
    }
    function refresh(session: Session, placement: Placement): boolean {
        if (!owns(session)) return false;
        pending.add(placement);
        return drain() && owns(session) && !session.surfaces[placement].retired;
    }
    const offConnect = pi.events.on(CONNECT, (data: unknown) => {
        if (closed || !data || typeof data !== "object") return;
        const request = data as ConnectRequest;
        if (request.version !== 1 || !Object.hasOwn(registry.items, request.slot) || !request.token || typeof request.token !== "object" || typeof request.accept !== "function" || !request.ctx?.sessionManager) return;
        const acceptedSession = activate(request.ctx); if (!acceptedSession) return;
        const session: Session = acceptedSession;
        const group = registry.groups[registry.items[request.slot].group];
        const placement = group.region, s = session.surfaces[placement];
        if (placement === "footer" && session.ctx.mode !== "tui") return;
        const previous = s.leases.get(request.slot);
        if (previous && previous.token !== request.token) return;
        // A duplicate request never creates another independently live lease.
        if (previous) return;
        let alive = true;
        const entry: Entry = { token: request.token, revision: 0, building: false };
        s.leases.set(request.slot, entry);
        function valid(): boolean { return alive && owns(session) && s.leases.get(request.slot) === entry; }
        const handle: WidgetHandle = {
            set(content) {
                if (!valid() || (typeof content === "function" && session.ctx.mode !== "tui")) return false;
                if (content !== undefined) {
                    if (Array.isArray(content)) { if (group.layout === "inline" || content.some(line => typeof line !== "string")) return false; }
                    else if (typeof content === "function") { if (group.layout === "inline") return false; }
                    else if (!content || typeof content !== "object" || !("kind" in content) || typeof content.factory !== "function" ||
                        (group.layout === "inline" ? content.kind !== "inline" : content.kind !== "footer" || placement !== "footer")) return false;
                    if (!Array.isArray(content) && session.ctx.mode !== "tui") return false;
                }
                const revision = ++entry.revision; entry.content = content;
                if (content === undefined) s.entries.delete(request.slot); else s.entries.set(request.slot, entry);
                releaseEntry(entry);
                if (!valid() || entry.revision !== revision) return false;
                const success = refresh(session, placement);
                return success && valid() && entry.revision === revision && entry.content === content;
            },
            dispose() {
                if (!alive) return; const accepted = valid(); alive = false;
                if (!accepted) return;
                s.leases.delete(request.slot);
                if (s.entries.get(request.slot) === entry) s.entries.delete(request.slot);
                entry.revision++; entry.content = undefined; releaseEntry(entry);
                refresh(session, placement);
            },
        };
        try { request.accept(handle); } catch { handle.dispose(); }
    });
    const offSession = pi.events.on(SESSION_START, (data: unknown) => {
        if (closed || !data || typeof data !== "object") return;
        const value = data as { version?: unknown; ctx?: ExtensionContext };
        if (value.version !== 1 || !value.ctx?.sessionManager) return;
        started = true; activate(value.ctx, true);
    });
    const offStart = pi.on("session_start", (_event, ctx) => { started = true; activate(ctx, true); });
    pi.on("session_shutdown", () => {
        if (closed) return; closed = true;
        const previous = current; current = undefined;
        offConnect(); offSession(); offStart(); if (previous) clear(previous);
    });
}
