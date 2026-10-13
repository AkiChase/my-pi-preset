import { it } from "node:test";
import assert from "node:assert/strict";
import { registerInputHandlers } from "../input.ts";
import { BackgroundRegistry } from "../state.ts";

for (const source of ["interactive", "rpc", "extension"]) {
    void it(`ordinary ${source} input never detaches, aborts or resubmits`, async () => {
        let handler!: (event: unknown, ctx: unknown) => Promise<unknown>;
        let pause = 0;
        let abort = 0;
        let resubmit = 0;
        const reg = new BackgroundRegistry();
        reg.foreground.set("call", { jobId: "job", requestPause: () => { pause++; } });
        registerInputHandlers({ on: (_event: string, fn: typeof handler) => { handler = fn; }, sendUserMessage: () => { resubmit++; } } as never, reg);
        for (const streamingBehavior of ["steer", "followUp"]) {
            assert.deepEqual(await handler({ text: "inspect results", source, streamingBehavior }, { abort: () => { abort++; } }), { action: "continue" });
        }
        assert.equal(pause + abort + resubmit, 0);
        assert.equal(reg.foreground.size, 1);
    });
}
