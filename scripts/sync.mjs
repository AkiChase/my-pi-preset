#!/usr/bin/env node
// Reconcile this machine with the preset declared in pi-preset.json.
//
// Four domains, each selected independently and each running in one of two
// modes:
//
//   packages     -> `pi install` / `pi update` / `pi remove`
//   settings     -> <agent-dir>/settings.json
//   keybindings  -> <agent-dir>/keybindings.json
//   files        -> <agent-dir>/<name>.json, one per extension that reads one
//
//   merge (default)  only the declared entries are aligned; anything the
//                    manifest does not mention is left alone. A declared
//                    `null` is the only way to remove something.
//   prune            the manifest is the whole truth for that domain; entries
//                    it does not declare are removed.
//
// Usage:
//   node scripts/sync.mjs [--manifest <path>] [--dev] [--sync <domains>] [--prune [<domains>]] [--dry-run]

import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, realpathSync, renameSync, rmSync, rmdirSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

const UNPINNED = new Set(["", "*", "latest"]);
const ANSI = /\u001B\[[0-9;]*m/g;
const COMMAND_TIMEOUT_MS = 10 * 60 * 1000;

const DOMAINS = ["packages", "settings", "keybindings", "files"];
const SELF_IDENTITY = "git:github.com/akichase/my-pi-preset";

// pi owns these two keys in settings.json: `packages` is maintained by
// `pi install` / `pi remove`, `lastChangelogVersion` is pi's own state. They
// can be neither declared nor pruned.
const PI_OWNED_SETTINGS = new Set(["packages", "lastChangelogVersion"]);

// The `files` domain writes extension config files in the agent directory, so
// it must be a plain file name there -- no directory part, no traversal.
// `~/.config/...` configs (rpiv-ask-user-question) are deliberately out of
// scope: a second root would need its own XDG resolution.
const FILE_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]*\.json$/;

// Files `files` must not touch, each for its own reason:
//   settings.json / keybindings.json  have their own domain
//   auth.json                         credentials, never in a git manifest
//   trust.json / models-store.json    pi's own per-machine state
//   models.json                       pi-cache-optimizer rewrites it under its
//                                     own transaction lock, which a leaf patch
//                                     from here would race
const UNMANAGEABLE_FILES = new Map([
  ["settings.json", 'use the "settings" domain'],
  ["keybindings.json", 'use the "keybindings" domain'],
  ["auth.json", "holds credentials"],
  ["trust.json", "is pi's per-machine state"],
  ["models-store.json", "is pi's per-machine state"],
  ["models.json", "is rewritten by pi-cache-optimizer under its own lock"],
]);

function resolveAgentDir() {
  return process.env.PI_CODING_AGENT_DIR?.trim() || join(homedir(), ".pi", "agent");
}

// A tool shim (a terminal app's launcher, for example) can sit earlier on PATH
// than pi itself and hijack these calls. Prefer an explicit path when one is
// known, so package commands always reach the real pi.
function resolvePiCommand() {
  const fromEnv = process.env.PI_BIN?.trim();
  if (fromEnv) return fromEnv;

  const managed = join(resolveAgentDir(), "bin", "pi");
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
let stepNumber = 0;
function step(message, total) {
  stepNumber += 1;
  console.error(total ? `[${stepNumber}/${total}] ${message}` : `[${stepNumber}] ${message}`);
}

function info(message) {
  console.error(`  ${message}`);
}

function isPlainObject(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function deepEqual(a, b) {
  if (a === b) return true;
  if (a === null || b === null || typeof a !== "object" || typeof b !== "object") return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a)) return a.length === b.length && a.every((item, index) => deepEqual(item, b[index]));
  const keys = Object.keys(a);
  return keys.length === Object.keys(b).length && keys.every((key) => Object.hasOwn(b, key) && deepEqual(a[key], b[key]));
}

// ---------------------------------------------------------------------------
// Key paths
//
// A settings path is a list of segments. The dotted string form is just a
// convenience: some real setting keys contain dots (`modelThinkingLevels` is
// keyed by `provider/model-4.1`), so those must be written as an explicit
// segment array instead.
// ---------------------------------------------------------------------------

function splitPath(value, label) {
  if (Array.isArray(value)) {
    if (value.length === 0 || !value.every((segment) => typeof segment === "string" && segment.length > 0)) {
      fail(`${label} must be a non-empty array of non-empty strings`);
    }
    return value;
  }
  if (typeof value !== "string" || value.length === 0) {
    fail(`${label} must be a key path, either "a.b" or ["a", "b"]`);
  }
  const segments = value.split(".");
  if (segments.some((segment) => segment.length === 0)) fail(`${label} has an empty path segment: "${value}"`);
  return segments;
}

function formatPath(segments) {
  return segments.join(".");
}

function isPrefix(shorter, longer) {
  return shorter.length <= longer.length && shorter.every((segment, index) => segment === longer[index]);
}

function overlaps(a, b) {
  return isPrefix(a, b) || isPrefix(b, a);
}

function getPath(root, segments) {
  let node = root;
  for (const segment of segments) {
    if (!isPlainObject(node) || !Object.hasOwn(node, segment)) return { found: false, value: undefined };
    node = node[segment];
  }
  return { found: true, value: node };
}

function setPath(root, segments, value) {
  let node = root;
  for (const segment of segments.slice(0, -1)) {
    // A scalar standing where an object is needed is replaced, which is what
    // declaring a deeper path under it asks for.
    if (!isPlainObject(node[segment])) node[segment] = {};
    node = node[segment];
  }
  node[segments[segments.length - 1]] = value;
}

function unsetPath(root, segments) {
  const chain = [];
  let node = root;
  for (const segment of segments.slice(0, -1)) {
    if (!isPlainObject(node) || !Object.hasOwn(node, segment)) return false;
    chain.push([node, segment]);
    node = node[segment];
  }
  const last = segments[segments.length - 1];
  if (!isPlainObject(node) || !Object.hasOwn(node, last)) return false;
  delete node[last];
  // A section left empty by the removal is removed too, so pruning does not
  // leave `"retry": {}` behind.
  for (let index = chain.length - 1; index >= 0; index -= 1) {
    const [parent, key] = chain[index];
    if (isPlainObject(parent[key]) && Object.keys(parent[key]).length === 0) delete parent[key];
    else break;
  }
  return true;
}

// Walk to the leaves. Arrays and scalars are leaves, so they are always
// replaced whole. `emptyObjectsAreLeaves` is on for the machine's file, where a
// leftover empty section is something prune should clean up, and off for the
// manifest, where `"retry": {}` declares nothing.
export function leafEntries(root, { emptyObjectsAreLeaves }) {
  const entries = [];
  const walk = (node, prefix) => {
    for (const [key, value] of Object.entries(node)) {
      const path = [...prefix, key];
      if (isPlainObject(value) && (Object.keys(value).length > 0 || !emptyObjectsAreLeaves)) walk(value, path);
      else entries.push({ path, value });
    }
  };
  walk(root, []);
  return entries;
}

// ---------------------------------------------------------------------------
// Manifest
// ---------------------------------------------------------------------------

function readManifest(path) {
  step(`reading manifest ${path}`);
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
  if (!packages || !isPlainObject(packages)) {
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

  const settings = parsed?.settings ?? {};
  if (!isPlainObject(settings)) fail(`manifest ${path} field "settings" must be an object`);
  // The settings block mirrors settings.json, so nesting is the only way to go
  // deeper. A dot in a top-level key would silently create a key pi ignores.
  // Deeper keys may contain dots, because real ones do (`modelThinkingLevels`
  // is keyed by `provider/model-4.1`).
  for (const key of Object.keys(settings)) {
    if (key.includes(".")) {
      fail(`"settings.${key}" looks like a path; nest objects instead: {"${key.split(".")[0]}": {"${key.split(".").slice(1).join(".")}": …}}`);
    }
  }
  const declaredSettings = leafEntries(settings, { emptyObjectsAreLeaves: false });
  for (const entry of declaredSettings) {
    if (PI_OWNED_SETTINGS.has(entry.path[0])) {
      fail(`"settings.${formatPath(entry.path)}" is maintained by pi itself and cannot be declared`);
    }
  }

  const keybindings = parsed?.keybindings ?? {};
  if (!isPlainObject(keybindings)) fail(`manifest ${path} field "keybindings" must be an object`);
  for (const [action, value] of Object.entries(keybindings)) {
    const ok =
      value === null ||
      (typeof value === "string" && value.length > 0) ||
      (Array.isArray(value) && value.every((key) => typeof key === "string" && key.length > 0));
    if (!ok) fail(`keybinding "${action}" must be a key, an array of keys, [] to disable, or null to drop it`);
  }
  const declaredKeybindings = Object.entries(keybindings).map(([action, value]) => ({ path: [action], value }));

  // One block per extension config file in the agent directory. Same leaf
  // semantics as `settings`, so a file this repo does not fully own can still
  // have one key declared.
  const rawFiles = parsed?.files ?? {};
  if (!isPlainObject(rawFiles)) fail(`manifest ${path} field "files" must be an object keyed by file name`);
  const declaredFiles = Object.entries(rawFiles).map(([name, block]) => {
    if (!FILE_NAME.test(name)) {
      fail(`"files.${name}" must be a plain "<name>.json" file name in the agent directory`);
    }
    const reason = UNMANAGEABLE_FILES.get(name);
    if (reason) fail(`"files.${name}" cannot be managed here: ${name} ${reason}`);
    if (!isPlainObject(block)) fail(`"files.${name}" must be an object mirroring that file`);
    for (const key of Object.keys(block)) {
      if (key.includes(".")) {
        fail(`"files.${name}.${key}" looks like a path; nest objects instead`);
      }
    }
    return { file: name, declared: leafEntries(block, { emptyObjectsAreLeaves: false }) };
  });

  const rawPreserve = parsed?.preserve ?? {};
  if (!isPlainObject(rawPreserve)) {
    fail(`manifest ${path} field "preserve" must be an object with "settings", "keybindings" and/or "files" entries`);
  }
  for (const key of Object.keys(rawPreserve)) {
    if (key !== "settings" && key !== "keybindings" && key !== "files") {
      fail(`"preserve.${key}" is not a domain; use "settings", "keybindings" or "files"`);
    }
  }
  const preserve = { settings: [], keybindings: [], files: {} };
  for (const domain of ["settings", "keybindings"]) {
    const list = rawPreserve[domain] ?? [];
    if (!Array.isArray(list)) fail(`"preserve.${domain}" must be an array`);
    preserve[domain] = list.map((value, index) => {
      // keybindings.json is flat and its action ids contain dots, so an entry
      // there is one literal key, never a dotted path.
      if (domain === "keybindings") {
        if (typeof value !== "string" || value.length === 0) fail(`"preserve.keybindings[${index}]" must be an action id`);
        return [value];
      }
      return splitPath(value, `"preserve.settings[${index}]"`);
    });
  }
  for (const entry of preserve.settings) {
    if (PI_OWNED_SETTINGS.has(entry[0])) continue; // already protected, harmless to list
    const clash = declaredSettings.find((declared) => overlaps(entry, declared.path));
    if (clash) fail(`"${formatPath(entry)}" is both declared in "settings" and listed in "preserve.settings"`);
  }
  for (const entry of preserve.keybindings) {
    if (declaredKeybindings.some((declared) => declared.path[0] === entry[0])) {
      fail(`"${entry[0]}" is both declared in "keybindings" and listed in "preserve.keybindings"`);
    }
  }

  // `preserve.files` is keyed by file name, because prune only ever reaches a
  // file the manifest declares. Preserving a key in a file nobody declares
  // would protect it from nothing, so it is a manifest error rather than a
  // silently useless entry.
  const rawPreserveFiles = rawPreserve.files ?? {};
  if (!isPlainObject(rawPreserveFiles)) {
    fail(`"preserve.files" must be an object keyed by file name, each value an array of key paths`);
  }
  for (const [name, list] of Object.entries(rawPreserveFiles)) {
    const target = declaredFiles.find((entry) => entry.file === name);
    if (!target) fail(`"preserve.files.${name}" names a file that "files" does not declare`);
    if (!Array.isArray(list)) fail(`"preserve.files.${name}" must be an array`);
    preserve.files[name] = list.map((value, index) => splitPath(value, `"preserve.files.${name}[${index}]"`));
    for (const entry of preserve.files[name]) {
      const clash = target.declared.find((declared) => overlaps(entry, declared.path));
      if (clash) fail(`"${formatPath(entry)}" in ${name} is both declared and preserved`);
    }
  }

  info(`${entries.length} packages declared: ${entries.join(", ")}`);
  if (conflicts.length > 0) info(`${conflicts.length} must not be installed: ${conflicts.join(", ")}`);
  info(`${declaredSettings.length} settings key(s) declared, ${declaredKeybindings.length} keybinding(s) declared`);
  if (declaredFiles.length > 0) {
    const summary = declaredFiles.map((entry) => `${entry.file} (${entry.declared.length})`).join(", ");
    info(`${declaredFiles.length} extension config file(s) declared: ${summary}`);
  }

  return { desired: entries, conflicts, declaredSettings, declaredKeybindings, declaredFiles, preserve };
}

// The local override is deliberately outside readManifest: arbitrary local
// sources in a published manifest must remain invalid. Derive the root from
// this script, not cwd or --manifest, so a downloaded script cannot register
// its temporary directory as a package.
function checkoutRoot() {
  const root = resolve(dirname(realpathSync(fileURLToPath(import.meta.url))), "..");
  try {
    const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
    if (
      pkg.name !== "my-pi-preset" ||
      !isPlainObject(pkg.pi) ||
      !Array.isArray(pkg.pi.extensions) ||
      !pkg.pi.extensions.includes("extensions/*.ts") ||
      !existsSync(join(root, ".git")) ||
      !statSync(join(root, "extensions")).isDirectory() ||
      !statSync(join(root, "install.sh")).isFile() ||
      !statSync(join(root, "pi-preset.json")).isFile()
    ) return undefined;
    return root;
  } catch {
    return undefined;
  }
}

function selfPackageMode(manifest, dev) {
  const root = checkoutRoot();
  if (dev && !root) fail("--dev requires a local my-pi-preset git checkout with package.json and its pi manifest");
  const selfEntries = manifest.desired.filter((source) => identityOf(source) === SELF_IDENTITY);
  if (dev && selfEntries.length !== 1) fail("--dev requires exactly one my-pi-preset git source in packages");
  if (!root || selfEntries.length !== 1) return undefined;
  if (dev) {
    manifest.desired = manifest.desired.map((source) => source === selfEntries[0] ? root : source);
    info(`dev source: ${root} (third-party sources unchanged)`);
  }
  return { root, dev };
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

// ---------------------------------------------------------------------------
// packages
// ---------------------------------------------------------------------------

// Parse `pi list`, which prints two-space indented sources with an optional
// four-space indented install path underneath.
function readInstalled() {
  step("reading installed packages (pi list)");
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

export function buildPackagePlan(desired, installed, prune, conflicts, selfMode) {
  const steps = [];
  const claimed = new Set();
  const switchedSources = new Set();

  // Git and local paths have distinct pi identities. Remove only the opposite
  // source for this checkout, even in merge mode, before installing the desired
  // one; otherwise both copies register the same tools during /reload.
  for (const entry of installed) {
    const opposite = selfMode && (selfMode.dev ? SELF_IDENTITY : identityOf(selfMode.root));
    if (!opposite || identityOf(entry.source) !== opposite) continue;
    // pi remove deletes a managed git checkout. Running --dev inside that
    // checkout would delete the very local package we are about to register.
    if (selfMode.dev && entry.installedPath && resolve(entry.installedPath) === selfMode.root) {
      fail("--dev cannot use pi's managed git checkout; clone the repo into a separate working directory first");
    }
    switchedSources.add(entry.source);
    steps.push({
      domain: "packages", action: "remove", target: entry.source, beforeInstall: true,
      reason: "switch this repo between remote and dev sources",
    });
  }
  const byIdentity = new Map(installed.filter((entry) => !switchedSources.has(entry.source)).map((entry) => [identityOf(entry.source), entry]));

  // Packages this repo bundles as its own npm dependencies and loads itself. Leaving
  // them installed as pi packages registers their tools twice, which pi rejects as a
  // conflict, so they are removed even in merge mode.
  const conflicting = new Set(conflicts.map(identityOf));
  const removedAsConflict = new Set();
  for (const entry of installed) {
    const identity = identityOf(entry.source);
    if (!conflicting.has(identity) || switchedSources.has(entry.source)) continue;
    removedAsConflict.add(identity);
    steps.push({ domain: "packages", action: "remove", target: entry.source, reason: "bundled by this repo; must not be a pi package" });
  }

  for (const source of desired) {
    const identity = identityOf(source);
    const existing = byIdentity.get(identity);
    if (existing) claimed.add(identity);

    if (!existing) {
      steps.push({ domain: "packages", action: "install", target: source, reason: "not installed" });
    } else if (selfMode?.dev && source === selfMode.root) {
      // pi 1.1.0 loads local directories in place without installing dependencies
      // or updating them. pnpm install and edits belong to the checkout owner.
      steps.push({ domain: "packages", action: "keep", target: source, reason: "local checkout; loaded in place" });
    } else if (existing.source !== source) {
      steps.push({ domain: "packages", action: "install", target: source, reason: `different version: ${existing.source}` });
    } else if (!existing.installedPath) {
      steps.push({ domain: "packages", action: "install", target: source, reason: "declared but missing on disk" });
    } else if (isPinned(source)) {
      steps.push({ domain: "packages", action: "keep", target: source, reason: "pinned version" });
    } else {
      steps.push({ domain: "packages", action: "update", target: source, reason: "latest" });
    }
  }

  for (const entry of installed) {
    const identity = identityOf(entry.source);
    if (claimed.has(identity) || removedAsConflict.has(identity) || switchedSources.has(entry.source)) continue;
    steps.push(
      prune
        ? { domain: "packages", action: "remove", target: entry.source, reason: "not in manifest" }
        : { domain: "packages", action: "keep", target: entry.source, reason: "not in manifest (merge mode)" },
    );
  }

  return steps;
}

function runPi(action, source) {
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

// ---------------------------------------------------------------------------
// settings.json / keybindings.json
// ---------------------------------------------------------------------------

function readJsonFile(file, label) {
  step(`reading ${file}${existsSync(file) ? "" : " (absent)"}`);
  if (!existsSync(file)) return {};
  let raw;
  try {
    raw = readFileSync(file, "utf8");
  } catch (error) {
    fail(`cannot read ${file}: ${error.message}`);
  }
  // A BOM is accepted by pi's own loader, so accept it here too.
  if (raw.charCodeAt(0) === 0xfeff) raw = raw.slice(1);
  if (raw.trim() === "") return {};
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    // Refuse rather than overwrite: a broken file is more likely a half-finished
    // hand edit than something to throw away.
    fail(`${file} is not valid JSON (${error.message}); fix it before syncing ${label}`);
  }
  if (!isPlainObject(parsed)) fail(`${file} must contain a JSON object`);
  return parsed;
}

function render(value) {
  return value === undefined ? "(unset)" : JSON.stringify(value);
}

// keybindings.json accepts a single key or a list, so "ctrl+r" and ["ctrl+r"]
// mean the same thing. Compare normalized, write what the manifest says.
export function normalizeKeybinding(value) {
  if (value === null || value === undefined) return value;
  return Array.isArray(value) ? value : [value];
}

export function buildConfigPlan({ domain, declared, current, preserve, prune, protectedTopKeys = new Set(), equals = deepEqual, flat = false, targetPrefix = "" }) {
  const steps = [];
  const declaredPaths = declared.map((entry) => entry.path);

  for (const entry of declared) {
    const existing = getPath(current, entry.path);
    const target = `${targetPrefix}${formatPath(entry.path)}`;
    if (entry.value === null) {
      // A tombstone: declared so it gets removed, and stays declared so every
      // machine removes it. No state file needed to remember what we managed.
      if (existing.found) {
        steps.push({ domain, action: "unset", target, path: entry.path, reason: `was ${render(existing.value)} (declared null)` });
      }
      continue;
    }
    if (existing.found && equals(existing.value, entry.value)) {
      steps.push({ domain, action: "keep", target, path: entry.path, reason: `= ${render(existing.value)}` });
      continue;
    }
    steps.push({
      domain,
      action: "set",
      target,
      path: entry.path,
      value: entry.value,
      reason: `${render(existing.found ? existing.value : undefined)} -> ${render(entry.value)}`,
    });
  }

  if (!prune) return steps;

  // keybindings.json is flat, so its entries are whole top-level keys. Walking
  // it to the leaves would invent dotted paths out of a malformed value.
  const currentEntries = flat
    ? Object.entries(current).map(([key, value]) => ({ path: [key], value }))
    : leafEntries(current, { emptyObjectsAreLeaves: true });
  for (const entry of currentEntries) {
    if (protectedTopKeys.has(entry.path[0])) continue;
    // Already handled above: the declared path either is this path, replaces the
    // subtree it sits in, or is created inside it.
    if (declaredPaths.some((path) => overlaps(path, entry.path))) continue;
    const target = `${targetPrefix}${formatPath(entry.path)}`;
    if (preserve.some((path) => overlaps(path, entry.path))) {
      steps.push({ domain, action: "preserve", target, path: entry.path, reason: `= ${render(entry.value)}` });
      continue;
    }
    steps.push({ domain, action: "unset", target, path: entry.path, reason: `was ${render(entry.value)} (not declared)` });
  }

  return steps;
}

function sleepSync(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

// pi serializes its own settings writes with proper-lockfile, whose primitive is
// `mkdir <file>.lock` (FileSettingsStorage in pi 1.1.0). Taking the same lock
// the same way makes this write mutually exclusive with a running pi's write
// without adding a dependency -- sync.mjs has to run straight from `curl | sh`.
const LOCK_STALE_MS = 10_000; // proper-lockfile's default staleness window
const LOCK_WAIT_MS = 5_000;

function withLock(file, fn) {
  const lock = `${file}.lock`;
  const deadline = Date.now() + LOCK_WAIT_MS;
  for (;;) {
    try {
      mkdirSync(lock);
      break;
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
      let age = Number.POSITIVE_INFINITY;
      try {
        age = Date.now() - statSync(lock).mtimeMs;
      } catch {
        continue; // released while we looked; try again right away
      }
      if (age > LOCK_STALE_MS) {
        try {
          rmdirSync(lock);
        } catch {
          // someone else cleaned it up first
        }
        continue;
      }
      if (Date.now() > deadline) throw new Error(`${file} is locked by another process (${lock})`);
      sleepSync(50);
    }
  }
  try {
    return fn();
  } finally {
    try {
      rmdirSync(lock);
    } catch {
      // nothing useful to do if the lock is already gone
    }
  }
}

function applyConfigPlan(file, steps) {
  const actionable = steps.filter((entry) => entry.action === "set" || entry.action === "unset");
  if (actionable.length === 0) return { changed: false };

  return withLock(file, () => {
    // Re-read under the lock instead of reusing the planning snapshot: package
    // steps ran first and `pi install` rewrites settings.json. Applying path
    // operations to fresh content keeps pi's own keys intact.
    let current = {};
    if (existsSync(file)) {
      const raw = readFileSync(file, "utf8").replace(/^\uFEFF/, "");
      if (raw.trim() !== "") {
        try {
          current = JSON.parse(raw);
        } catch (error) {
          throw new Error(`${file} became invalid JSON (${error.message})`);
        }
      }
    }
    if (!isPlainObject(current)) throw new Error(`${file} must contain a JSON object`);

    const before = JSON.stringify(current, null, 2);
    for (const entry of actionable) {
      if (entry.action === "set") setPath(current, entry.path, entry.value);
      else unsetPath(current, entry.path);
    }
    // Same shape pi writes: two-space indent, no trailing newline.
    const after = JSON.stringify(current, null, 2);
    if (after === before) return { changed: false };

    const tmp = `${file}.my-pi-preset.tmp`;
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(tmp, after, "utf8");
    try {
      renameSync(tmp, file);
    } catch (error) {
      rmSync(tmp, { force: true });
      throw error;
    }
    info(`wrote ${file} (${actionable.length} change(s))`);
    return { changed: true };
  });
}

// ---------------------------------------------------------------------------
// Command line
// ---------------------------------------------------------------------------

function parseDomains(value, label, universe = DOMAINS) {
  const parts = String(value)
    .split(/[,\s]+/)
    .map((part) => part.trim())
    .filter(Boolean);
  if (parts.length === 0) fail(`${label} needs at least one domain: ${DOMAINS.join(", ")}, all, or none`);
  const selected = new Set();
  for (const part of parts) {
    if (part === "all") {
      // For --prune, `all` means every domain being synced, so `--sync settings
      // --prune` does not have to repeat the domain list.
      for (const domain of universe) selected.add(domain);
    } else if (part === "none") {
      selected.clear();
    } else if (DOMAINS.includes(part)) {
      selected.add(part);
    } else {
      fail(`${label}: unknown domain "${part}"; use ${DOMAINS.join(", ")}, all, or none`);
    }
  }
  return selected;
}

// `--prune` on its own means every synced domain. parseArgs has no optional
// values, so the bare flag is rewritten before parsing -- but only when it is
// really bare, so `--prune packages` still works.
function expandBarePrune(argv) {
  return argv.map((arg, index) => {
    if (arg !== "--prune") return arg;
    const next = argv[index + 1];
    return next === undefined || next.startsWith("-") ? "--prune=all" : arg;
  });
}

export function main(argv = process.argv.slice(2)) {
const { values } = parseArgs({
  args: expandBarePrune(argv),
  options: {
    manifest: { type: "string" },
    dev: { type: "boolean", default: false },
    sync: { type: "string" },
    prune: { type: "string" },
    "dry-run": { type: "boolean", default: false },
    help: { type: "boolean", default: false },
  },
});

if (values.help) {
  console.log(`Usage: node scripts/sync.mjs [options]

  --manifest <path>   Manifest to apply (default: pi-preset.json next to this script's parent)
  --sync <domains>    Domains to reconcile: packages, settings, keybindings, files, all, none
                      (default: all)
  --prune [<domains>] Domains the manifest owns completely; bare --prune, or --prune all,
                      means every domain --sync selected (default: none)
  --dev               Load this repo from the executing script's git checkout; third-party
                      packages remain remote. Requires a local checkout.
  --dry-run           Print the plan without changing anything

In a synced domain not listed in --prune, only declared entries are touched;
a declared null removes one entry. In a pruned domain, whatever the manifest
does not declare is removed, except the "preserve" lists and the settings keys
pi maintains itself (packages, lastChangelogVersion). Pruning "files" reaches
only the files "files" declares; a file the manifest never mentions is never
read, written or removed.`);
  process.exit(0);
}

const syncDomains = parseDomains(values.sync ?? "all", "--sync");
const pruneDomains = parseDomains(values.prune ?? "none", "--prune", syncDomains);
for (const domain of pruneDomains) {
  if (!syncDomains.has(domain)) fail(`--prune ${domain} needs --sync to include ${domain}`);
}

const scriptDir = dirname(fileURLToPath(import.meta.url));
const manifestPath = values.manifest ? resolve(values.manifest) : join(scriptDir, "..", "pi-preset.json");
const agentDir = resolveAgentDir();
const settingsFile = join(agentDir, "settings.json");
const keybindingsFile = join(agentDir, "keybindings.json");

const manifest = readManifest(manifestPath);
const selfMode = selfPackageMode(manifest, values.dev);

const installed = syncDomains.has("packages") ? readInstalled() : [];
const currentSettings = syncDomains.has("settings") ? readJsonFile(settingsFile, "settings") : {};
const currentKeybindings = syncDomains.has("keybindings") ? readJsonFile(keybindingsFile, "keybindings") : {};
const fileTargets = syncDomains.has("files")
  ? manifest.declaredFiles.map((entry) => {
      const path = join(agentDir, entry.file);
      return { ...entry, path, current: readJsonFile(path, `files ${entry.file}`) };
    })
  : [];

step("comparing manifest with this machine");

const plan = [];

if (syncDomains.has("packages")) {
  plan.push(...buildPackagePlan(manifest.desired, installed, pruneDomains.has("packages"), manifest.conflicts, selfMode));
}

if (syncDomains.has("settings")) {
  plan.push(
    ...buildConfigPlan({
      domain: "settings",
      declared: manifest.declaredSettings,
      current: currentSettings,
      preserve: manifest.preserve.settings,
      prune: pruneDomains.has("settings"),
      protectedTopKeys: PI_OWNED_SETTINGS,
    }),
  );
}

if (syncDomains.has("keybindings")) {
  plan.push(
    ...buildConfigPlan({
      domain: "keybindings",
      declared: manifest.declaredKeybindings,
      current: currentKeybindings,
      preserve: manifest.preserve.keybindings,
      prune: pruneDomains.has("keybindings"),
      equals: (a, b) => deepEqual(normalizeKeybinding(a), normalizeKeybinding(b)),
      flat: true,
    }),
  );
}

for (const target of fileTargets) {
  plan.push(
    ...buildConfigPlan({
      domain: "files",
      declared: target.declared,
      current: target.current,
      preserve: manifest.preserve.files[target.file] ?? [],
      prune: pruneDomains.has("files"),
      // The plan table lists every domain together, so a bare "searchShortcut"
      // would not say which file it lives in.
      targetPrefix: `${target.file}:`,
    }).map((entry) => ({ ...entry, file: target.path })),
  );
}

const modeLine = DOMAINS.filter((domain) => syncDomains.has(domain))
  .map((domain) => `${domain} ${pruneDomains.has(domain) ? "prune" : "merge"}`)
  .join(", ");
const skipped = DOMAINS.filter((domain) => !syncDomains.has(domain));
console.error(`      mode     ${modeLine || "nothing selected"}`);
if (skipped.length > 0) console.error(`      skip     ${skipped.join(", ")} (not selected)`);
console.error("");

const actionWidth = Math.max(...plan.map((entry) => entry.action.length), 8);
const domainWidth = Math.max(...plan.map((entry) => entry.domain.length), 8);
const targetWidth = Math.min(Math.max(...plan.map((entry) => entry.target.length), 8), 44);
for (const entry of plan) {
  const action = entry.action.padEnd(actionWidth);
  const domain = entry.domain.padEnd(domainWidth);
  const target = entry.target.padEnd(targetWidth);
  console.error(`      ${action}  ${domain}  ${target}  ${entry.reason ?? ""}`.trimEnd());
}

const counts = plan.reduce((acc, entry) => ({ ...acc, [entry.action]: (acc[entry.action] ?? 0) + 1 }), {});
console.error("");
console.error(
  `      ${
    Object.entries(counts)
      .map(([action, count]) => `${count} ${action}`)
      .join(", ") || "nothing to do"
  }`,
);

if (values["dry-run"]) {
  console.error("");
  console.error("Dry run: nothing was changed.");
  process.exit(0);
}

const packageSteps = plan.filter((entry) => entry.domain === "packages" && entry.action !== "keep");
const isWrite = (entry) => entry.action === "set" || entry.action === "unset";
// One write step per file, in the order they are applied.
const writeTargets = [
  ["settings", settingsFile, plan.filter((entry) => entry.domain === "settings" && isWrite(entry))],
  ["keybindings", keybindingsFile, plan.filter((entry) => entry.domain === "keybindings" && isWrite(entry))],
  ...fileTargets.map((target) => [
    target.file,
    target.path,
    plan.filter((entry) => entry.domain === "files" && entry.file === target.path && isWrite(entry)),
  ]),
].filter(([, , steps]) => steps.length > 0);
const totalSteps = packageSteps.length + writeTargets.length;

if (totalSteps === 0) {
  console.error("");
  console.error("Already up to date. Nothing to do.");
  process.exit(0);
}

console.error("");

const failures = [];
stepNumber = 0;

// Source-switch removals are a prerequisite, not ordinary prune removals. A
// failed removal must abort before any install (or config write), rather than
// leaving both copies registered. Unrelated steps keep their original order.
for (const entry of packageSteps.filter((candidate) => candidate.beforeInstall)) {
  step(`remove ${entry.target}`, totalSteps);
  const message = runPi("remove", entry.target);
  if (message) fail(`source switch aborted: ${message}; no packages were installed`);
  info("ok");
}

// Packages go first: `pi install` writes settings.json, and the config writes
// below re-read the file afterwards.
for (const action of ["install", "update", "remove"]) {
  for (const entry of packageSteps.filter((candidate) => candidate.action === action && !candidate.beforeInstall)) {
    step(`${action} ${entry.target}`, totalSteps);
    const message = runPi(action, entry.target);
    if (message) {
      console.error(`  failed: ${message}`);
      failures.push(`${entry.target}: ${message}`);
    } else {
      info("ok");
    }
  }
}

for (const [label, file, steps] of writeTargets) {
  step(`writing ${label} (${steps.length} key(s))`, totalSteps);
  try {
    const { changed } = applyConfigPlan(file, steps);
    info(changed ? "ok" : "already matched on disk; nothing written");
  } catch (error) {
    console.error(`  failed: ${error.message}`);
    failures.push(`${label}: ${error.message}`);
  }
}

console.error("");
if (failures.length > 0) {
  console.error(`${failures.length} of ${totalSteps} steps failed.`);
  process.exit(1);
}
console.error(`Done. ${totalSteps} step(s) applied. Run /reload in pi, or restart it, to pick up changes.`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
