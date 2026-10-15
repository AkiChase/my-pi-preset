import assert from "node:assert/strict";
import { it } from "node:test";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";

it("actual host loads Recap and Session Name as two independent entries with no factory resources", () => {
    const directory = mkdtempSync(`${tmpdir()}/recap-loader-`);
    try {
        const entries = [new URL("../../../recap.ts", import.meta.url).pathname, new URL("../../../session-name.ts", import.meta.url).pathname];
        const result = spawnSync(process.execPath, ["--input-type=module", "-e", `
            import assert from "node:assert/strict";
            const {loadExtensionsCached} = await import(new URL("./core/extensions/loader.js", import.meta.resolve("@earendil-works/pi-coding-agent")));
            const result = await loadExtensionsCached(${JSON.stringify(entries)}, process.cwd());
            assert.deepEqual(result.errors, []); assert.equal(result.extensions.length, 2);
            assert.deepEqual(result.extensions.map(e=>[...e.commands.keys()]), [["recap"],["session-name"]]);
            for(const extension of result.extensions) { assert.equal(extension.tools.size, 0); for(const handler of extension.handlers.get("session_shutdown")) await handler({},{}); }
        `], { encoding: "utf8", timeout: 30000, env: { ...process.env, PI_CODING_AGENT_DIR: directory, PI_OFFLINE: "1" } });
        assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`); assert.equal(result.error, undefined); assert.deepEqual(readdirSync(directory), []);
    } finally { rmSync(directory, { recursive: true, force: true }); }
});
