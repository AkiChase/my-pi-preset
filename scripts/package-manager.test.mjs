import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const manifest = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
const workspace = readFileSync(join(root, "pnpm-workspace.yaml"), "utf8");
const execute = promisify(execFile);
// Never search PATH or bootstrap Corepack from a cold fixture HOME.
const manager = process.env.PNPM_TEST_BIN || process.env.npm_execpath;
const nativeOptions = { skip: !manager && "Requires an already selected pnpm entry (PNPM_TEST_BIN or npm_execpath)", timeout: 30_000 };

function fixture(t, packageOverrides = {}) {
  const cwd = mkdtempSync(join(tmpdir(), "preset-package-manager-"));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  const home = join(cwd, "home");
  mkdirSync(home);
  writeFileSync(join(cwd, "pnpm-workspace.yaml"), workspace);
  writeFileSync(join(cwd, "package.json"), JSON.stringify({
    name: "preset-package-manager-fixture",
    private: true,
    ...packageOverrides,
  }));
  // Clear inherited package-manager options before isolating machine state.
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !/^(?:npm_config_|pnpm_config_|corepack_)/i.test(key)));
  return { cwd, env: { ...env, HOME: home, USERPROFILE: home, XDG_CONFIG_HOME: join(home, "config"), XDG_CACHE_HOME: join(home, "cache"), XDG_DATA_HOME: join(home, "data"), XDG_STATE_HOME: join(home, "state"), PNPM_HOME: join(home, "pnpm"), CI: "1" }, timeout: 10_000 };
}

function invoke(args, options) {
  // JS pnpm entries need Node; native binaries are executed directly.
  return /\.[cm]?js$/.test(manager)
    ? execute(process.execPath, [manager, ...args], options)
    : execute(manager, args, options);
}

test("declares no project package-manager pin", () => {
  // A packageManager or engines.pnpm pin is resolved from the working directory by Corepack and
  // by pnpm itself, so it also applies to pnpm commands that merely inherit this checkout as their
  // cwd. pi spawns `pnpm install --prefix ~/.pi/agent/npm` without a cwd, which would then use this
  // project's pnpm version against the user's global store and fail with ERR_PNPM_UNEXPECTED_STORE.
  assert.equal(Object.hasOwn(manifest, "packageManager"), false);
  assert.equal(manifest.engines?.pnpm, undefined);
});

test("keeps SDK peers host-provided and peer installation disabled", () => {
  for (const name of Object.keys(manifest.peerDependencies).filter(name => name.startsWith("@earendil-works/"))) {
    assert.equal(manifest.peerDependencies[name], "*");
    assert.equal(Object.hasOwn(manifest.dependencies, name), false);
    assert.equal(Object.hasOwn(manifest.devDependencies, name), false);
  }
  const lock = readFileSync(join(root, "pnpm-lock.yaml"), "utf8");
  assert.match(lock, /autoInstallPeers: false/);
  assert.doesNotMatch(lock, /@earendil-works\//);
  assert.doesNotMatch(existsSync(join(root, ".npmrc")) ? readFileSync(join(root, ".npmrc"), "utf8") : "", /auto-install-peers/);
});

test("check retains only the explicit typecheck and test sequence", () => {
  assert.equal(manifest.scripts.check, "pnpm run typecheck && pnpm run test");
  assert.match(manifest.scripts.typecheck, /^node scripts\/link-pi-sdk\.mjs && tsc /);
  assert.match(manifest.scripts.test, /^node scripts\/link-pi-sdk\.mjs && node --test /);
});

test("the selected pnpm reads the actual root-only configuration under a cold HOME", nativeOptions, async t => {
  const options = fixture(t);
  assert.deepEqual(JSON.parse((await invoke(["config", "get", "autoInstallPeers"], options)).stdout), false);
  assert.deepEqual(JSON.parse((await invoke(["config", "get", "verifyDepsBeforeRun"], options)).stdout), false);
  assert.equal((await invoke(["config", "get", "packages"], options)).stdout.trim(), "undefined");
});

test("run executes a check with missing dependencies without fetching or installing", nativeOptions, async t => {
  let requests = 0;
  const server = createServer((_request, response) => {
    requests++;
    response.writeHead(503).end("An ordinary check must not contact the registry");
  });
  t.after(() => new Promise(resolve => {
    server.closeAllConnections();
    server.close(resolve);
  }));
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const options = fixture(t, {
    scripts: { check: "node check.cjs" },
    dependencies: { "must-never-be-installed-by-check": "0.0.0" },
  });
  writeFileSync(join(options.cwd, "check.cjs"), 'require("node:fs").writeFileSync("checked", "done");\n');
  const packageBefore = readFileSync(join(options.cwd, "package.json"), "utf8");
  const configBefore = readFileSync(join(options.cwd, "pnpm-workspace.yaml"), "utf8");
  const result = await invoke(["--registry", `http://127.0.0.1:${server.address().port}`, "run", "check"], options);
  assert.equal(readFileSync(join(options.cwd, "checked"), "utf8"), "done");
  assert.equal(requests, 0, result.stdout + result.stderr);
  assert.equal(existsSync(join(options.cwd, "node_modules")), false);
  assert.equal(existsSync(join(options.cwd, "pnpm-lock.yaml")), false);
  assert.equal(readFileSync(join(options.cwd, "package.json"), "utf8"), packageBefore);
  assert.equal(readFileSync(join(options.cwd, "pnpm-workspace.yaml"), "utf8"), configBefore);
  assert.doesNotMatch(result.stdout + result.stderr, /install that runs before scripts|ERR_PNPM_IGNORED_BUILDS/);
});
