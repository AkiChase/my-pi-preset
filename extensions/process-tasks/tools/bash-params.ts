/** Explicit bash foreground/background request contract. */
import { Type } from "@earendil-works/pi-ai";
import type { ProcessTasksConfig } from "../config.ts";

/** Maximum foreground wait in seconds without overflowing Node's timer range. */
export const MAX_BACKGROUND_AFTER_SECONDS = 2_147_483.647;
const FIELDS = ["command", "background_after_seconds", "description"] as const;

export interface BashArguments {
    command: string;
    background_after_seconds: number;
    description: string;
}

export function bashParamSchema(config: ProcessTasksConfig) {
    return Type.Object({
        command: Type.String({ minLength: 1, description: "Nonblank shell command to run" }),
        background_after_seconds: Type.Number({
            minimum: -1,
            maximum: MAX_BACKGROUND_AFTER_SECONDS,
            description: `Seconds before backgrounding: -1 waits until completion or manual /task-detach; 0 starts immediately in background; a finite positive value waits then detaches without terminating execution (interactive only). Maximum ${MAX_BACKGROUND_AFTER_SECONDS}. Output is saved to ${config.logDir}/<jobId>.log.`,
        }),
        description: Type.String({ description: "Short description of what this command does; an empty string is valid" }),
    }, { additionalProperties: false });
}

/** Direct callers bypass host conversion: validate the complete raw request before effects. */
export function parseBashArguments(value: unknown, nonInteractive: boolean): BashArguments {
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Bash arguments must be an object containing command, background_after_seconds, description.");
    const input = value as Record<string, unknown>;
    for (const key of Reflect.ownKeys(input)) {
        if (typeof key !== "string" || !(FIELDS as readonly string[]).includes(key)) {
            const correction = key === "run_in_background" ? " Use background_after_seconds=0 for immediate background, -1 for foreground, or a positive interactive waiting period."
                : key === "timeout" ? " Use background_after_seconds for the interactive foreground waiting period, not an execution deadline."
                : key === "notify" ? " Background completion is reported automatically." : "";
            throw new Error(`Unknown bash parameter '${String(key)}'. Accepted fields: ${FIELDS.join(", ")}.${correction}`);
        }
    }
    for (const field of FIELDS) {
        if (!Object.hasOwn(input, field) || input[field] === undefined) throw new Error(`Bash parameter '${field}' must be provided explicitly; null is not supported.`);
    }
    const { command, background_after_seconds, description } = input;
    if (typeof command !== "string" || command.trim() === "") throw new Error("command must be a nonblank string.");
    if (typeof description !== "string") throw new Error("description must be a string; use an empty string when no description is needed.");
    if (typeof background_after_seconds !== "number" || !Number.isFinite(background_after_seconds) ||
        (background_after_seconds < 0 && background_after_seconds !== -1) || background_after_seconds > MAX_BACKGROUND_AFTER_SECONDS) {
        throw new Error(`background_after_seconds must be -1, 0, or a finite positive number and must not exceed ${MAX_BACKGROUND_AFTER_SECONDS} seconds.`);
    }
    if (nonInteractive && background_after_seconds > 0) throw new Error("Positive background_after_seconds is unsupported in non-interactive mode; use -1 to wait until completion or 0 for immediate background.");
    return { command, background_after_seconds, description };
}
