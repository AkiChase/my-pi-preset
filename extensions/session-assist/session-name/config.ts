import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { getAgentDir } from "@earendil-works/pi-coding-agent";

export interface NameConfig { automatic: boolean; interval: number }
export const DEFAULTS: Readonly<NameConfig> = Object.freeze({ automatic: true, interval: 8 });
export const CONFIG_FILENAME = "session-name.json";

function readObject(path: string): Record<string, unknown> {
    try {
        const value: unknown = JSON.parse(readFileSync(path, "utf8"));
        if (value === null || typeof value !== "object" || Array.isArray(value)) throw new Error("Expected a JSON object");
        return value as Record<string, unknown>;
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return {};
        throw error;
    }
}

export function parseConfig(value: Record<string, unknown>): NameConfig {
    const automatic = value.automatic ?? DEFAULTS.automatic;
    const interval = value.interval ?? DEFAULTS.interval;
    if (typeof automatic !== "boolean" || typeof interval !== "number" ||
        !Number.isSafeInteger(interval) || interval < 1 || interval > 10_000) throw new Error("Invalid session-name configuration");
    return { automatic, interval };
}

export function loadConfig(directory = getAgentDir()): NameConfig {
    return parseConfig(readObject(join(directory, CONFIG_FILENAME)));
}

/** Synchronous reread/rename preserves unrelated fields and refuses malformed configuration. */
export function saveConfig(patch: Partial<NameConfig>, directory = getAgentDir(), admitted: () => boolean = () => true): NameConfig {
    if (!admitted()) throw new Error("Configuration operation cancelled");
    if (Object.keys(patch).some(key => !["automatic", "interval"].includes(key))) throw new Error("Unknown session-name configuration field");
    mkdirSync(directory, { recursive: true });
    const path = join(directory, CONFIG_FILENAME);
    const fresh = readObject(path);
    // Refuse invalid stored known fields even when the patch would overwrite them.
    parseConfig(fresh);
    const config = parseConfig({ ...fresh, ...patch });
    const temporary = `${path}.${randomUUID()}.tmp`;
    try {
        if (!admitted()) throw new Error("Configuration operation cancelled");
        writeFileSync(temporary, `${JSON.stringify({ ...fresh, ...patch }, null, 2)}\n`, { flag: "wx", mode: 0o600 });
        if (!admitted()) throw new Error("Configuration operation cancelled");
        renameSync(temporary, path);
    } finally {
        rmSync(temporary, { force: true });
    }
    return config;
}
