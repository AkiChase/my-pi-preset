#!/usr/bin/env node
// Make pi's own SDK resolvable inside this checkout, for `tsc` and for `node --test`.
//
// The extensions import `@earendil-works/pi-coding-agent`, `@earendil-works/pi-tui`,
// `@earendil-works/pi-ai`, ... — peer dependencies that pi itself provides at runtime, so
// they are deliberately not installed. Downloading them just to type-check or run tests
// would cost ~60 MB and could drift from the pi that actually loads the code. Instead this
// script finds the SDK inside the pi installation already on this machine and symlinks
// those packages into `node_modules/@earendil-works/`.
//
// Run by `pnpm typecheck` and `pnpm test`; re-run it after `pnpm install` (pnpm prunes
// links it does not know about) or after updating pi. Idempotent and offline.
//
// Usage:
//   node scripts/link-pi-sdk.mjs
//
// Env:
//   PI_SDK_DIR            a node_modules directory that contains @earendil-works/*
//   PI_CODING_AGENT_DIR   pi's agent dir (default ~/.pi/agent)
//   PI_BIN                path to the pi executable, used as a last resort

import { spawnSync } from "node:child_process";
import { existsSync, lstatSync, mkdirSync, readdirSync, readlinkSync, realpathSync, rmSync, symlinkSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SCOPE = "@earendil-works";
const MARKER = join(SCOPE, "pi-coding-agent", "package.json");

const log = (message) => process.stderr.write(`\u001b[2m[link-pi-sdk]\u001b[0m ${message}\n`);

/** Directories to search for a node_modules holding the pi SDK, best candidate first. */
function* sdkCandidates() {
  if (process.env.PI_SDK_DIR) yield process.env.PI_SDK_DIR;

  const agentDir = process.env.PI_CODING_AGENT_DIR || join(homedir(), ".pi", "agent");
  const releases = join(agentDir, "install", "releases");
  if (existsSync(releases)) {
    // Newest release first, so a stale 1.0.x install never shadows 1.1.x.
    const versions = readdirSync(releases).sort(compareVersionsDesc);
    for (const version of versions) yield join(releases, version, "node_modules");
  }

  // npm/pnpm/bun global install: walk up from the resolved executable.
  const piBin = process.env.PI_BIN || which("pi");
  if (piBin && existsSync(piBin)) {
    let dir = dirname(realpathSync(piBin));
    for (let depth = 0; depth < 8; depth++) {
      yield join(dir, "node_modules");
      const parent = dirname(dir);
      if (parent === dir) break;
      dir = parent;
    }
  }
}

function compareVersionsDesc(a, b) {
  const parse = (value) => value.split(/[.-]/).map((part) => (/^\d+$/.test(part) ? Number(part) : part));
  const left = parse(a);
  const right = parse(b);
  for (let i = 0; i < Math.max(left.length, right.length); i++) {
    const x = left[i] ?? 0;
    const y = right[i] ?? 0;
    if (x === y) continue;
    if (typeof x === "number" && typeof y === "number") return y - x;
    return String(y).localeCompare(String(x));
  }
  return 0;
}

function which(command) {
  const result = spawnSync(process.platform === "win32" ? "where" : "which", [command], { encoding: "utf8" });
  if (result.status !== 0) return undefined;
  return result.stdout.split("\n")[0]?.trim() || undefined;
}

function findSdkRoot() {
  for (const candidate of sdkCandidates()) {
    if (candidate && existsSync(join(candidate, MARKER))) return candidate;
  }
  return undefined;
}

/** Point node_modules/@earendil-works/* at the SDK packages shipped with pi. */
function linkSdk(sdkRoot) {
  const targetScope = join(repoRoot, "node_modules", SCOPE);
  mkdirSync(targetScope, { recursive: true });
  const names = readdirSync(join(sdkRoot, SCOPE));
  let linked = 0;
  for (const name of names) {
    const from = join(targetScope, name);
    const to = join(sdkRoot, SCOPE, name);
    const current = existsSync(from) || isLink(from) ? from : undefined;
    if (current) {
      if (isLink(from) && realpathSafe(from) === realpathSafe(to)) continue;
      // A real directory here means npm installed it for real; leave it alone.
      if (!isLink(from)) continue;
      rmSync(from, { recursive: true, force: true });
    }
    symlinkSync(to, from, "junction");
    linked++;
  }
  log(`linked ${linked === 0 ? "0 new" : linked} of ${names.length} ${SCOPE}/* packages from ${sdkRoot}`);
}

const isLink = (path) => {
  try {
    return lstatSync(path).isSymbolicLink();
  } catch {
    return false;
  }
};

const realpathSafe = (path) => {
  try {
    return realpathSync(path);
  } catch {
    return isLink(path) ? readlinkSync(path) : path;
  }
};

const sdkRoot = findSdkRoot();
if (sdkRoot) {
  linkSdk(sdkRoot);
} else {
  // Not fatal: say plainly what will break instead of failing a whole check run here.
  process.stderr.write(
    `\u001b[31m[link-pi-sdk]\u001b[0m could not find ${SCOPE}/pi-coding-agent in any pi installation.\n`,
  );
  log("Type checks and tests that import the pi SDK will fail.");
  log("Set PI_SDK_DIR to a node_modules directory that contains it, or install pi: https://pi.dev");
  process.exit(1);
}
