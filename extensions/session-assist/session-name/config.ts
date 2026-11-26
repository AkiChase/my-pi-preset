import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { getAgentDir } from "@earendil-works/pi-coding-agent";

import { parseModelConfig, type ModelConfig } from "../shared/model-config.ts";

export interface NameConfig extends ModelConfig { automatic: boolean; interval: number }
export const DEFAULTS: Readonly<NameConfig> = Object.freeze({ modelMode: "follow", automatic: true, interval: 8 });
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

export function parseConfig(value: Record<string, unknown>, options: { allowInvalidModel?: boolean } = {}): NameConfig {
    const automatic = value.automatic ?? DEFAULTS.automatic;
    const interval = value.interval ?? DEFAULTS.interval;
    if (typeof automatic !== "boolean" || typeof interval !== "number" ||
        !Number.isSafeInteger(interval) || interval < 1 || interval > 10_000) throw new Error("Invalid session-name configuration");
    const selection = parseModelConfig(value);
    if (selection.issues.length && !options.allowInvalidModel) throw new Error(selection.issues.join("; "));
    return { ...selection.config, automatic, interval };
}

export function loadConfig(directory = getAgentDir(), options: { allowInvalidModel?: boolean } = {}): NameConfig {
    return parseConfig(readObject(join(directory, CONFIG_FILENAME)), options);
}

/** Synchronous reread/rename preserves unrelated fields and refuses malformed configuration. */
export function saveConfig(patch: Partial<NameConfig>, directory = getAgentDir(), admitted: () => boolean = () => true): NameConfig {
    if (!admitted()) throw new Error("Configuration operation cancelled");
    if (Object.keys(patch).some(key => !["modelMode", "model", "thinking", "automatic", "interval"].includes(key))) throw new Error("Unknown session-name configuration field");
    mkdirSync(directory, { recursive: true });
    const path = join(directory, CONFIG_FILENAME);
    const fresh = readObject(path);
    // Preserve behavioral-field refusal while allowing a model-mode selection to repair model fields.
    parseConfig(fresh, { allowInvalidModel: true });
    const config = parseConfig({ ...fresh, ...patch });
    for (const key of ["model", "thinking"] as const) {
        if (key in patch) {
            const issue = parseModelConfig({ ...fresh, ...patch, modelMode: "custom" }).issues.find(issue => issue.startsWith(`${key} `));
            if (issue) throw new Error(issue);
        }
    }
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
