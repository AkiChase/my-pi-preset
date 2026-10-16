/**
 * Shared bash parameter schema for the foreground/background execution contract.
 * Descriptions quote the effective configuration rather than stale defaults.
 */

import { Type } from "@earendil-works/pi-ai";
import type { ProcessTasksConfig } from "../config.ts";

/** Maximum foreground wait in seconds without overflowing Node's timer range. */
export const MAX_BACKGROUND_AFTER_SECONDS = 2_147_483.647;

/**
 * Parameter schema for the overridden `bash` tool.
 *
 * The schema describes each field; execute also rejects mode-dependent
 * combinations before spawning. Unknown fields must not silently discard intent.
 */
export function bashParamSchema(config: ProcessTasksConfig) {
    /** The configured foreground threshold in the seconds unit the model sends.
     *  Quoted by both the description and the advertised `default` so they
     *  cannot drift apart. */
    const defaultThresholdSeconds = config.timeoutMs / 1000;
    return Type.Object(
        {
            command: Type.String({ description: "Shell command to run" }),
            background_after_seconds: Type.Optional(
                Type.Number({
                    // Model-facing only: the host's `Value.Convert` never fills a
                    // `default`, so execute() still applies the real threshold and
                    // still rejects an out-of-range explicit one.
                    default: defaultThresholdSeconds,
                    exclusiveMinimum: 0,
                    maximum: MAX_BACKGROUND_AFTER_SECONDS,
                    description:
                        `Interactive foreground waiting period in seconds before backgrounding (default: ${defaultThresholdSeconds}). ` +
                        `Does not terminate execution. Greater than 0, maximum ${MAX_BACKGROUND_AFTER_SECONDS}. ` +
                        "Unsupported in non-interactive mode; omit when run_in_background=true.",
                })
            ),
            run_in_background: Type.Optional(
                Type.Boolean({
                    // Omitted means foreground; execute() reads it as false.
                    default: false,
                    description:
                        "Set to true to run this command in the background immediately; omit background_after_seconds. " +
                        `Output is saved to ${config.logDir}/<jobId>.log.`,
                })
            ),
            description: Type.Optional(
                Type.String({ description: "Short description of what this command does" })
            ),
        },
        { additionalProperties: false }
    );
}
