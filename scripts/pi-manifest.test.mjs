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
// `extensions/process-tasks/index.ts` load a second time as an extension of its own, next to
// `extensions/bash-unified.ts` which deliberately loads it as a library — so `bash`,
// `bash_bg`, `jobs`, `monitor` and two shortcuts get registered twice and pi reports
// conflicts. The declaration is the only thing keeping vendored directories out.

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const packageJson = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
const manifest = packageJson.pi;
const preset = JSON.parse(readFileSync(join(root, "pi-preset.json"), "utf8"));

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
    // Vendored code (extensions/process-tasks) and tests (extensions/__tests__) live there and
    // are loaded by our own extensions, or not at all.
    const nested = declaredExtensions().filter((path) => path.split(/[/\\]/).length > 2);
    assert.deepEqual(nested, [], `these would load as standalone extensions: ${nested.join(", ")}`);
  });

  it("keeps composition-owned packages in conflicts, not standalone packages or runtime copies", () => {
    for (const source of ["npm:pi-patty-bg-tasks", "npm:@heyhuynhgiabuu/pi-pretty", "npm:@tintinweb/pi-subagents"]) {
      assert.ok(preset.conflicts.includes(source));
      assert.equal(Object.hasOwn(preset.packages, source), false);
    }
    assert.equal(Object.hasOwn(packageJson.dependencies, "@tintinweb/pi-subagents"), false);
    assert.ok(packageJson.dependencies.croner);
    assert.ok(packageJson.dependencies.nanoid);
    assert.ok(packageJson.peerDependencies["@earendil-works/pi-coding-agent"]);
    assert.equal(Object.hasOwn(packageJson.dependencies, "@earendil-works/pi-coding-agent"), false);
    assert.equal(declaredExtensions().filter(path => path === "extensions/bash-unified.ts").length, 1);
    assert.equal(existsSync(join(root, "extensions/agent-tasks/src/index.ts")), true);
    assert.equal(existsSync(join(root, "extensions/agent-tasks/LICENSE.upstream")), true);
  });

  it("covers the resource types this repo ships", () => {
    // A pi manifest switches off convention discovery for the types it does not list, so a
    // new skills/ or prompts/ directory is silently ignored until it is declared here.
    for (const type of ["skills", "prompts", "themes"]) {
      assert.ok(existsSync(join(root, type)) === false || Array.isArray(manifest[type]), `${type}/ exists but is not declared in pi.extensions' manifest`);
    }
  });
});
