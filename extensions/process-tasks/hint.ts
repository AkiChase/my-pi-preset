/**
 * Live "run in background" hint shown below the editor while a foreground bash
 * command is running — mirrors Claude Code's BackgroundHint, which appears once
 * a command has run past the quick-completion window.
 *
 * The state is derived from the registry's foreground slots, not held
 * separately. Upstream kept a module-level `activeHints` counter and required
 * every caller to pair exactly one show() with one clear(); any exception path
 * that skipped the clear left "(ctrl+shift+b to run in background)" pinned
 * below the editor for the rest of the session, with no way to clear it.
 * Deriving it means the hint cannot outlive the commands it describes: the
 * slot is deleted on every exit path (including shared lease detach), so
 * the next render has nothing to show.
 */

import type { UiContext } from "./types.ts";
import { PREVIEW_CHARS } from "./types.ts";
import type { BackgroundRegistry } from "./state.ts";
import { formatDuration, oneLine } from "./format.ts";

const HINT_KEY = "bg-hint";

/**
 * How to ask for a background hand-off. The chord is configurable and can be
 * unbound entirely, so the hint has to read it rather than hardcode it —
 * advertising a key the user remapped away is worse than saying nothing.
 */
export function backgroundHintKey(reg: BackgroundRegistry): string {
    return reg.uiConfig.shortcutBackground[0] ?? "/bg";
}

/**
 * Redraw the hint from the current foreground slots. Idempotent and safe to
 * call on every tick: the content is diffed, so an unchanged hint costs no
 * widget write.
 */
export function renderBackgroundHint(
    reg: BackgroundRegistry,
    ctx: UiContext
): void {
    const rows: string[] = [];
    for (const slot of reg.foreground.values()) {
        // Only past the quick-completion window: a command that finishes in
        // under two seconds would otherwise flash a hint nobody can act on.
        if (!slot.hinted) continue;
        const job = reg.jobs.get(slot.jobId);
        if (!job) continue;
        rows.push(
            `▶ ${oneLine(job.command).slice(0, PREVIEW_CHARS.progress)} (${formatDuration(
                Date.now() - job.startTime
            )})`
        );
    }

    if (rows.length === 0) {
        if (reg.lastHintContent !== undefined) {
            reg.lastHintContent = undefined;
            ctx.ui.setWidget(HINT_KEY, undefined);
        }
        return;
    }

    // Upstream showed one static line of text no matter what was running.
    // Which command, and how long it has been going, is the whole basis for
    // deciding whether to background it.
    const lines = [
        ...rows,
        `(${backgroundHintKey(reg)} to run ${rows.length > 1 ? "them all" : "it"} in the background)`,
    ];
    const content = lines.join("\n");
    if (content === reg.lastHintContent) return;
    reg.lastHintContent = content;
    ctx.ui.setWidget(HINT_KEY, lines, { placement: "belowEditor" });
}

/** Start hinting for one foreground command. Idempotent. */
export function showBackgroundHint(
    reg: BackgroundRegistry,
    ctx: UiContext,
    toolCallId: string
): void {
    const slot = reg.foreground.get(toolCallId);
    if (!slot) return;
    slot.hinted = true;
    renderBackgroundHint(reg, ctx);
}

/** Stop hinting for one foreground command. Idempotent, and a no-op when the
 *  slot is already gone — the render below then clears the widget anyway. */
export function clearBackgroundHint(
    reg: BackgroundRegistry,
    ctx: UiContext,
    toolCallId: string
): void {
    const slot = reg.foreground.get(toolCallId);
    if (slot) slot.hinted = false;
    renderBackgroundHint(reg, ctx);
}
