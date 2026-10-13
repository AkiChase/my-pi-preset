/**
 * Configuration for the process-tasks extension.
 *
 * Upstream v2.0.0 had no configuration surface at all: every knob was an
 * `export const` in types.ts and every shortcut a hardcoded string in
 * shortcuts.ts. This preset follows its owner onto several machines with
 * different needs (a 120s timeout that is right on a laptop is wrong on a box
 * that runs 20-minute builds; `shift+down` may be wanted by another extension),
 * so the knobs live in a file.
 *
 * Precedence: environment variable > config file > default — the same order
 * pi-pretty uses, so the two behave alike.
 *
 * The loader is deliberately synchronous and total: `pi.registerShortcut` runs
 * while the extension loads, so there is no place to await, and a malformed
 * config must never prevent the extension from loading. Every bad value is
 * replaced by its default and reported through `warnings`.
 */

import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export interface ProcessTasksConfig {
    /** Foreground commands auto-background after this long. */
    timeoutMs: number;
    /** Where job logs are written. */
    logDir: string;
    maxConcurrentJobs: number;
    /** A job whose log exceeds this is killed. */
    maxLogBytes: number;
    /** How much log tail `jobs output` and a finished foreground command show. */
    outputPreviewChars: number;
    /** Lines of log inlined into a failed job's notification. */
    failureTailLines: number;
    /** Character bound on that tail (read from the end of the file). */
    failureTailChars: number;
    /** How many of those lines the TUI renders under the summary. */
    failureTailLinesShown: number;
    stallCheckIntervalMs: number;
    /** No log growth for this long + a prompt-like tail ⇒ stall warning. */
    stallThresholdMs: number;
    stallTailBytes: number;
    /** Minimum interval between ordinary monitor progress submissions; 0 sends each source batch. */
    monitorFlushMs: number;
    /** Maximum preview lines per monitor batch. */
    monitorMaxLinesPerEvent: number;
}

/** Every default in one place. Frozen: a caller that mutates this would change
 *  the fallback for every later load, including inside tests. */
export const DEFAULTS: ProcessTasksConfig = Object.freeze({
    timeoutMs: 120_000,
    logDir: "/tmp/pi-bg",
    maxConcurrentJobs: 16,
    maxLogBytes: 100 * 1024 * 1024,
    outputPreviewChars: 12_000,
    failureTailLines: 20,
    failureTailChars: 2_000,
    failureTailLinesShown: 5,
    stallCheckIntervalMs: 5_000,
    stallThresholdMs: 45_000,
    stallTailBytes: 1_024,
    monitorFlushMs: 30_000,
    monitorMaxLinesPerEvent: 50,
} satisfies ProcessTasksConfig);

/** Config file name inside the agent directory. */
export const CONFIG_FILENAME = "process-tasks.json";

type NumericKey = {
    [K in keyof ProcessTasksConfig]: ProcessTasksConfig[K] extends number ? K : never;
}[keyof ProcessTasksConfig];

/** Bounds are sanity rails, not taste: they reject values that would wedge the
 *  extension (a 0ms poll spins a core; a 1-byte log cap kills every job). */
const NUMERIC_BOUNDS: Record<NumericKey, { min: number; max: number }> = {
    timeoutMs: { min: 1_000, max: 24 * 3_600_000 },
    maxConcurrentJobs: { min: 1, max: 256 },
    maxLogBytes: { min: 64 * 1024, max: 100 * 1024 * 1024 * 1024 },
    outputPreviewChars: { min: 200, max: 1_000_000 },
    failureTailLines: { min: 1, max: 1_000 },
    failureTailChars: { min: 100, max: 200_000 },
    failureTailLinesShown: { min: 0, max: 100 },
    stallCheckIntervalMs: { min: 500, max: 600_000 },
    stallThresholdMs: { min: 1_000, max: 24 * 3_600_000 },
    stallTailBytes: { min: 64, max: 1024 * 1024 },
    monitorFlushMs: { min: 0, max: 600_000 },
    monitorMaxLinesPerEvent: { min: 1, max: 100_000 },
};

const NUMERIC_KEYS = Object.keys(NUMERIC_BOUNDS) as NumericKey[];
const ALL_KEYS: readonly (keyof ProcessTasksConfig)[] = [
    ...NUMERIC_KEYS,
    "logDir",
];

/** `timeoutMs` → `PROCESS_TASKS_TIMEOUT_MS`. One rule, no lookup table to drift. */
export function envNameFor(key: keyof ProcessTasksConfig): string {
    return `PROCESS_TASKS_${key.replace(/([a-z0-9])([A-Z])/g, "$1_$2").toUpperCase()}`;
}

export interface LoadedConfig {
    config: ProcessTasksConfig;
    /** Human-readable problems found while loading. Never throws instead. */
    warnings: string[];
    /** The file that was read, or undefined when there was none. */
    path: string | undefined;
}

/** The agent directory holding the config file. Mirrors pi's own resolution
 *  (`PI_CODING_AGENT_DIR`, else `~/.pi/agent`). */
export function getConfigDir(): string {
    return process.env.PI_CODING_AGENT_DIR ?? join(homedir(), ".pi", "agent");
}

/** Expand a leading `~` so `"~/logs/pi-bg"` works in the config file. */
function expandHome(p: string): string {
    if (p === "~") return homedir();
    if (p.startsWith("~/")) return join(homedir(), p.slice(2));
    return p;
}

function parseNumber(
    key: NumericKey,
    raw: unknown,
    source: string,
    warnings: string[]
): number | undefined {
    const n = typeof raw === "string" ? Number(raw.trim()) : raw;
    if (typeof n !== "number" || !Number.isFinite(n)) {
        warnings.push(`${source} ${key}: expected a number, got ${JSON.stringify(raw)} — using default`);
        return undefined;
    }
    const { min, max } = NUMERIC_BOUNDS[key];
    if (n < min || n > max) {
        warnings.push(`${source} ${key}: ${n} is outside ${min}–${max} — using default`);
        return undefined;
    }
    // Every numeric knob is a count of ms/bytes/lines; a fractional one would
    // silently round somewhere downstream.
    return Math.round(n);
}

function parseLogDir(
    raw: unknown,
    source: string,
    warnings: string[]
): string | undefined {
    if (typeof raw !== "string" || raw.trim() === "") {
        warnings.push(`${source} logDir: expected a non-empty path — using default`);
        return undefined;
    }
    return expandHome(raw.trim());
}

/** Read and parse the config file. A missing file is normal, not a warning. */
function readConfigFile(
    path: string,
    warnings: string[]
): Record<string, unknown> | undefined {
    let text: string;
    try {
        text = readFileSync(path, "utf-8");
    } catch (err) {
        // ENOENT is the common case (no config written yet); anything else —
        // a permission problem, a directory in its place — is worth reporting.
        if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
            warnings.push(`could not read ${path}: ${(err as Error).message}`);
        }
        return undefined;
    }
    try {
        const parsed: unknown = JSON.parse(text);
        if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
            warnings.push(`${path}: expected a JSON object — ignoring the file`);
            return undefined;
        }
        return parsed as Record<string, unknown>;
    } catch (err) {
        warnings.push(`${path}: invalid JSON (${(err as Error).message}) — ignoring the file`);
        return undefined;
    }
}

/**
 * Load the configuration. `agentDir` is injectable so tests never touch the
 * real `~/.pi`; `env` likewise.
 */
export function loadConfig(
    agentDir: string = getConfigDir(),
    env: NodeJS.ProcessEnv = process.env
): LoadedConfig {
    const warnings: string[] = [];
    const path = join(agentDir, CONFIG_FILENAME);
    const file = readConfigFile(path, warnings);

    if (file) {
        for (const key of Object.keys(file)) {
            if (!(ALL_KEYS as readonly string[]).includes(key)) {
                warnings.push(`${CONFIG_FILENAME}: unknown key "${key}" — ignored`);
            }
        }
    }

    // Start from the defaults, then let the file and finally the environment
    // override. Writing it as a mutable copy keeps each key's handling in one
    // place instead of three parallel merge passes.
    const config: ProcessTasksConfig = { ...DEFAULTS };

    const resolve = <K extends keyof ProcessTasksConfig>(
        key: K,
        parse: (raw: unknown, source: string) => ProcessTasksConfig[K] | undefined
    ): void => {
        if (file && file[key] !== undefined) {
            const parsed = parse(file[key], `${CONFIG_FILENAME}:`);
            if (parsed !== undefined) config[key] = parsed;
        }
        const raw = env[envNameFor(key)];
        if (raw !== undefined) {
            const parsed = parse(raw, `${envNameFor(key)}:`);
            if (parsed !== undefined) config[key] = parsed;
        }
    };

    for (const key of NUMERIC_KEYS) {
        resolve(key, (raw, source) => parseNumber(key, raw, source, warnings));
    }
    resolve("logDir", (raw, source) => parseLogDir(raw, source, warnings));

    return { config, warnings, path: file ? path : undefined };
}
