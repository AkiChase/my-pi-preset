import { readFileSync } from "node:fs";
import { join } from "node:path";
import { getConfigDir } from "../process-tasks/config.ts";

export type ShortcutBinding = readonly string[];
export interface TaskUIConfig {
    readonly shortcutBackground: ShortcutBinding;
    readonly shortcutTaskPanel: ShortcutBinding;
    /** Empty focused editor Down opens the panel; independent of explicit chords. */
    readonly downOpener: boolean;
    /** Animate active-task status indicators in an open panel. */
    readonly animations?: boolean;
    /** Main-model requests between background-task reminders; 0 disables periodic reminders. */
    readonly backgroundReminderInterval: number;
}
export const CONFIG_FILENAME = "task-ui.json";
export const DEFAULTS: TaskUIConfig = Object.freeze({
    shortcutBackground: Object.freeze(["ctrl+shift+b"]),
    shortcutTaskPanel: Object.freeze(["shift+down"]),
    downOpener: true,
    animations: true,
    backgroundReminderInterval: 8,
});

function parseShortcut(raw: unknown, key: string, warnings: string[]): ShortcutBinding | undefined {
    if (typeof raw === "string") {
        const text = raw.trim();
        return text === "" || text.toLowerCase() === "off" ? [] : [text];
    }
    if (Array.isArray(raw)) {
        const keys: string[] = [];
        for (const value of raw) {
            if (typeof value !== "string" || value.trim() === "") warnings.push(`${key}: ignoring non-string entry ${JSON.stringify(value)}`);
            else keys.push(value.trim());
        }
        return keys;
    }
    warnings.push(`${key}: expected a key, a list of keys, or "off" — using default`);
    return undefined;
}

export function loadConfig(agentDir = getConfigDir()): { config: TaskUIConfig; warnings: string[]; path: string | undefined } {
    const warnings: string[] = [];
    const path = join(agentDir, CONFIG_FILENAME);
    let raw: Record<string, unknown> = {};
    let found = false;
    try {
        const parsed: unknown = JSON.parse(readFileSync(path, "utf-8"));
        found = true;
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) raw = parsed as Record<string, unknown>;
        else warnings.push(`${path}: expected a JSON object — ignoring the file`);
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") warnings.push(`${path}: ${String(error)}`);
    }
    for (const key of Object.keys(raw)) if (!(key in DEFAULTS)) warnings.push(`${path}: unknown key "${key}"`);
    if (raw.downOpener !== undefined && typeof raw.downOpener !== "boolean") warnings.push("downOpener: expected a boolean — using default");
    if (raw.animations !== undefined && typeof raw.animations !== "boolean") warnings.push("animations: expected a boolean — using default");
    const interval = raw.backgroundReminderInterval;
    const validInterval = typeof interval === "number" && Number.isSafeInteger(interval) && interval >= 0;
    if (interval !== undefined && !validInterval) warnings.push("backgroundReminderInterval: expected a non-negative integer — using default");
    const config = Object.freeze({
        shortcutBackground: Object.freeze(raw.shortcutBackground === undefined ? [...DEFAULTS.shortcutBackground] : parseShortcut(raw.shortcutBackground, "shortcutBackground", warnings) ?? [...DEFAULTS.shortcutBackground]),
        shortcutTaskPanel: Object.freeze(raw.shortcutTaskPanel === undefined ? [...DEFAULTS.shortcutTaskPanel] : parseShortcut(raw.shortcutTaskPanel, "shortcutTaskPanel", warnings) ?? [...DEFAULTS.shortcutTaskPanel]),
        downOpener: typeof raw.downOpener === "boolean" ? raw.downOpener : DEFAULTS.downOpener,
        animations: typeof raw.animations === "boolean" ? raw.animations : DEFAULTS.animations,
        backgroundReminderInterval: validInterval ? interval as number : DEFAULTS.backgroundReminderInterval,
    });
    return { config, warnings, path: found ? path : undefined };
}
