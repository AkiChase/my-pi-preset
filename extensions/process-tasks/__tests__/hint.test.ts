/**
 * The background hint is derived from the registry's foreground slots, so the
 * tests drive it the way the bash tool does: register a slot, mark it hinted,
 * delete it. The properties that matter are that the hint never outlives the
 * commands it describes, and that it names the configured chord.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
    showBackgroundHint,
    clearBackgroundHint,
    renderBackgroundHint,
} from "../hint.ts";
import { BackgroundRegistry } from "../state.ts";
import { DEFAULTS as UI_DEFAULTS } from "../../task-ui/config.ts";
import { DEFAULTS } from "../config.ts";
import { createRunningJob } from "../registry.ts";
import type { ProcessTasksConfig } from "../config.ts";
import type { UiContext } from "../types.ts";

interface WidgetCall {
    name: string;
    content: string[] | undefined;
    options?: { placement?: string };
}

function makeCtx(reg: BackgroundRegistry): { calls: WidgetCall[]; ctx: UiContext } {
    const calls: WidgetCall[] = [];
    reg.hintPublisher = { set(_ctx, content) { calls.push({ name: "foreground_hint", content: content ? [...content] : undefined, options: { placement: "belowEditor" } }); return true; }, dispose() {} };
    const ctx = {
        ui: {
            notify: () => {},
            setWidget: (name: string, content: string[] | undefined, options?: { placement?: string }) =>
                calls.push({ name, content, options }),
            setStatus: () => {},
            theme: { fg: (_c: string, t: string) => t },
            select: async () => undefined,
            editor: async () => undefined,
        },
    } as unknown as UiContext;
    return { calls, ctx };
}

/** Register a foreground command the way runForeground does. */
function foreground(
    reg: BackgroundRegistry,
    toolCallId: string,
    command: string
): string {
    const jobId = `job-${toolCallId}`;
    reg.jobs.set(
        jobId,
        createRunningJob({
            id: jobId,
            command,
            pid: 1,
            logPath: `/tmp/${jobId}.log`,
            toolCallId,
            isBackgrounded: false,
        })
    );
    reg.foreground.set(toolCallId, { requestPause: () => {}, jobId });
    return jobId;
}

function reg(config: ProcessTasksConfig = DEFAULTS): BackgroundRegistry {
    return new BackgroundRegistry(config);
}

void describe("background hint", () => {
    void it("names the command, its elapsed time, and the chord", () => {
        const r = reg();
        const { calls, ctx } = makeCtx(r);
        foreground(r, "t1", "npm run build");
        showBackgroundHint(r, ctx, "t1");

        assert.equal(calls.length, 1);
        assert.equal(calls[0]!.options?.placement, "belowEditor");
        const lines = calls[0]!.content ?? [];
        // Upstream showed one static line of text with none of this.
        assert.match(lines[0]!, /^▶ npm run build \(\d+s\)$/);
        assert.equal(lines[1], "(ctrl+shift+b to run it in the background)");
    });

    void it("collapses a multi-line command onto one row", () => {
        const r = reg();
        const { calls, ctx } = makeCtx(r);
        foreground(r, "t1", "for f in *; do\n  echo $f\ndone");
        showBackgroundHint(r, ctx, "t1");
        assert.equal(calls[0]!.content?.length, 2, "one row plus the chord line");
    });

    void it("lists every hinted command and pluralises the chord line", () => {
        const r = reg();
        const { calls, ctx } = makeCtx(r);
        foreground(r, "t1", "npm run build");
        foreground(r, "t2", "pytest -q");
        showBackgroundHint(r, ctx, "t1");
        showBackgroundHint(r, ctx, "t2");

        const lines = calls.at(-1)!.content ?? [];
        assert.equal(lines.length, 3);
        assert.match(lines[0]!, /npm run build/);
        assert.match(lines[1]!, /pytest -q/);
        assert.equal(lines[2], "(ctrl+shift+b to run them all in the background)");
    });

    void it("advertises the configured chord, not the default", () => {
        const r = new BackgroundRegistry(DEFAULTS, undefined, { ...UI_DEFAULTS, shortcutBackground: ["alt+b"] });
        const { calls, ctx } = makeCtx(r);
        foreground(r, "t1", "sleep 30");
        showBackgroundHint(r, ctx, "t1");
        // Advertising a key the user remapped away is worse than saying nothing.
        assert.match(calls[0]!.content?.[1] ?? "", /^\(alt\+b to run/);
    });

    void it("falls back to /task-detach when the chord is unbound", () => {
        const r = new BackgroundRegistry(DEFAULTS, undefined, { ...UI_DEFAULTS, shortcutBackground: [] });
        const { calls, ctx } = makeCtx(r);
        foreground(r, "t1", "sleep 30");
        showBackgroundHint(r, ctx, "t1");
        assert.match(calls[0]!.content?.[1] ?? "", /^\(\/task-detach to run/);
    });

    void it("stays up until the last parallel command is gone", () => {
        const r = reg();
        const { calls, ctx } = makeCtx(r);
        foreground(r, "t1", "a");
        foreground(r, "t2", "b");
        showBackgroundHint(r, ctx, "t1");
        showBackgroundHint(r, ctx, "t2");

        r.foreground.delete("t1");
        clearBackgroundHint(r, ctx, "t1");
        assert.notEqual(calls.at(-1)!.content, undefined, "hint stays while b runs");

        r.foreground.delete("t2");
        clearBackgroundHint(r, ctx, "t2");
        assert.equal(calls.at(-1)!.content, undefined);
    });

    void it("a repeated show does not rewrite an unchanged widget", () => {
        const r = reg();
        const { calls, ctx } = makeCtx(r);
        foreground(r, "t1", "a");
        showBackgroundHint(r, ctx, "t1");
        showBackgroundHint(r, ctx, "t1");
        renderBackgroundHint(r, ctx);
        assert.equal(calls.length, 1, "content is diffed before writing");
    });

    void it("clear is a no-op when nothing is shown", () => {
        const r = reg();
        const { calls, ctx } = makeCtx(r);
        clearBackgroundHint(r, ctx, "nope");
        assert.equal(calls.length, 0);
    });

    void it("a dropped slot retires the hint even with no clear call", () => {
        // The bug this replaces: upstream's module-level counter required every
        // caller to pair show/clear, so any exception path between them pinned
        // the hint below the editor for the rest of the session. Derived state
        // cannot do that — losing the slot IS losing the hint.
        const r = reg();
        const { calls, ctx } = makeCtx(r);
        foreground(r, "t1", "npm run build");
        showBackgroundHint(r, ctx, "t1");
        assert.notEqual(calls.at(-1)!.content, undefined);

        r.foreground.clear(); // shared launch-lease cleanup retires slots
        renderBackgroundHint(r, ctx);
        assert.equal(calls.at(-1)!.content, undefined);
    });

    void it("ignores a slot that has not passed the quick window", () => {
        const r = reg();
        const { calls, ctx } = makeCtx(r);
        foreground(r, "t1", "echo hi");
        // No showBackgroundHint: a command that finishes inside two seconds
        // would otherwise flash a hint nobody can act on.
        renderBackgroundHint(r, ctx);
        assert.equal(calls.length, 0);
    });
});

it("a failed admission retries on the next derived render, while freeze retires the finite publisher", async () => {
    const { createProcessLifecycleParticipant } = await import("../lifecycle.ts");
    const r = reg(); const { calls, ctx } = makeCtx(r);
    const publisher = r.hintPublisher!;
    let attempts = 0, disposes = 0;
    r.hintPublisher = { set(context, lines) { attempts++; if (attempts === 1) return false; return publisher.set(context, lines); }, dispose() { disposes++; } };
    foreground(r, "retry", "build"); showBackgroundHint(r, ctx, "retry");
    assert.equal(r.lastHintContent, undefined); renderBackgroundHint(r, ctx);
    assert.equal(attempts, 2); assert.equal(calls.length, 1);
    const lifecycle = createProcessLifecycleParticipant(r, () => {});
    lifecycle.freeze(); lifecycle.freeze(); renderBackgroundHint(r, ctx);
    assert.equal(disposes, 1); assert.equal(attempts, 2); assert.equal(r.hintPublisher, undefined);
});
