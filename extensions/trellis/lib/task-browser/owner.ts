import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { isKeyRelease, isKeyRepeat, matchesKey, type Component, type OverlayHandle, type TUI } from "@earendil-works/pi-tui";
import { layoutError, type NativeLayout } from "../../../shared/scroll-panel/native-layout.ts";

export const TASK_BROWSER_KEY = "ctrl+shift+t";
export const TASK_BROWSER_KEY_LABEL = "Ctrl+Shift+T";
const STATUS_KEY = "trellis-task-viewer";
const INERT: Component = { render: () => [], invalidate() {} };
type BrowserComponent = Component & { dispose(): void };
export interface BrowserMount {
	ctx: ExtensionContext;
	root: string;
	tui: TUI;
	layout: NativeLayout;
	done(): void;
	unavailable(error: Error): void;
	hideHint?: string;
}
interface BrowserSession {
	ctx: ExtensionContext;
	id: string;
	root: string;
	cwd: string;
	closed: boolean;
	unsubscribe?: () => void;
	operation?: BrowserOperation;
	statusOwner?: BrowserOperation;
}
interface BrowserOperation {
	session: BrowserSession;
	ctx: ExtensionContext;
	closed: boolean;
	disposed: boolean;
	doneCalled: boolean;
	done?: () => void;
	component?: BrowserComponent;
	handle?: OverlayHandle;
	presentation: number;
	wait: Promise<void>;
	resolve(): void;
}

/** One session input lease, with at most one independently disposable browser interaction. */
export function createTaskBrowserOwner(dependencies: {
	findRoot(cwd: string, ctx: ExtensionContext): string | undefined;
	loadLayout(): Promise<NativeLayout>;
	createComponent(args: BrowserMount): BrowserComponent;
}): { start(ctx: ExtensionContext): void; close(): void; open(ctx: ExtensionContext): Promise<void> } {
	let session: BrowserSession | undefined;
	const valid = (s: BrowserSession) => session === s && !s.closed && s.ctx.cwd === s.cwd && s.ctx.sessionManager.getSessionId() === s.id;
	const current = (op: BrowserOperation) => !op.closed && valid(op.session) && op.session.operation === op;
	const notice = (ctx: ExtensionContext, text: string) => {
		try { ctx.ui.notify(text, "info"); } catch { /* Cosmetic sinks cannot block cleanup. */ }
	};
	const clearStatus = (op: BrowserOperation) => {
		const s = op.session;
		if (s.statusOwner !== op) return;
		s.statusOwner = undefined;
		try { op.ctx.ui.setStatus(STATUS_KEY, undefined); } catch { /* Still finish the interaction. */ }
	};
	const finishHost = (op: BrowserOperation) => {
		if (!op.done || op.doneCalled) return;
		op.doneCalled = true;
		try { op.done(); } catch { /* Never retry a host completion callback. */ }
	};
	const finish = (op: BrowserOperation) => {
		if (!op.closed) {
			op.closed = true;
			if (op.session.operation === op) op.session.operation = undefined;
			clearStatus(op);
			if (op.component && !op.disposed) {
				op.disposed = true;
				try { op.component.dispose(); } catch { /* Host completion still owns overlay removal. */ }
			}
			op.resolve();
		}
		// The factory can deliver done after opening was retired during layout loading.
		finishHost(op);
	};
	const close = () => {
		const s = session;
		if (!s) return;
		s.closed = true;
		session = undefined;
		const unsubscribe = s.unsubscribe;
		s.unsubscribe = undefined;
		try { unsubscribe?.(); } catch { /* The retired listener also gates every input. */ }
		if (s.operation) finish(s.operation);
	};
	const rootFor = (ctx: ExtensionContext, s: BrowserSession, knownRoot?: string) => {
		if (!valid(s) || ctx.sessionManager !== s.ctx.sessionManager || ctx.sessionManager.getSessionId() !== s.id || ctx.cwd !== s.cwd) throw new Error("Browser session changed; reopen in the current session.");
		const root = knownRoot ?? dependencies.findRoot(ctx.cwd, ctx);
		if (!valid(s) || root !== s.root) throw new Error("Trellis project changed; reload before browsing tasks.");
		return s.root;
	};
	const fail = (op: BrowserOperation, text: string) => {
		const live = current(op);
		finish(op);
		if (live && valid(op.session)) notice(op.ctx, text);
	};
	const present = (op: BrowserOperation, toggle: boolean) => {
		if (!current(op) || !op.handle) return;
		const handle = op.handle;
		const presentation = ++op.presentation;
		const presenting = () => current(op) && op.presentation === presentation;
		try {
			if (toggle && handle.isFocused() && !handle.isHidden()) {
				if (!op.session.unsubscribe) { notice(op.ctx, "Task viewer hiding is unavailable: the host has no terminal input listener."); return; }
				handle.setHidden(true);
				if (!presenting() || !handle.isHidden()) return;
				op.session.statusOwner = op;
				try { op.ctx.ui.setStatus(STATUS_KEY, `Trellis Tasks hidden · ${TASK_BROWSER_KEY_LABEL} to restore`); } catch { /* Hiding remains reversible without a status sink. */ }
			} else {
				if (handle.isHidden()) handle.setHidden(false);
				else handle.focus();
				if (presenting()) clearStatus(op);
			}
		} catch (error) { fail(op, `Task viewer unavailable: ${String(error)}`); }
	};
	const mount = async (op: BrowserOperation) => {
		try {
			const layout = await dependencies.loadLayout().catch(error => { throw layoutError(error, "Task viewer"); });
			if (!current(op)) return;
			rootFor(op.ctx, op.session);
			await op.ctx.ui.custom<void>((tui, _theme, _keys, done) => {
				op.done = () => done();
				if (!current(op)) { finish(op); return INERT; }
				rootFor(op.ctx, op.session);
				const component = dependencies.createComponent({ ctx: op.ctx, root: op.session.root, tui, layout,
					done: () => finish(op), unavailable: error => fail(op, error.message),
					hideHint: op.session.unsubscribe ? `${TASK_BROWSER_KEY_LABEL} Hide` : undefined });
				op.component = component;
				if (!current(op)) { op.disposed = true; component.dispose(); finish(op); return INERT; }
				// Preserve native mouse/focus capabilities; host disposal also retires the operation.
				return new Proxy(component, {
					get(target, property) {
						if (property === "dispose") return () => finish(op);
						const value = Reflect.get(target, property, target);
						return typeof value === "function" ? value.bind(target) : value;
					},
					set: (target, property, value) => Reflect.set(target, property, value, target),
				});
			}, { overlay: true, overlayOptions: { width: "100%", maxHeight: "100%", anchor: "top-left", margin: 0 },
				onHandle: handle => {
					if (!current(op)) { finish(op); return; }
					if (![handle.setHidden, handle.isHidden, handle.isFocused, handle.focus].every(fn => typeof fn === "function")) {
						fail(op, "Task viewer unavailable: the host lacks overlay visibility/focus controls."); return;
					}
					op.handle = handle;
				} });
		} catch (error) {
			if (current(op)) fail(op, `Task viewer unavailable: ${String(error)}`);
		} finally { finish(op); }
	};
	const open = (ctx: ExtensionContext, toggle = false): Promise<void> => {
		const s = session;
		// Validate both entry points here, capturing the origin before any root callback.
		if (s && (!valid(s) || ctx.sessionManager !== s.ctx.sessionManager || ctx.sessionManager.getSessionId() !== s.id || ctx.cwd !== s.cwd)) return Promise.resolve();
		let root: string | undefined;
		try {
			root = dependencies.findRoot(ctx.cwd, ctx);
			if (s && root) rootFor(ctx, s, root);
		} catch (error) {
			if (s?.operation) finish(s.operation);
			if (s ? valid(s) : !session) notice(ctx, `Trellis browsing unavailable: ${String(error)}. Run /trellis-init → Check project, or /reload.`);
			return Promise.resolve();
		}
		if (s && !valid(s)) return Promise.resolve();
		if (!root) {
			if (s?.operation) finish(s.operation);
			notice(ctx, "No Trellis project found. Open /trellis-task-viewer inside a project with .trellis/tasks.");
			return Promise.resolve();
		}
		if (!s) { notice(ctx, "Task viewer session is unavailable; reload before browsing tasks."); return Promise.resolve(); }
		if (s.operation) {
			const op = s.operation;
			if (op.handle) { present(op, toggle); return Promise.resolve(); }
			return op.wait;
		}
		let resolve!: () => void;
		const wait = new Promise<void>(complete => { resolve = complete; });
		const op: BrowserOperation = { session: s, ctx, closed: false, disposed: false, doneCalled: false, presentation: 0, wait, resolve };
		s.operation = op;
		if (!s.unsubscribe) notice(ctx, `Task viewer shortcut unavailable: the host has no terminal input listener. Use /trellis-task-viewer and Esc.`);
		if (current(op)) void mount(op);
		return wait;
	};
	const start = (ctx: ExtensionContext) => {
		if (session && valid(session) && ctx.sessionManager === session.ctx.sessionManager && ctx.cwd === session.cwd) return;
		close();
		if (ctx.mode !== "tui" || !ctx.hasUI) return;
		let root: string | undefined;
		try { root = dependencies.findRoot(ctx.cwd, ctx); } catch { return; }
		if (!root) return;
		const s: BrowserSession = { ctx, id: ctx.sessionManager.getSessionId(), cwd: ctx.cwd, root, closed: false };
		session = s;
		if (typeof ctx.ui.onTerminalInput !== "function") return;
		try {
			const unsubscribe = ctx.ui.onTerminalInput(data => {
				if (!valid(s) || !matchesKey(data, TASK_BROWSER_KEY)) return undefined;
				if (!isKeyRelease(data) && !isKeyRepeat(data)) void open(ctx, true);
				return { consume: true };
			});
			// Listener registration can synchronously reenter session retirement.
			if (valid(s)) s.unsubscribe = unsubscribe;
			else unsubscribe();
		} catch { /* Commands remain usable when a host cannot register raw input. */ }
	};
	return { start, close, open: ctx => open(ctx) };
}
