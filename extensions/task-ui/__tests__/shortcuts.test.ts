import { it } from "node:test";
import assert from "node:assert/strict";
import { TaskCoordinator } from "../coordinator.ts";
import { DEFAULTS } from "../config.ts";
import { registerTaskControls } from "../controls.ts";

void it("registers only shared commands and the two default chords", async () => {
    const commands = new Map<string, { handler: (args: string, ctx: unknown) => Promise<void> }>();
    const keys: string[] = [];
    let opened = 0;
    const coordinator = new TaskCoordinator();
    const pi = { registerCommand: (name: string, def: { handler: (args: string, ctx: unknown) => Promise<void> }) => commands.set(name, def),
        registerShortcut: (key: string) => keys.push(key) };
    assert.deepEqual(registerTaskControls(pi as never, coordinator, DEFAULTS, async () => { opened++; }), []);
    assert.deepEqual([...commands.keys()], ["bg", "tasks"]);
    assert.deepEqual(keys, ["ctrl+shift+b", "shift+down"]);
    let aborted = 0;
    const notices: string[] = [];
    const ctx = { abort: () => { aborted++; }, ui: { notify: (text: string) => notices.push(text) } };
    const leases = ["shell", "agent", "retrieval"].map((taskId) => coordinator.registerWait({
        identity: { sourceId: taskId === "agent" ? "agent" : "process", taskId, runId: "1" }, label: taskId,
        kind: taskId === "retrieval" ? "retrieval" : "launch",
    }));
    await commands.get("bg")!.handler("", ctx);
    assert.equal(coordinator.waitCount, 0);
    for (const lease of leases) assert.equal((await lease.result).kind, "detached");
    assert.equal(aborted, 0);
    await commands.get("tasks")!.handler("", ctx);
    assert.equal(opened, 1);
    await commands.get("bg")!.handler("", ctx);
    assert.match(notices.at(-1)!, /No task waits/);
});

void it("remaps/unbinds chords and isolates SDK rejections", () => {
    const keys: string[] = [];
    const pi = { registerCommand() {}, registerShortcut(key: string) { if (key === "bad") throw new Error("invalid"); keys.push(key); } };
    const warnings = registerTaskControls(pi as never, new TaskCoordinator(), { ...DEFAULTS, shortcutBackground: ["bad", "alt+b"], shortcutTaskPanel: [] }, async () => {});
    assert.deepEqual(keys, ["alt+b"]);
    assert.match(warnings[0]!, /shortcutBackground.*bad/);
});
