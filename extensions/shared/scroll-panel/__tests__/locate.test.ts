import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { locateTuiEntry } from "../native-layout.ts";

const unresolvable = () => { throw new Error("Cannot find module '@earendil-works/pi-tui'"); };

describe("scroll-panel locateTuiEntry", () => {
	it("prefers the module resolver", () => {
		assert.equal(locateTuiEntry(() => "file:///host/pi-tui/dist/index.js", "/unused"), "file:///host/pi-tui/dist/index.js");
	});

	it("falls back to the pi-tui installed beside the real launcher (bundled CLI)", (t) => {
		const root = mkdtempSync(join(tmpdir(), "scroll-panel-locate-"));
		t.after(() => rmSync(root, { recursive: true, force: true }));
		const modules = join(root, "node_modules");
		const tui = join(modules, "@earendil-works", "pi-tui");
		const bundle = join(modules, "@earendil-works", "pi-coding-agent", "dist", "bundle");
		mkdirSync(join(tui, "dist"), { recursive: true });
		mkdirSync(bundle, { recursive: true });
		mkdirSync(join(modules, ".bin"));
		writeFileSync(join(tui, "package.json"), JSON.stringify({ name: "@earendil-works/pi-tui", main: "dist/index.js" }));
		writeFileSync(join(tui, "dist", "index.js"), "");
		writeFileSync(join(bundle, "cli.js"), "");
		symlinkSync(join(bundle, "cli.js"), join(modules, ".bin", "pi"));
		const entry = locateTuiEntry(unresolvable, join(modules, ".bin", "pi"));
		assert.equal(realpathSync(fileURLToPath(entry)), realpathSync(join(tui, "dist", "index.js")));
	});

	it("reports both failures when no launcher can locate pi-tui", () => {
		assert.throws(() => locateTuiEntry(unresolvable, undefined), /Cannot find module/);
		assert.throws(() => locateTuiEntry(unresolvable, "/nowhere/pi", p => p), /Cannot locate @earendil-works\/pi-tui/);
	});
});
