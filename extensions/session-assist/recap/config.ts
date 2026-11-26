import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { parseModelConfig, resolveModelConfig, type ModelConfig } from "../shared/model-config.ts";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";

export const CONFIG_FILENAME = "recap.json";
export interface RecapConfig extends ModelConfig { automatic: boolean; idleMinutes: number; maxContextChars: number }
export const DEFAULTS: Readonly<RecapConfig> = Object.freeze({ modelMode: "follow", automatic: true, idleMinutes: 5, maxContextChars: 32_000 });
export interface ConfigState { config: RecapConfig; issues: string[] }
function readObject(path: string): Record<string, unknown> {
    try {
        const text = readFileSync(path, "utf8").replace(/^\uFEFF/, "");
        const value: unknown = text.trim() ? JSON.parse(text) : {};
        if (value === null || typeof value !== "object" || Array.isArray(value)) throw new Error("recap.json must contain a JSON object");
        return value as Record<string, unknown>;
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return {};
        throw error;
    }
}
export function parseConfig(value: Record<string, unknown>): ConfigState {
    const selection = parseModelConfig(value);
    const config: RecapConfig = { ...DEFAULTS, ...selection.config };
    const issues = [...selection.issues];
    if (value.automatic !== undefined) {
        if (typeof value.automatic === "boolean") config.automatic = value.automatic;
        else issues.push("automatic must be a boolean");
    }
    if (value.idleMinutes !== undefined) {
        if (typeof value.idleMinutes === "number" && Number.isFinite(value.idleMinutes) && value.idleMinutes >= 0.01 && value.idleMinutes <= 1440) config.idleMinutes = value.idleMinutes;
        else issues.push("idleMinutes must be between 0.01 and 1440");
    }
    if (value.maxContextChars !== undefined) {
        if (typeof value.maxContextChars === "number" && Number.isSafeInteger(value.maxContextChars) && value.maxContextChars >= 256 && value.maxContextChars <= 1_000_000) config.maxContextChars = value.maxContextChars;
        else issues.push("maxContextChars must be an integer between 256 and 1000000");
    }
    return { config, issues };
}
export function loadConfig(directory = getAgentDir()): ConfigState { return parseConfig(readObject(join(directory, CONFIG_FILENAME))); }
/** Patch only the chosen field onto freshly reread JSON; malformed files are never replaced. */
export function saveConfig(patch: Partial<RecapConfig>, directory = getAgentDir(), admitted: () => boolean = () => true): ConfigState {
    if (!admitted()) throw new Error("Configuration operation cancelled");
    mkdirSync(directory, { recursive: true });
    const path = join(directory, CONFIG_FILENAME);
    const fresh = readObject(path);
    const next = { ...fresh, ...patch };
    // Partial setup is allowed, but a newly edited field itself must be valid.
    const checked = parseConfig(next);
    for (const key of Object.keys(patch)) {
        if (!["modelMode", "model", "thinking", "automatic", "idleMinutes", "maxContextChars"].includes(key)) throw new Error("Unknown Recap configuration field");
        // Dormant custom values are retained in follow mode, but newly edited values still need validation.
        const edited = key === "model" || key === "thinking" ? parseModelConfig({ ...next, modelMode: "custom" }).issues : checked.issues;
        if (edited.some(issue => issue.startsWith(`${key} `))) throw new Error(edited.find(issue => issue.startsWith(`${key} `)));
    }
    const temporary = `${path}.${randomUUID()}.tmp`;
    try {
        if (!admitted()) throw new Error("Configuration operation cancelled");
        writeFileSync(temporary, JSON.stringify(next, null, 2), { flag: "wx", mode: 0o600 });
        if (!admitted()) throw new Error("Configuration operation cancelled");
        renameSync(temporary, path);
    } finally { rmSync(temporary, { force: true }); }
    return checked;
}
export function resolveModel(state: ConfigState, registry: ExtensionContext["modelRegistry"], main: Pick<ExtensionContext, "model">, thinking: Parameters<typeof resolveModelConfig>[3]) {
    return resolveModelConfig(state, registry, main, thinking, "Recap");
}
