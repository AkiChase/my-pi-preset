import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnWithFileOutput, killProcessTree, processExists } from "../spawn.ts";

function fixture(t: import("node:test").TestContext) {
    const dir = mkdtempSync(join(tmpdir(), "pi-spawn-test-"));
    t.after(() => rmSync(dir, { recursive: true, force: true }));
    return { cwd: dir, logPath: join(dir, "output.log") };
}

async function ready(logPath: string) {
    const deadline = Date.now() + 3_000;
    while (!readFileSync(logPath, "utf8").includes("ready")) {
        assert.ok(Date.now() < deadline, "child did not signal readiness");
        await new Promise(resolve => setTimeout(resolve, 5));
    }
}

test("captures both output streams and preserves the nonzero exit code", async t => {
    const paths = fixture(t);
    const result = spawnWithFileOutput({ ...paths, command: "printf stdout; printf stderr >&2; exit 42" });
    assert.ok(result.pid > 0);
    assert.equal((await result.exit).code, 42);
    const output = readFileSync(paths.logPath, "utf8");
    assert.ok(output.includes("stdout"));
    assert.ok(output.includes("stderr"));
});

test("AbortSignal stops the ready child", { timeout: 5_000 }, async t => {
    const paths = fixture(t), controller = new AbortController();
    const result = spawnWithFileOutput({ ...paths, command: "printf ready; exec sleep 60", signal: controller.signal });
    try {
        await ready(paths.logPath);
        controller.abort();
        const { code, signal } = await result.execution.done;
        assert.ok(signal !== null || code !== 0);
        assert.equal(processExists(result.pid), false);
    } finally { result.execution.stop(); await result.execution.done; }
});

test("shell exit resolves while a grandchild still holds the output fd", { timeout: 5_000 }, async t => {
    const paths = fixture(t);
    const result = spawnWithFileOutput({ ...paths, command: "sleep 30 & printf ready" });
    let timer: NodeJS.Timeout | undefined;
    try {
        const exit = await Promise.race([
            result.exit,
            new Promise<null>(resolve => { timer = setTimeout(() => resolve(null), 3_000); }),
        ]);
        assert.notEqual(exit, null, "must not wait for the grandchild to exit");
        assert.equal(exit!.code, 0);
    } finally {
        clearTimeout(timer);
        // The group still belongs to this fixture even after its leader exits.
        try { process.kill(-result.pid, "SIGKILL"); } catch { /* group already gone */ }
        await result.execution.done;
    }
});

test("killProcessTree stops a ready process", { timeout: 5_000 }, async t => {
    const paths = fixture(t);
    const result = spawnWithFileOutput({ ...paths, command: "printf ready; exec sleep 60" });
    try {
        await ready(paths.logPath);
        assert.equal(processExists(result.pid), true);
        killProcessTree(result.pid);
        await result.execution.done;
        assert.equal(processExists(result.pid), false);
    } finally { result.execution.stop(); await result.execution.done; }
});
