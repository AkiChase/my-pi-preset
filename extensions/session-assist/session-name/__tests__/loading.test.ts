import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { it } from "node:test";

it("actual Pi host loader loads a single session-name entry without starting resources or discovering helpers", () => {
    const directory = mkdtempSync(`${tmpdir()}/name-host-`);
    try {
        const result = spawnSync(process.execPath, ["--input-type=module", "-e", `
            import assert from "node:assert/strict";
            const {loadExtensionsCached} = await import(new URL("./core/extensions/loader.js", import.meta.resolve("@earendil-works/pi-coding-agent")));
            const result = await loadExtensionsCached([${JSON.stringify(new URL("../../../session-name.ts", import.meta.url).pathname)}], process.cwd());
            assert.deepEqual(result.errors, []);
            assert.equal(result.extensions.length, 1);
            const extension = result.extensions[0];
            assert.equal(extension.commands.size, 1);
            assert.ok(extension.commands.has("session-name"));
            assert.equal(extension.tools.size, 0);
            assert.equal(extension.handlers.get("agent_settled").length, 1);
            for (const handler of extension.handlers.get("session_shutdown")) await handler({}, {});
        `], { encoding: "utf8", timeout: 30_000, env: { ...process.env, PI_CODING_AGENT_DIR: directory } });
        assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
        assert.equal(result.error, undefined);
        assert.deepEqual(readdirSync(directory), []);
    } finally { rmSync(directory, { recursive: true, force: true }); }
});
