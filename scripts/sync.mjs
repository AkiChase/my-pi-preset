#!/usr/bin/env node
// Reconcile the pi packages declared in pi-packages.json with the packages
// currently installed for the user. Changes are applied through the `pi` CLI
// (`pi install` / `pi update` / `pi remove`) so pi stays the only writer of its
// own settings.
//
// Usage:
//   node scripts/sync.mjs [--manifest <path>] [--prune] [--dry-run]

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

const UNPINNED = new Set(["", "*", "latest"]);
const ANSI = /\u001B\[[0-9;]*m/g;
const COMMAND_TIMEOUT_MS = 10 * 60 * 1000;

// A tool shim (a terminal app's launcher, for example) can sit earlier on PATH
// than pi itself and hijack these calls. Prefer an explicit path when one is
// known, so package commands always reach the real pi.
function resolvePiCommand() {
  const fromEnv = process.env.PI_BIN?.trim();
  if (fromEnv) return fromEnv;

  const agentDir = process.env.PI_CODING_AGENT_DIR?.trim() || join(homedir(), ".pi", "agent");
  const managed = join(agentDir, "bin", "pi");
  if (existsSync(managed)) return managed;

  return "pi";
}

const PI = resolvePiCommand();
const NPM_SOURCE = /^npm:(.+)$/;
const GIT_SOURCE = /^(git:|https:\/\/|ssh:\/\/|git:\/\/)/;

function fail(message) {
  console.error(`  ! ${message}`);
  process.exit(1);
}

// Progress goes to stderr so `--dry-run` output stays pipeable on stdout.
function step(n, total, message) {
  console.error(total ? `[${n}/${total}] ${message}` : `[${n}] ${message}`);
}

function info(message) {
  console.error(`  ${message}`);
}

// "npm:@scope/name@1.2.3" -> { name: "@scope/name", version: "1.2.3" }
function parseNpmSpec(spec) {
  const match = spec.match(/^(@?[^@]+(?:\/[^@]+)?)(?:@(.+))?$/);
  if (!match) return { name: spec, version: undefined };
  return { name: match[1] ?? spec, version: match[2] };
}

// Reduce a git source to "host/path", ignoring the ref and the URL style, so a
// manifest entry and an installed entry compare equal across ssh/https forms.
function parseGitSpec(spec) {
  let value = spec.replace(/^git:/, "");
  value = value.replace(/^(https?|ssh|git):\/\//i, "");
  value = value.replace(/^git@([^:/]+):/, "$1/");
  const at = value.lastIndexOf("@");
  const slash = value.indexOf("/");
  if (at > slash && slash >= 0) value = value.slice(0, at);
  value = value.replace(/^[^/@]+@/, "");
  return value.replace(/\.git$/, "").replace(/\/+$/, "").toLowerCase();
}

function identityOf(source) {
  const npm = source.match(NPM_SOURCE);
  if (npm) return `npm:${parseNpmSpec(npm[1]).name}`;
  if (GIT_SOURCE.test(source)) return `git:${parseGitSpec(source)}`;
  return `local:${resolve(source)}`;
}

// A pinned npm version ("1.2.3") is never moved by `pi update`; a range or a
// missing version is.
function isPinnedNpm(source) {
  const npm = source.match(NPM_SOURCE);
  if (!npm) return false;
  const { version } = parseNpmSpec(npm[1]);
  return Boolean(version) && !UNPINNED.has(version);
}

function isPinned(source) {
  if (isPinnedNpm(source)) return true;
  // A git ref is part of the source string, so a ref change shows up as a
  // different source and is handled as an install.
  return false;
}

function readManifest(path) {
  step(1, undefined, `reading manifest ${path}`);
  let raw;
  try {
    raw = readFileSync(path, "utf8");
  } catch (error) {
    fail(`cannot read manifest ${path}: ${error.message}`);
  }

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    fail(`manifest ${path} is not valid JSON: ${error.message}`);
  }

  const packages = parsed?.packages;
  if (!packages || typeof packages !== "object" || Array.isArray(packages)) {
    fail(`manifest ${path} must have an object "packages" field`);
  }

  const entries = Object.entries(packages).map(([source, version]) => {
    if (/^-/.test(source) || !(NPM_SOURCE.test(source) || GIT_SOURCE.test(source))) {
      fail(`unsupported source "${source}": use "npm:<name>" or "git:<host>/<path>"`);
    }
    const value = String(version ?? "").trim();
    if (/^-/.test(value) || /\s/.test(value)) {
      fail(`invalid version "${value}" for "${source}"`);
    }
    return UNPINNED.has(value) ? source : `${source}@${value}`;
  });

  const rawConflicts = parsed?.conflicts ?? [];
  if (!Array.isArray(rawConflicts)) {
    fail(`manifest ${path} field "conflicts" must be an array of sources`);
  }
  const conflicts = rawConflicts.map((source) => {
    if (typeof source !== "string" || !(NPM_SOURCE.test(source) || GIT_SOURCE.test(source))) {
      fail(`unsupported conflict source "${source}": use "npm:<name>" or "git:<host>/<path>"`);
    }
    if (entries.some((entry) => identityOf(entry) === identityOf(source))) {
      fail(`"${source}" is listed in both "packages" and "conflicts"`);
    }
    return source;
  });

  info(`${entries.length} declared: ${entries.join(", ")}`);
  if (conflicts.length > 0) info(`${conflicts.length} must not be installed: ${conflicts.join(", ")}`);
  return { desired: entries, conflicts };
}

// Parse `pi list`, which prints two-space indented sources with an optional
// four-space indented install path underneath.
function readInstalled() {
  step(2, undefined, "reading installed packages (pi list)");
  const result = spawnSync(PI, ["list"], { encoding: "utf8", timeout: COMMAND_TIMEOUT_MS });
  if (result.error) {
    const detail = result.error.code === "ETIMEDOUT" ? `timed out after ${COMMAND_TIMEOUT_MS / 1000}s` : result.error.message;
    fail(`cannot run pi: ${detail}`);
  }
  if (result.status !== 0) {
    fail(`pi list failed with exit code ${result.status}`);
  }

  const entries = [];
  let inUserScope = false;
  let current = null;

  for (const rawLine of result.stdout.replace(ANSI, "").split(/\r?\n/)) {
    if (rawLine.trim() === "User packages:") {
      inUserScope = true;
      continue;
    }
    if (rawLine.trim() === "Project packages:") {
      inUserScope = false;
      continue;
    }
    if (!inUserScope || rawLine.trim() === "") continue;

    if (/^\s{4}\S/.test(rawLine)) {
      if (current) current.installedPath = rawLine.trim();
      continue;
    }
    if (/^\s{2}\S/.test(rawLine)) {
      current = { source: rawLine.trim().replace(/ \(filtered\)$/, ""), installedPath: undefined };
      entries.push(current);
    }
  }

  info(`${entries.length} installed for the user`);
  return entries;
}

function buildPlan(desired, installed, prune, conflicts = []) {
  step(3, undefined, "comparing manifest with installed packages");
  const byIdentity = new Map(installed.map((entry) => [identityOf(entry.source), entry]));
  const steps = [];
  const claimed = new Set();

  // Packages this repo bundles as its own npm dependencies and loads itself. Leaving
  // them installed as pi packages registers their tools twice, which pi rejects as a
  // conflict, so they are removed even in merge mode.
  const conflicting = new Set(conflicts.map(identityOf));
  const removedAsConflict = new Set();
  for (const entry of installed) {
    const identity = identityOf(entry.source);
    if (!conflicting.has(identity)) continue;
    removedAsConflict.add(identity);
    steps.push({ action: "remove", source: entry.source, reason: "bundled by this repo; must not be a pi package" });
  }

  for (const source of desired) {
    const identity = identityOf(source);
    const existing = byIdentity.get(identity);
    if (existing) claimed.add(identity);

    if (!existing) {
      steps.push({ action: "install", source, reason: "not installed" });
    } else if (existing.source !== source) {
      steps.push({ action: "install", source, reason: `different version: ${existing.source}` });
    } else if (!existing.installedPath) {
      steps.push({ action: "install", source, reason: "declared but missing on disk" });
    } else if (isPinned(source)) {
      steps.push({ action: "keep", source, reason: "pinned version" });
    } else {
      steps.push({ action: "update", source, reason: "latest" });
    }
  }

  for (const entry of installed) {
    const identity = identityOf(entry.source);
    if (claimed.has(identity) || removedAsConflict.has(identity)) continue;
    steps.push(
      prune
        ? { action: "remove", source: entry.source, reason: "not in manifest" }
        : { action: "keep", source: entry.source, reason: "not in manifest (merge mode)" },
    );
  }

  return steps;
}

function run(action, source) {
  const args = action === "install" ? ["install", source] : action === "remove" ? ["remove", source] : ["update", source];
  info(`running: ${PI} ${args.join(" ")}`);
  const started = Date.now();
  const result = spawnSync(PI, args, { stdio: "inherit", timeout: COMMAND_TIMEOUT_MS });
  const seconds = ((Date.now() - started) / 1000).toFixed(1);
  if (result.error) {
    if (result.error.code === "ETIMEDOUT") return `timed out after ${COMMAND_TIMEOUT_MS / 1000}s`;
    return `cannot run pi: ${result.error.message} (after ${seconds}s)`;
  }
  if (result.status !== 0) return `pi ${args.join(" ")} exited with ${result.status} (after ${seconds}s)`;
  return undefined;
}

const { values } = parseArgs({
  options: {
    manifest: { type: "string" },
    prune: { type: "boolean", default: false },
    "dry-run": { type: "boolean", default: false },
    help: { type: "boolean", default: false },
  },
});

if (values.help) {
  console.log(`Usage: node scripts/sync.mjs [options]

  --manifest <path>  Manifest to apply (default: pi-packages.json next to this script's parent)
  --prune            Remove user packages that are not in the manifest
  --dry-run          Print the plan without changing anything`);
  process.exit(0);
}

const scriptDir = dirname(fileURLToPath(import.meta.url));
const manifestPath = values.manifest ? resolve(values.manifest) : join(scriptDir, "..", "pi-packages.json");

const { desired, conflicts } = readManifest(manifestPath);
const installed = readInstalled();
const plan = buildPlan(desired, installed, values.prune, conflicts);

console.error(`      mode  ${values.prune ? "prune (manifest is authoritative)" : "merge (keeps other packages)"}`);
console.error("");

const labels = { install: "install", update: "update ", remove: "remove ", keep: "keep   " };
for (const entry of plan) {
  console.error(`      ${labels[entry.action]} ${entry.source}${entry.reason ? `  (${entry.reason})` : ""}`);
}

const counts = plan.reduce((acc, entry) => ({ ...acc, [entry.action]: (acc[entry.action] ?? 0) + 1 }), {});
console.error("");
console.error(
  `      ${Object.entries(counts)
    .map(([action, count]) => `${count} ${action}`)
    .join(", ") || "nothing to do"}`,
);

if (values["dry-run"]) {
  console.error("");
  console.error("Dry run: nothing was changed.");
  process.exit(0);
}

const stepsToRun = plan.filter((entry) => entry.action !== "keep");

if (stepsToRun.length === 0) {
  console.error("");
  console.error("Already up to date. Nothing to do.");
  process.exit(0);
}

console.error("");

const failures = [];
let index = 0;
for (const action of ["install", "update", "remove"]) {
  for (const entry of plan.filter((candidate) => candidate.action === action)) {
    index += 1;
    step(index, stepsToRun.length, `${action} ${entry.source}`);
    const message = run(action, entry.source);
    if (message) {
      console.error(`  failed: ${message}`);
      failures.push(`${entry.source}: ${message}`);
    } else {
      info("ok");
    }
  }
}

console.error("");
if (failures.length > 0) {
  console.error(`${failures.length} of ${stepsToRun.length} steps failed.`);
  process.exit(1);
}
console.error(`Done. ${stepsToRun.length} package(s) reconciled. Run /reload in pi, or restart it, to pick up changes.`);
