import assert from "node:assert/strict";
import { existsSync, globSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

// Guards package.json's `pi.extensions` declaration.
//
// Without it, pi auto-discovers extensions under `extensions/`: every top-level `.ts` file
// AND every subdirectory with an `index.ts` (see collectAutoExtensionEntries /
// resolveExtensionEntries in pi 1.1.0's core/package-manager.js). That makes the vendored
// `extensions/bg-tasks/index.ts` load a second time as an extension of its own, next to
// `extensions/bash-unified.ts` which deliberately loads it as a library — so `bash`,
// `bash_bg`, `jobs`, `monitor` and four shortcuts get registered twice and pi reports
// conflicts. The declaration is the only thing keeping vendored directories out.

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const manifest = JSON.parse(readFileSync(join(root, "package.json"), "utf8")).pi;

/** Mirrors pi's expandPackageGlob + collectFilesFromManifestEntries for plain file entries. */
function declaredExtensions() {
  return manifest.extensions
    .flatMap((entry) => (entry.includes("*") ? globSync(entry, { cwd: root }) : [entry]))
    .map((match) => relative(root, resolve(root, match)))
    .sort();
}

describe("package.json pi.extensions", () => {
  it("is declared", () => {
    assert.ok(Array.isArray(manifest?.extensions) && manifest.extensions.length > 0, "package.json needs a pi.extensions array, or pi falls back to auto-discovery");
  });

  it("loads every top-level extension file", () => {
    assert.deepEqual(declaredExtensions(), globSync("extensions/*.ts", { cwd: root }).sort());
  });

  it("loads nothing from a subdirectory of extensions/", () => {
    // Vendored code (extensions/bg-tasks) and tests (extensions/__tests__) live there and
    // are loaded by our own extensions, or not at all.
    const nested = declaredExtensions().filter((path) => path.split(/[/\\]/).length > 2);
    assert.deepEqual(nested, [], `these would load as standalone extensions: ${nested.join(", ")}`);
  });

  it("covers the resource types this repo ships", () => {
    // A pi manifest switches off convention discovery for the types it does not list, so a
    // new skills/ or prompts/ directory is silently ignored until it is declared here.
    for (const type of ["skills", "prompts", "themes"]) {
      assert.ok(existsSync(join(root, type)) === false || Array.isArray(manifest[type]), `${type}/ exists but is not declared in pi.extensions' manifest`);
    }
  });
});
