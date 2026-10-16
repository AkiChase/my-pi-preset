import type { ExtensionAPI, ExtensionContext, Theme } from "@earendil-works/pi-coding-agent";
import { Container, Text, type TUI } from "@earendil-works/pi-tui";
import { CONNECT, SLOTS, type ConnectRequest, type Slot, type WidgetComponent, type WidgetContent, type WidgetHandle } from "./contracts.ts";

type Placement = "aboveEditor" | "belowEditor";
const placements = ["aboveEditor", "belowEditor"] as const;
interface Entry { token: object; revision: number; content?: WidgetContent; component?: WidgetComponent; building: boolean }
interface Mount { component: WidgetComponent; active: boolean }
interface Surface { entries: Map<Slot, Entry>; leases: Map<Slot, Entry>; mount?: Mount; tui?: TUI; theme?: Theme }
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

/** Sole host-widget publisher. State and event subscriptions belong to this activation. */
export default function registerWidgetDisplay(pi: ExtensionAPI): void {
    let closed = false;
    let current: Session | undefined;
    let started = false;
    // Serialize host writes: a nested publication is reconciled AFTER the outer setter returns.
    let writing = false;
    const pending = new Set<Placement>();
    const published = new Map<Placement, { session: Session; mount?: Mount }>();
    function owns(session: Session): boolean { return !closed && current === session && session.manager.getSessionId() === session.id; }
    function ordered(s: Surface): Entry[] {
        return [...s.entries].sort(([a], [b]) => SLOTS[a].order - SLOTS[b].order || a.localeCompare(b)).map(([, entry]) => entry);
    }
    function releaseEntry(entry: Entry): void { const old = entry.component; entry.component = undefined; dispose(old); }
    function retireMount(s: Surface): void {
        const mount = s.mount; s.mount = undefined;
        if (mount) mount.active = false;
        s.tui = undefined; s.theme = undefined;
    }
    function clear(session: Session): void {
        // Close BOTH regions before any consumer cleanup can reenter.
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
        const next: Session = { manager, id, ctx, surfaces: { aboveEditor: surface(), belowEditor: surface() } };
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
            try { component = typeof content === "function" ? content(s.tui, s.theme) : textComponent(content); }
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
        const mount: Mount = { active: true, component: {
            render(width) {
                if (!owns(session) || !mount.active || s.mount !== mount) return [];
                const rows: string[] = [];
                for (const entry of ordered(s)) {
                    if (!owns(session) || !mount.active || s.mount !== mount) return [];
                    try { rows.push(...(entry.component?.render(width) ?? [])); } catch { /* A bad slot must not break unrelated rendering. */ }
                }
                return owns(session) && mount.active && s.mount === mount ? rows : [];
            },
            invalidate() {
                if (!owns(session) || !mount.active || s.mount !== mount) return;
                for (const entry of ordered(s)) try { entry.component?.invalidate(); } catch { /* Isolate slot invalidation. */ }
            },
            dispose() {
                if (!mount.active || s.mount !== mount) return;
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
                const rows = session?.ctx.mode === "rpc" && s ? ordered(s).flatMap(entry => Array.isArray(entry.content) ? [...entry.content] : []) : undefined;
                const visible = s && (rows ? rows.length > 0 : s.entries.size > 0);
                if (!session || !s || !visible) {
                    if (s) retireMount(s);
                    if (old) {
                        published.delete(placement);
                        try { old.session.ctx.ui.setWidget(key(placement), undefined); } catch { success = false; }
                    }
                    continue;
                }
                if (session.ctx.mode === "rpc") {
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
                    session.ctx.ui.setWidget(key(placement), (tui, theme) => {
                        if (owns(session) && mount.active && s.mount === mount) {
                            s.tui = tui; s.theme = theme;
                            for (const entry of ordered(s)) build(session, s, entry);
                            if (!s.entries.size) { pending.add(placement); if (!writing) drain(); }
                        }
                        return mount.component;
                    }, { placement });
                } catch {
                    failed = true; success = false;
                    if (s.mount === mount) {
                        retireMount(s);
                        for (const entry of ordered(s)) releaseEntry(entry);
                    }
                    // Even a setter that installed and then threw needs finite rollback.
                    published.delete(placement);
                    try { session.ctx.ui.setWidget(key(placement), undefined); } catch { /* No recursive retries. */ }
                }
                if (!failed && (!owns(session) || !mount.active || s.mount !== mount)) pending.add(placement);
            }
        } finally { writing = false; }
        return success;
    }
    function refresh(session: Session, placement: Placement): boolean {
        if (!owns(session)) return false;
        pending.add(placement);
        return drain() && owns(session);
    }
    const offConnect = pi.events.on(CONNECT, (data: unknown) => {
        if (closed || !data || typeof data !== "object") return;
        const request = data as ConnectRequest;
        if (request.version !== 1 || !Object.hasOwn(SLOTS, request.slot) || !request.token || typeof request.token !== "object" || typeof request.accept !== "function" || !request.ctx?.sessionManager) return;
        const acceptedSession = activate(request.ctx); if (!acceptedSession) return;
        const session: Session = acceptedSession;
        const placement = SLOTS[request.slot].placement, s = session.surfaces[placement];
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
                if (content !== undefined && typeof content !== "function" && (!Array.isArray(content) || content.some(line => typeof line !== "string"))) return false;
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
    const offStart = pi.on("session_start", (_event, ctx) => { started = true; activate(ctx, true); });
    pi.on("session_shutdown", () => {
        if (closed) return; closed = true;
        const previous = current; current = undefined;
        offConnect(); offStart(); if (previous) clear(previous);
    });
}
