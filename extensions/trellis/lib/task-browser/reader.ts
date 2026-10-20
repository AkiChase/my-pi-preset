import { isUtf8 } from "node:buffer";
import { closeSync, constants, fstatSync, lstatSync, openSync, readSync, readdirSync, realpathSync, statSync } from "node:fs";
import { basename, join } from "node:path";
import { stripVTControlCharacters } from "node:util";
import { containsPath } from "../config.ts";
import { checkedPath } from "../initialization/engine.ts";
import { resolveTaskPath } from "../task-context.ts";

export interface BrowserTask {
	identity: string;
	dir: string;
	title: string;
	status: string;
	record: Record<string, unknown>;
}
export interface TaskRow { task: BrowserTask; prefix: string }
export interface TaskSnapshot { tasks: BrowserTask[]; rows: TaskRow[]; months: string[]; diagnostics: string[]; complete: boolean }
export type TaskBrowseRange = "active" | "archive-months" | { kind: "archive-month"; month: string };
export type DocumentSection = "prd" | "design" | "implement";
export type TaskDocument = { state: "ready" | "empty"; text: string } | { state: "missing" | "removed" | "error"; diagnostic?: string };
const MAX_DOCUMENT_BYTES = 2 * 1024 * 1024;
const MAX_DIAGNOSTICS = 32;

/** Strip untrusted terminal sequences, retaining Markdown line breaks and expanding tabs. */
export function safeText(text: string, multiline = false): string {
	const clean = stripVTControlCharacters(text).replace(/\r\n?/g, "\n");
	return clean.replace(/[\x00-\x08\x0b-\x1f\x7f-\x9f]/g, " ")
		.replace(/\t/g, "    ").replace(/\n/g, multiline ? "\n" : " ");
}
export function displayValue(value: unknown): string {
	try { return typeof value === "string" ? value : JSON.stringify(value) ?? String(value); }
	catch { return "Invalid value"; }
}
function diagnosticText(error: unknown): string {
	return safeText(error instanceof Error ? error.message : displayValue(error)).slice(0, 240);
}
function regularTaskFile(task: string, name: string): string {
	const path = realpathSync(join(task, name));
	if (!containsPath(realpathSync(task), path)) throw new Error(`${name} escapes its task directory`);
	if (!statSync(path).isFile()) throw new Error(`${name} is not a regular file`);
	return path;
}
function readTextFile(file: string, limit: number, label: string): string {
	// Nonblocking open plus descriptor validation also rejects a FIFO swapped in after preflight.
	const fd = openSync(file, constants.O_RDONLY | constants.O_NONBLOCK | constants.O_NOFOLLOW);
	try {
		const info = fstatSync(fd);
		if (!info.isFile()) throw new Error(`${label} is not a regular file`);
		if (info.size > limit) throw new Error(`${label} exceeds ${limit / (1024 * 1024)} MiB`);
		const bytes = Buffer.alloc(limit + 1);
		let length = 0;
		while (length < bytes.length) {
			const count = readSync(fd, bytes, length, bytes.length - length, null);
			if (!count) break;
			length += count;
		}
		if (length > limit) throw new Error(`${label} exceeds ${limit / (1024 * 1024)} MiB`);
		const content = bytes.subarray(0, length);
		if (!isUtf8(content) || content.includes(0)) throw new Error(`${label} is not UTF-8 text`);
		return content.toString("utf8");
	} finally { closeSync(fd); }
}

/** Only the supplied session's disk pointer; no record read, CLI fallback or lifecycle call.
 * The UI marks only identities present in its independently validated task snapshot.
 */
export function readCurrentTaskIdentity(root: string, key: string): string | undefined {
	try {
		const file = checkedPath(root, `.trellis/.runtime/sessions/${key}.json`);
		const data: unknown = JSON.parse(readTextFile(file, 1024 * 1024, "Session pointer"));
		if (!data || typeof data !== "object" || Array.isArray(data)) return undefined;
		const dir = (data as Record<string, unknown>).current_task;
		return typeof dir === "string" && dir ? realpathSync(resolveTaskPath(root, dir)) : undefined;
	} catch { return undefined; }
}

function validateRecord(record: Record<string, unknown>): void {
	if (!["id", "name", "title", "status"].some(key => Object.hasOwn(record, key))) throw new Error("Invalid task record: no identity or status");
	for (const key of ["id", "name", "title", "status"]) {
		if (!Object.hasOwn(record, key)) continue;
		const value = record[key];
		if (typeof value !== "string" || !value.trim() || value.length > (key === "status" ? 128 : 8192)) throw new Error(`Invalid task ${key}`);
	}
}

/** Archived links are hidden, not missing. Only read candidates for an unresolved reference. */
function archivedLink(root: string, store: string, archive: string, ref: string): boolean {
	const name = ref.startsWith(".trellis/tasks/") ? ref.slice(".trellis/tasks/".length) : ref;
	if (!/^[^/\\\x00-\x1f]+$/.test(name) && !/^archive\/\d{4}-\d{2}\/[^/\\\x00-\x1f]+$/.test(name)) return false;
	if (name === "." || name === ".." || name.endsWith("/.") || name.endsWith("/..")) return false;
	const identities = new Set<string>();
	const candidate = (dir: string) => {
		try { lstatSync(join(root, dir)); }
		catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return; throw error; }
		const task = resolveTaskPath(root, dir), identity = realpathSync(task);
		if (!containsPath(archive, identity)) return;
		const value: unknown = JSON.parse(readTextFile(regularTaskFile(task, "task.json"), 1024 * 1024, "task.json"));
		if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid archived task.json");
		validateRecord(value as Record<string, unknown>);
		identities.add(identity);
	};
	candidate(join(".trellis", "tasks", name));
	if (!name.includes("/")) {
		let months: string[];
		try { months = readdirSync(archive).sort(); }
		catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return identities.size === 1; throw error; }
		for (const month of months) {
			if (!/^\d{4}-\d{2}$/.test(month)) continue;
			const directory = realpathSync(join(archive, month));
			if (!containsPath(store, directory) || !containsPath(archive, directory)) throw new Error("Archive month escapes its archive/task store");
			if (statSync(directory).isDirectory()) candidate(join(".trellis", "tasks", "archive", month, name));
		}
	}
	if (identities.size > 1) throw new Error(`Ambiguous archived hierarchy link: ${diagnosticText(ref)}`);
	return identities.size === 1;
}

/** Read a browsing snapshot without widening task-store containment. */
export function readTasks(root: string, range: TaskBrowseRange = "active"): TaskSnapshot {
	const snapshot: TaskSnapshot = { tasks: [], rows: [], months: [], diagnostics: [], complete: true };
	const warn = (text: string) => {
		snapshot.complete = false;
		if (snapshot.diagnostics.length < MAX_DIAGNOSTICS) snapshot.diagnostics.push(safeText(text).slice(0, 320));
		else if (snapshot.diagnostics.length === MAX_DIAGNOSTICS) snapshot.diagnostics.push("Further diagnostics omitted; inspect the task store.");
	};
	const addTask = (store: string, archive: string, dir: string, identities: Map<string, BrowserTask>, aliases?: Map<string, BrowserTask>, container?: string) => {
		try {
			if (!statSync(join(root, dir)).isDirectory()) return;
			const task = resolveTaskPath(root, dir), identity = realpathSync(task);
			if (!containsPath(store, identity)) throw new Error("Task escapes its task store");
			if (container && !containsPath(container, identity)) throw new Error("Task escapes its selected archive month");
			if (range === "active" && containsPath(archive, identity)) return;
			const existing = identities.get(identity);
			if (existing) {
				const name = basename(dir); aliases?.set(name, existing); aliases?.set(dir, existing); return;
			}
			const value: unknown = JSON.parse(readTextFile(regularTaskFile(task, "task.json"), 1024 * 1024, "task.json"));
			if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid task.json");
			const record = value as Record<string, unknown>;
			validateRecord(record);
			const item: BrowserTask = { identity, dir, record, title: String(record.title ?? record.name ?? record.id ?? basename(dir)), status: typeof record.status === "string" ? record.status : "unknown" };
			identities.set(identity, item); aliases?.set(basename(dir), item); aliases?.set(dir, item); snapshot.tasks.push(item);
		} catch (error) { warn(`${dir}: ${diagnosticText(error)}`); }
	};
	try {
		const store = join(root, ".trellis", "tasks");
		const actualStore = realpathSync(store);
		let archive = join(actualStore, "archive");
		let archiveExists = true;
		try { lstatSync(archive); archive = realpathSync(archive); }
		catch (error) {
			if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
			archiveExists = false;
			try { lstatSync(archive); throw new Error("Archive path cannot be resolved"); }
			catch (probe) { if ((probe as NodeJS.ErrnoException).code !== "ENOENT") throw probe; }
		}
		if (range === "archive-months") {
			if (!archiveExists) return snapshot;
			for (const month of readdirSync(archive).sort().reverse()) {
				if (!/^\d{4}-\d{2}$/.test(month)) continue;
				try {
					const directory = realpathSync(join(archive, month));
					if (!containsPath(actualStore, directory) || !containsPath(archive, directory)) throw new Error("Archive month escapes its archive/task store");
					if (statSync(directory).isDirectory()) snapshot.months.push(month);
				} catch (error) { warn(`archive/${month}: ${diagnosticText(error)}`); }
			}
			return snapshot;
		}
		if (typeof range === "object") {
			if (!/^\d{4}-\d{2}$/.test(range.month)) { warn("Invalid archive month"); return snapshot; }
			if (!archiveExists) return snapshot;
			const directory = realpathSync(join(archive, range.month));
			if (!containsPath(actualStore, directory) || !containsPath(archive, directory) || !statSync(directory).isDirectory()) throw new Error("Archive month escapes its archive/task store");
			const identities = new Map<string, BrowserTask>();
			for (const name of readdirSync(directory).sort().reverse()) addTask(actualStore, archive, join(".trellis", "tasks", "archive", range.month, name), identities, undefined, directory);
			snapshot.rows = snapshot.tasks.map(task => ({ task, prefix: "" }));
			return snapshot;
		}
		const aliases = new Map<string, BrowserTask>(), identities = new Map<string, BrowserTask>();
		const isArchived = (ref: string) => archivedLink(root, actualStore, archive, ref);
		for (const name of readdirSync(store).sort().reverse()) {
			if (name !== "archive") addTask(actualStore, archive, join(".trellis", "tasks", name), identities, aliases);
		}
		snapshot.rows = projectTree(snapshot.tasks, aliases, isArchived, warn);
	} catch (error) { warn(`Unable to read task store: ${diagnosticText(error)}`); }
	return snapshot;
}

function projectTree(tasks: BrowserTask[], aliases: Map<string, BrowserTask>, isArchived: (ref: string) => boolean, warn: (text: string) => void): TaskRow[] {
	const parents = new Map<BrowserTask, BrowserTask>();
	const explicit = new Set<BrowserTask>();
	const link = (task: BrowserTask, ref: unknown): BrowserTask | undefined => {
		const target = typeof ref === "string" ? aliases.get(ref) : undefined;
		if (!target) {
			try { if (typeof ref === "string" && isArchived(ref)) return undefined; }
			catch (error) { warn(`${task.dir}: Invalid archived hierarchy link ${diagnosticText(ref)}: ${diagnosticText(error)}`); return undefined; }
			warn(`${task.dir}: Missing or invalid hierarchy link: ${diagnosticText(ref)}`);
		}
		else if (target === task) { warn(`${task.dir}: Self-referencing hierarchy link`); return undefined; }
		return target;
	};
	for (const task of tasks) {
		if (task.record.parent !== undefined && task.record.parent !== null && task.record.parent !== "") {
			explicit.add(task);
			const parent = link(task, task.record.parent);
			if (parent) parents.set(task, parent);
		}
	}
	const claims = new Map<BrowserTask, Set<BrowserTask>>();
	for (const task of tasks) {
		const children = task.record.children;
		if (children === undefined) continue;
		if (!Array.isArray(children)) { warn(`${task.dir}: Invalid children metadata`); continue; }
		if (children.length > 2048) warn(`${task.dir}: Further child links omitted`);
		for (const ref of children.slice(0, 2048)) {
			const child = link(task, ref);
			if (!child) continue;
			if (explicit.has(child)) {
				if (parents.get(child) !== task) warn(`${child.dir}: Conflicting parent/children links`);
			} else {
				const owners = claims.get(child) ?? new Set<BrowserTask>();
				owners.add(task); claims.set(child, owners);
			}
		}
	}
	for (const [child, owners] of claims) {
		if (owners.size === 1) parents.set(child, [...owners][0]);
		else warn(`${child.dir}: Conflicting child ownership; shown at top level`);
	}
	// Break each cycle deterministically, without losing any task or recursion overflow.
	const settled = new Set<BrowserTask>();
	for (const task of tasks) {
		const chain = new Set<BrowserTask>();
		let node: BrowserTask | undefined = task;
		while (node && !settled.has(node)) {
			if (chain.has(node)) { parents.delete(node); warn(`${node.dir}: Hierarchy cycle; shown at top level`); break; }
			chain.add(node); node = parents.get(node);
		}
		for (const item of chain) settled.add(item);
	}
	const children = new Map<BrowserTask, BrowserTask[]>();
	for (const task of tasks) {
		const parent = parents.get(task);
		if (parent) { const group = children.get(parent) ?? []; group.push(task); children.set(parent, group); }
	}
	const rows: TaskRow[] = [];
	const stack = tasks.filter(task => !parents.has(task)).reverse().map(task => ({ task, prefix: "", ancestors: "" }));
	while (stack.length) {
		const row = stack.pop()!;
		rows.push({ task: row.task, prefix: row.prefix });
		const group = children.get(row.task) ?? [];
		for (let i = group.length - 1; i >= 0; i--) {
			const last = i === group.length - 1;
			stack.push({ task: group[i], prefix: row.ancestors + (last ? "└─ " : "├─ "), ancestors: row.ancestors + (last ? "   " : "│  ") });
		}
	}
	return rows;
}

export function readDocument(root: string, task: BrowserTask, section: DocumentSection): TaskDocument {
	let directory: string;
	try {
		directory = resolveTaskPath(root, task.dir);
		if (realpathSync(directory) !== task.identity) return { state: "removed" };
	} catch (error) {
		return (error as NodeJS.ErrnoException).code === "ENOENT" ? { state: "removed" } : { state: "error", diagnostic: diagnosticText(error) };
	}
	try {
		// lstat distinguishes an absent document from a dangling/escaping symlink.
		try { lstatSync(join(directory, `${section}.md`)); }
		catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return { state: "missing" }; throw error; }
		const file = regularTaskFile(directory, `${section}.md`);
		const text = safeText(readTextFile(file, MAX_DOCUMENT_BYTES, "Document"), true);
		return { state: text.trim() ? "ready" : "empty", text };
	} catch (error) { return { state: "error", diagnostic: diagnosticText(error) }; }
}

export function taskLabel(task: BrowserTask): string {
	const name = safeText(basename(task.dir));
	const title = safeText(task.title || name);
	return title === name ? name : `${name} · ${title}`;
}
