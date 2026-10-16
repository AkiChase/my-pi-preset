import { lstatSync, realpathSync } from "node:fs";
import { homedir } from "node:os";
import { resolve } from "node:path";
import { adoptPlan, applyAdoptPlan, adoptionDialog } from "./adoption.ts";
import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { applyResourcePlan, read, resourcePlan, templatePlan, applyTemplatePlan, type TemplateScope } from "./resources.ts";
import { initializationRoot } from "../project-state.ts";
import { inspect, plan, apply, checkedPath, packageResources, packageSkills, defaultTemplates, runtimeBaseline, verifyRuntime, validateUsername, SKILL_ROOT, type Inspection, type InitPlan } from "./engine.ts";
import { runDiagnostics } from "./diagnostic-runtime.ts";
import { collectDiagnostics, formatDiagnostics, buildDiagnosticReport, type DiagnosticScope } from "./diagnostics.ts";
import { CHECK_REPORT_TYPE, registerDiagnosticReport } from "./diagnostic-report.ts";

// Menu actions: verb-first, short, write actions before Check/Help/Cancel.
export const ACTIONS = Object.freeze({
	initialize: "Initialize project", adopt: "Adopt project", resume: "Resume initialization", identity: "Set developer",
	update: "Update resources", template: "Apply template", check: "Check project", help: "Help", cancel: "Cancel",
});
const { initialize: INITIALIZE, adopt: ADOPT, resume: RESUME, identity: IDENTITY, update: UPDATE, template: TEMPLATE, check: CHECK, help: HELP, cancel: CANCEL } = ACTIONS;
export const INIT_HELP = [
	"/trellis-init — no arguments; pick an action from the menu. Only actions available in the current project are shown.",
	...([
		[INITIALIZE, "New directory: install runtime, roles, skills, templates, developer identity and onboarding task."],
		[ADOPT, "Existing .trellis without manifest: take over runtime and roles, add missing skills; your documents and skill folders are kept."],
		[RESUME, "Continue an interrupted initialization."],
		[IDENTITY, "Fresh clone: create developer identity and workspace."],
		[UPDATE, "Refresh unmodified managed files and skills, restore missing ones; modified files are never overwritten."],
		[TEMPLATE, "Replace Workflow/Spec documents with package defaults; backups are kept."],
		[CHECK, "Read-only diagnosis of this project's Trellis deployment; never writes."],
	] as const).map(([name, text]) => `${name.padEnd(23)}${text}`),
	"Every write asks for confirmation first. No hooks, model turns, installs, reloads or Git changes.",
	`Skills are deployed to ${SKILL_ROOT}/; run /reload or start a new session to load them.`,
].join("\n");
const MIGRATION_NOTICE = "/trellis-init takes no arguments (--user, --check and --help were removed). Run /trellis-init and pick an action from the menu. Nothing was changed.";
const INTERACTION_GUIDE = "/trellis-init needs an interactive menu. Run it in interactive mode or an RPC client with native dialogs. Nothing was changed.";
const DIALOG_LINES = 14;
/** No automatic reload: the user decides when the session rediscovers newly deployed project skills. */
export const RELOAD_HINT = `deployed to ${SKILL_ROOT}/; run /reload or start a new session to load them (from the project root; project trust and Pi skill settings apply)`;
// Root/path names may contain line breaks or terminal controls; keep facts on one physical line.
const dialogPath = (value: string) => value.replace(/[\p{C}\p{Zl}\p{Zp}]/gu, char => `\\u{${char.codePointAt(0)!.toString(16)}}`);
const reason = (error: unknown) => (error instanceof Error ? error.message : String(error)).replace(/^Error: /, "");
const shortRelease = (id: string | undefined) => id && /^pi-trellis-runtime-v1-[a-f0-9]{64}$/.test(id) ? id.slice(22, 30) : undefined;
/** Core confirmation facts precede optional path examples; only examples may be omitted. */
export function boundedDialog(text: string): string {
	const lines = text.split("\n");
	if (lines.length <= DIALOG_LINES) return text;
	return [...lines.slice(0, DIALOG_LINES - 1), `… ${lines.length - DIALOG_LINES + 1} more paths omitted.`].join("\n");
}

const STATUS: Record<Inspection["state"], string> = {
	fresh: "Not initialized", unsupported: "Not managed (legacy .trellis)", incomplete: "Initialization interrupted",
	supported: "Developer not set", ready: "Ready", conflict: "Blocked",
};
interface MenuView { status: string; installed?: string; available?: string; repair?: boolean; issues: string[] }
function runtimeLine(view: MenuView): string {
	const installed = shortRelease(view.installed), available = shortRelease(view.available);
	if (!installed) return available ? `not installed (package ${available})` : "unknown";
	if (!available || installed === available) return `${installed} (${view.repair ? "needs restore" : "current"})`;
	return `${installed} → ${available}`;
}
/** Menu header: Project / Status / Developer / Runtime, then optional Issue lines. */
export function statusSummary(state: Inspection, view: Partial<MenuView> = {}): string {
	const full: MenuView = { status: STATUS[state.state], installed: state.manifest?.runtimeReleaseId, available: safeRelease(), issues: state.diagnostics.map(d => d.replace(/^Error: /, "")), ...view };
	return [`Project:   ${dialogPath(state.root)}`, `Status:    ${full.status}`, `Developer: ${state.developer ?? "Not set"}`, `Runtime:   ${runtimeLine(full)}`, ...full.issues.map(issue => `Issue:     ${issue}`)].join("\n");
}
function safeRelease(): string | undefined { try { return runtimeBaseline().releaseId; } catch { return undefined; } }
function counts(rows: { state: string }[]): string {
	const totals = new Map<string, number>();
	for (const row of rows) totals.set(row.state, (totals.get(row.state) ?? 0) + 1);
	return [...totals].map(([state, count]) => `${state} ${count}`).join(" · ") || "none";
}
/** Unified confirmation: `Confirm · <action>`, fixed fields, then path rows. Options are always [Cancel, action]. */
function confirmation(action: string, fields: [string, string][], rows: string[] = []): string {
	return boundedDialog([`Confirm · ${action}`, ...fields.map(([key, value]) => `${(key + ":").padEnd(11)}${value}`), ...rows].join("\n"));
}
async function confirm(ctx: ExtensionCommandContext, action: string, dialog: string): Promise<boolean> {
	return await ctx.ui.select(dialog, [CANCEL, action]) === action;
}
/** Unified result notice: `<action> · <outcome>` then key/value lines. */
function result(action: string, outcome: string, fields: [string, string][]): string {
	return [`${action} · ${outcome}`, ...fields.map(([key, value]) => `${(key + ":").padEnd(11)}${value}`)].join("\n");
}
export function planSummary(value: InitPlan): string {
	const action = value.operation === "initialize" ? INITIALIZE : IDENTITY;
	return confirmation(action, [
		["Project", dialogPath(value.root)],
		["Developer", `${value.user} (workspace ${value.workspaceReused ? "reused" : "created"})`],
		["Changes", counts(value.actions.map(a => ({ state: a.original ? "Update block" : "Create" })))],
		["Keeps", value.operation === "initialize" ? "existing files, tasks and journals" : "runtime, config, spec, workflow, tasks and journals"],
		["Backup", "none (no automatic rollback)"],
	], value.actions.map(a => `${a.original ? "Update block" : "Create"}: ${dialogPath(a.path)}`));
}

interface MenuSnapshot { state: Inspection; view: MenuView; operations: string[] }
/** Discovery only: explicit resource/identity paths, no workspace inventory, Python or Git. Not apply authority. */
function menuSnapshot(cwd: string): MenuSnapshot {
	const state: Inspection = { root: resolve(cwd), state: "conflict", workspaces: [], diagnostics: [], releaseId: "Not verified" };
	const view = (status: string, issues: string[] = [], extra: Partial<MenuView> = {}): MenuView => ({ status, issues, available: safeRelease(), ...extra });
	try {
		state.root = realpathSync(initializationRoot(cwd));
		const root = state.root;
		if (!lstatSync(root).isDirectory() || root === realpathSync(homedir())) throw new Error("Initialization requires a project directory, not HOME");
		const present = (path: string) => {
			try { lstatSync(checkedPath(root, path)); return true; }
			catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return false; throw error; }
		};
		if (present(".trellis/.runtime/pi-trellis/binding.json")) throw new Error("This is a managed worktree; run /trellis-init from the source project");
		if (present(".trellis/.runtime/init.lock")) throw new Error("Initialization lock exists (.trellis/.runtime/init.lock); check its owner. It is never removed automatically.");
		// Validate package integrity and local parent routes, even in a fresh project.
		checkedPath(root, ".pi/agents"); checkedPath(root, SKILL_ROOT);
		packageResources(); defaultTemplates(); packageSkills();
		const manifest = read(root, ".trellis/.pi-trellis.json");
		if (manifest !== undefined && !manifest.length) throw new Error("Managed project manifest is empty; explicit reconciliation is required");
		const operation = read(root, ".trellis/.runtime/init-operation.json");
		if (operation) {
			const record = JSON.parse(operation.toString("utf8"));
			if (record?.schemaVersion === 1 && record.status === "incomplete" && record.plan?.root === root && typeof record.plan.user === "string" && typeof record.plan.releaseId === "string" && Array.isArray(record.completed)) {
				validateUsername(record.plan.user);
				state.state = "incomplete"; state.releaseId = record.plan.releaseId;
				return { state, view: view(STATUS.incomplete), operations: [RESUME] };
			}
		}
		if (manifest === undefined) {
			// This also rejects invalid/incomplete operation records without executing them.
			verifyRuntime(root);
			state.state = present(".trellis") ? "unsupported" : "fresh";
			return { state, view: view(STATUS[state.state]), operations: [state.state === "fresh" ? INITIALIZE : ADOPT] };
		}
		let runtimeError: unknown;
		try { state.manifest = verifyRuntime(root); state.releaseId = state.manifest!.runtimeReleaseId; }
		catch (error) { runtimeError = error; }
		const identity = read(root, ".trellis/.developer");
		if (identity !== undefined) {
			const names = identity.toString("utf8").split(/\r?\n/).filter(line => line.startsWith("name="));
			if (names.length !== 1) throw new Error("Developer identity (.trellis/.developer) is malformed");
			state.developer = validateUsername(names[0].slice(5));
			checkedPath(root, `.trellis/workspace/${state.developer}`);
		}
		if (!runtimeError) {
			state.state = state.developer ? "ready" : "supported";
			// Schema 2 predates deployed skills: runtime stays usable, Update adds them explicitly.
			const issues = state.manifest!.schemaVersion === 3 ? [] : [`Project skills not deployed; choose ${UPDATE}.`];
			return { state, view: view(STATUS[state.state], issues, { installed: state.releaseId }), operations: state.developer ? [UPDATE, TEMPLATE] : [IDENTITY, ...(issues.length ? [UPDATE] : []), TEMPLATE] };
		}
		// Missing/older owned resources may still be safely restored; modified resources never authorize writes.
		const update = resourcePlan(root, "update");
		state.releaseId = update.report.installed;
		const extra = { installed: update.report.installed, repair: update.report.installed === update.report.available };
		const conflicts = update.report.conflicts;
		if (conflicts.length) return { state, view: view("Update blocked", [`Modified managed files: ${conflicts.slice(0, 3).join(", ")}${conflicts.length > 3 ? ` (+${conflicts.length - 3} more)` : ""}`, "Restore or remove them, then choose Update resources."], extra), operations: [] };
		return { state, view: view(extra.repair ? "Restore needed" : "Update available", [], extra), operations: [UPDATE] };
	} catch (error) {
		state.state = "conflict";
		return { state, view: view(STATUS.conflict, [reason(error)], { installed: shortRelease(state.releaseId) ? state.releaseId : undefined }), operations: [] };
	}
}

/** Compatibility for callers needing the single static report, not a publication plan. */
export function checkProject(cwd: string, scope: Omit<DiagnosticScope, "cwd"> = {}): string {
	return formatDiagnostics(collectDiagnostics({ ...scope, cwd }));
}

async function chooseUsername(action: string, state: Inspection, ctx: ExtensionCommandContext): Promise<string | undefined> {
	const candidates = new Map(state.workspaces.map(name => [`${name} — Existing workspace`, name]));
	if (state.gitSuggestion) candidates.set(`${state.gitSuggestion} — Suggested from Git`, state.gitSuggestion);
	const custom = "Enter a different username";
	const choice = await ctx.ui.select(`${action} · Choose developer`, [...candidates.keys(), custom, CANCEL]);
	if (!choice || choice === CANCEL) return undefined;
	if (candidates.has(choice)) return candidates.get(choice);
	if (choice !== custom) return undefined;
	for (;;) {
		const name = await ctx.ui.input(`${action} · Developer name`, "Safe single directory name; Unicode and spaces are allowed");
		if (name === undefined) return undefined;
		try { return validateUsername(name); } catch (error) { ctx.ui.notify(reason(error), "error"); }
	}
}
async function applyTemplates(ctx: ExtensionCommandContext, root: string, notify: (text: string) => void): Promise<boolean> {
	const scopes: Record<string, TemplateScope> = { "Workflow": "workflow", "Spec": "spec", "Workflow + Spec": "both" };
	const choice = await ctx.ui.select(`${TEMPLATE} · Choose scope`, [...Object.keys(scopes), CANCEL]);
	if (!choice || !Object.hasOwn(scopes, choice)) return false;
	const value = templatePlan(root, scopes[choice]);
	const dialog = confirmation(TEMPLATE, [
		["Project", dialogPath(root)], ["Scope", choice], ["Changes", counts(value.rows)],
		["Keeps", "other project files, identity, tasks and journals"],
		["Backup", ".trellis/.runtime/template-backups/ (replaced files only)"],
	], value.rows.map(row => `${row.state}: ${dialogPath(row.path)}`));
	if (!await confirm(ctx, TEMPLATE, dialog)) return false;
	const backup = applyTemplatePlan(value);
	notify(backup
		? result(TEMPLATE, "Done", [["Scope", choice], ["Changed", `${value.changes.length} files`], ["Backup", backup]])
		: result(TEMPLATE, "Up to date", [["Scope", choice], ["Changed", "0 files"]]));
	return true;
}
/** Optional parent lifecycle wrapper may suppress stale publication by returning undefined. */
export type RunDiagnosticCheck = (ctx: ExtensionCommandContext, scope: DiagnosticScope, options: { signal?: AbortSignal }) => Promise<import("./diagnostics.ts").DiagnosticResult | undefined>;
export function registerInitCommand(pi: ExtensionAPI, refresh: (ctx: ExtensionCommandContext, root: string) => Promise<void>, runCheck?: RunDiagnosticCheck): void {
	registerDiagnosticReport(pi);
	pi.registerCommand("trellis-init", {
		description: "Initialize, update or check Pi Trellis in this project (menu, no arguments)",
		handler: async (args, ctx) => {
			const notify = (text: string, type: "info" | "error" = "info") => {
				if (ctx.hasUI) ctx.ui.notify(text, type);
				else pi.sendMessage({ customType: "trellis-init-status", content: text, display: true });
			};
			if (args.trim()) { notify(MIGRATION_NOTICE, "error"); return; }
			if (!ctx.hasUI) { notify(INTERACTION_GUIDE); return; }
			let action = "Trellis init";
			try {
				const snapshot = menuSnapshot(ctx.cwd);
				const choice = await ctx.ui.select(boundedDialog(statusSummary(snapshot.state, snapshot.view)), [...snapshot.operations, CHECK, HELP, CANCEL]);
				if (choice === HELP) { notify(INIT_HELP); return; }
				if (choice === CHECK) {
					action = CHECK;
					// Check inspects the project deployment only; no session or task identity is consulted.
					const scope: DiagnosticScope = { cwd: ctx.cwd, isProjectTrusted: typeof ctx.isProjectTrusted === "function" && ctx.isProjectTrusted() };
					const report = await (runCheck ? runCheck(ctx, scope, { signal: ctx.signal }) : runDiagnostics(scope, { signal: ctx.signal }));
					if (report) {
						const details = buildDiagnosticReport(report);
						pi.sendMessage({ customType: CHECK_REPORT_TYPE, content: details.expanded.map(line => line.text).join("\n"), details, display: true });
					}
					return;
				}
				if (!choice || !snapshot.operations.includes(choice)) return;
				action = choice;
				// A menu snapshot cannot authorize publication: inspect and each plan/apply recheck current state.
				const state = inspect(snapshot.state.root);
				if (choice === ADOPT) {
					const value = adoptPlan(state.root);
					if (!await confirm(ctx, ADOPT, adoptionDialog(value))) return;
					const adopted = applyAdoptPlan(value);
					notify(result(ADOPT, "Done", [
						["Changed", `${value.changes.length} files`], ["Legacy", `${value.legacy.length} paths left in place`],
						["Skills", RELOAD_HINT],
						["Next", adopted.state === "supported" ? `/trellis-init → ${IDENTITY}` : "none"],
					]));
					await refresh(ctx, adopted.root); return;
				}
				if (choice === TEMPLATE) {
					if (!["ready", "supported"].includes(state.state)) throw new Error(`Project is ${STATUS[state.state]}; ${TEMPLATE} needs a current runtime`);
					if (await applyTemplates(ctx, state.root, notify)) await refresh(ctx, state.root);
					return;
				}
				if (choice === UPDATE) {
					const update = resourcePlan(state.root, "update");
					if (update.report.conflicts.length) throw new Error(`Modified or unmanaged files are preserved: ${update.report.conflicts.join(", ")}`);
					if (update.unchanged) { notify(result(UPDATE, "Up to date", [["Changed", "0 files"]])); return; }
					const added = new Set(update.report.rows.filter(row => row.state === "New — will install").map(row => row.path));
					const label = (before: unknown, path: string) => before ? "Update" : added.has(path) ? "Install" : "Restore";
					const dialog = confirmation(UPDATE, [
						["Project", dialogPath(state.root)],
						["Changes", counts(update.changes.map(c => ({ state: label(c.before, c.path) })))],
						["Keeps", "identity, tasks, journals and modified documents"],
						["Backup", "none (no automatic rollback)"],
					], update.changes.map(c => `${label(c.before, c.path)}: ${dialogPath(c.path)}`));
					if (!await confirm(ctx, UPDATE, dialog)) return;
					applyResourcePlan(update);
					const release = shortRelease(update.manifest.runtimeReleaseId);
					const skills = update.changes.some(c => c.path.startsWith(`${SKILL_ROOT}/`));
					notify(result(UPDATE, "Done", [["Changed", `${update.changes.length} files`], ...(release ? [["Runtime", release] as [string, string]] : []), ...(skills ? [["Skills", RELOAD_HINT] as [string, string]] : [])]));
					await refresh(ctx, state.root); return;
				}
				const expected = choice === INITIALIZE ? "fresh" : choice === RESUME ? "incomplete" : "supported";
				if (state.state !== expected) throw new Error(`Project changed: status is now ${STATUS[state.state]}`);
				const user = await chooseUsername(choice, state, ctx);
				if (user === undefined) return;
				const value = plan(state.root, user);
				if (!value) { notify(result(choice, "Up to date", [["Developer", user], ["Changed", "0 files"]])); return; }
				if (!await confirm(ctx, choice, planSummary(value).replace(/^Confirm · [^\n]*/, `Confirm · ${choice}`))) return;
				apply(value);
				const deployed = value.actions.some(a => a.kind === "skill");
				notify(result(choice, "Done", [
					["Developer", value.user], ["Task", `${value.task} (${value.taskReused ? "reused" : "created"})`],
					...(deployed ? [["Skills", RELOAD_HINT] as [string, string]] : []),
					["Next", `${deployed ? "/reload, then " : ""}/skill:trellis-start — review the task before starting work`],
				]));
				await refresh(ctx, state.root);
			} catch (error) {
				notify(result(action, "Failed", [["Reason", reason(error)], ["Next", `/trellis-init → ${CHECK}; partial changes, if any, are preserved`]]), "error");
			}
		},
	});
}
