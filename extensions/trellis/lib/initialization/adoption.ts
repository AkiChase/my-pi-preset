import { closeSync, lstatSync, mkdirSync, openSync, readFileSync, readdirSync, unlinkSync } from "node:fs";
import { dirname } from "node:path";
import { checkedPath, defaultTemplates, digest, inspect, journalAttributes, packageResources, packageRoot, projectRevision, replaceBlock, template, validateManifest, verifyRuntime, type Fingerprint, type InstalledManifest } from "./engine.ts";
import { atomicFile, equal, read, stamp } from "./resources.ts";

const MANIFEST = ".trellis/.pi-trellis.json", LOCK = ".trellis/.runtime/init.lock", OPERATION = ".trellis/.runtime/init-operation.json";
export interface AdoptPlan {
 root: string; releaseId: string;
 rows: { path: string; state: string }[];
 changes: { path: string; data: Buffer; mode: number; before: Fingerprint | null }[];
 guards: Record<string, Fingerprint | null>;
 manifest: InstalledManifest;
 legacy: string[];
}
export function adoptPlan(rootInput: string): AdoptPlan {
 const state = inspect(rootInput), root = state.root;
 if (state.state !== "unsupported" || state.diagnostics.some(d => d.includes("lock exists"))) throw new Error(`Adoption requires an existing manifest-less source project. ${state.diagnostics.join(" ")}`);
 if (read(root, MANIFEST) || read(root, OPERATION)) throw new Error("Existing manifest or initialization operation requires explicit reconciliation before adoption");
 // An existing lock is never removed or guessed stale, independently of the inspection diagnostic text.
 try { lstatSync(checkedPath(root, LOCK)); throw new Error("Initialization lock exists; inspect its owner before adopting"); }
 catch (e) { if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e; }
 const value: AdoptPlan = { root, releaseId: state.releaseId, rows: [], changes: [], guards: { [MANIFEST]: null, [OPERATION]: null }, manifest: { schemaVersion: 2, runtimeReleaseId: state.releaseId, files: packageResources(), templates: {} }, legacy: [] };
 const revision = projectRevision(root);
 function add(path: string, data: Buffer, mode: number, label: string) {
  const before = stamp(root, path); value.guards[path] = before;
  const same = equal(before, { sha256: digest(data), mode });
  value.rows.push({ path, state: same ? "Current" : label });
  if (!same) value.changes.push({ path, data, mode, before });
 }
 for (const [path, want] of Object.entries(value.manifest.files)) {
  const data = readFileSync(checkedPath(packageRoot, want.source));
  if (digest(data) !== want.sha256) throw new Error(`Package hash mismatch: ${path}`);
  add(path, data, want.mode, stamp(root, path) ? "Replace" : "Install");
 }
 for (const [path, want] of Object.entries(defaultTemplates())) {
  const actual = stamp(root, path); value.guards[path] = actual;
  if (actual) {
   value.rows.push({ path, state: "Preserve" });
   value.manifest.templates[path] = { ...actual, origin: "preserved-project", source: { kind: "project-snapshot", revision } };
  } else {
   add(path, readFileSync(checkedPath(packageRoot, want.source)), want.mode, "Create");
   value.manifest.templates[path] = want;
  }
 }
 for (const [path, source, start, end] of [["AGENTS.md", "agents-block.md", "<!-- TRELLIS:START -->", "<!-- TRELLIS:END -->"], [".gitignore", "root.gitignore-block.txt", "# pi-trellis:ignore:start", "# pi-trellis:ignore:end"]]) {
  const before = stamp(root, path), existing = read(root, path);
  add(path, replaceBlock(existing, template(source), start, end), before?.mode ?? 0o644, existing?.includes(start) ? "Replace block" : before ? "Append block" : "Create");
 }
 add(".gitattributes", journalAttributes(read(root, ".gitattributes"), template("journal.gitattributes")), stamp(root, ".gitattributes")?.mode ?? 0o644, "Append journal attribute");
 function legacy(path: string) { value.legacy.push(path); }
 for (const path of [".trellis/.version", ".trellis/.template-hashes.json", ".pi/.pi-trellis-hashes.json", ".trellis/agents"]) {
  try { lstatSync(checkedPath(root, path)); legacy(path); } catch (e) { if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e; }
 }
 let visited = 0;
 function scan(path: string, depth = 0) {
  if (depth > 32) throw new Error("Legacy script inventory exceeds safety bound; inspect manually");
  try {
   for (const entry of readdirSync(checkedPath(root, path), { withFileTypes: true })) {
    if (++visited > 4096) throw new Error("Legacy script inventory exceeds safety bound; inspect manually");
    const child = `${path}/${entry.name}`;
    if (entry.isSymbolicLink()) { legacy(child); continue; }
    if (entry.isDirectory()) scan(child, depth + 1);
    else if (!Object.hasOwn(value.manifest.files, child)) legacy(child);
   }
  } catch (e) { if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e; }
 }
 scan(".trellis/scripts");
 // The authoritative validator must accept the manifest before any write, not only after publication.
 validateManifest(value.manifest);
 return value;
}
function signature(value: AdoptPlan): string { return digest(JSON.stringify({ ...value, changes: value.changes.map(c => ({ ...c, data: c.data.toString("base64") })) })); }
export function adoptionSummary(value: AdoptPlan): string {
 return [`Project: ${value.root}`, "Adopt existing project", ...value.rows.map(r => `${r.state}  ${r.path}`), ...value.legacy.slice(0, 256).map(path => `Legacy — left in place: ${path}`), ...(value.legacy.length > 256 ? [`${value.legacy.length - 256} additional legacy paths omitted.`] : []), ...ADOPTION_NOTES].join("\n");
}
const ADOPTION_NOTES = ["Runtime scripts, roles and managed root blocks are replaced without backups. Nothing is deleted.", "Existing workflow, config, spec, tasks, journals and identity are preserved."];
/** Native dialogs render every title line without a viewport, so confirmation stays counted, not enumerated. */
export function adoptionDialog(value: AdoptPlan): string {
 const counts = new Map<string, number>();
 for (const row of value.rows) counts.set(row.state, (counts.get(row.state) ?? 0) + 1);
 const field = (key: string, text: string) => `${(key + ":").padEnd(11)}${text}`;
 return ["Confirm · Adopt project", field("Project", value.root.replace(/[\p{C}\p{Zl}\p{Zp}]/gu, char => `\\u{${char.codePointAt(0)!.toString(16)}}`)),
  field("Changes", [...counts].map(([state, count]) => `${state} ${count}`).join(" · ") || "none"),
  field("Keeps", "workflow, config, spec, tasks, journals and identity"),
  field("Backup", "none — runtime scripts, roles and managed root blocks are replaced; nothing is deleted"),
  field("Legacy", `${value.legacy.length} path${value.legacy.length === 1 ? "" : "s"} left in place`)].join("\n");
}
export function applyAdoptPlan(value: AdoptPlan, options: { afterWrite?: (path: string) => void } = {}) {
 const fresh = adoptPlan(value.root);
 if (signature(value) !== signature(fresh)) throw new Error("Project or package changed since adoption preview; review again");
 const root = fresh.root, lock = checkedPath(root, LOCK), templatesBefore = JSON.stringify(defaultTemplates());
 mkdirSync(dirname(lock), { recursive: true }); checkedPath(root, LOCK);
 const fd = openSync(lock, "wx", 0o600); closeSync(fd);
 try {
  // Rebuild under our lock without asking inspect() to accept an external lock.
  const guard = (path: string, want: Fingerprint | null) => { if (!equal(stamp(root, path), want)) throw new Error(`Concurrent change preserved: ${path}`); };
  const outputs = new Map<string, Fingerprint>();
  const recheck = () => { for (const [path, before] of Object.entries(fresh.guards)) guard(path, outputs.get(path) ?? before); };
  recheck();
  for (const change of fresh.changes) {
   recheck();
   atomicFile(root, change.path, change.data, change.mode, change.before);
   outputs.set(change.path, { sha256: digest(change.data), mode: change.mode });
   options.afterWrite?.(change.path);
  }
  recheck();
  // Validate package identity and all managed outputs immediately before publishing.
  if (JSON.stringify(packageResources()) !== JSON.stringify(fresh.manifest.files) || JSON.stringify(defaultTemplates()) !== templatesBefore) throw new Error("Package changed during adoption");
  for (const [path, record] of Object.entries(fresh.manifest.files)) guard(path, record);
  atomicFile(root, MANIFEST, Buffer.from(JSON.stringify(fresh.manifest, null, 2) + "\n"), 0o644, null);
  if (!verifyRuntime(root)) throw new Error("Adoption runtime did not verify");
  const result = inspect(root);
  if (!["ready", "supported"].includes(result.state)) throw new Error("Adoption result did not verify");
  return result;
 } catch (error) { throw new Error(`${String(error)}\nPartial files are preserved; no backups or rollback. If no manifest was published, review /trellis-init and confirm adoption again.`, { cause: error }); }
 // Only the lock created above is released; a missing lock must not mask the original failure.
 finally { try { unlinkSync(checkedPath(root, LOCK)); } catch (e) { if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e; } }
}
