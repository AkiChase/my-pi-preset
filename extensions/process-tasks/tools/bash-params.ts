/**
 * Shared bash parameter schema (TypeBox) used by the overridden `bash` tool.
 *
 * A function rather than a constant because two of the descriptions quote
 * configured values (the timeout default and the log directory) — a stale
 * literal there would be a lie told directly to the model.
 */

import { Type } from "@earendil-works/pi-ai";
import type { ProcessTasksConfig } from "../config.ts";

/**
 * Largest accepted `timeout`, in seconds — the built-in bash tool's own limit
 * (`MAX_TIMEOUT_MS / 1000`). Above it the millisecond delay this override hands
 * to `setTimeout` exceeds Node's 2^31-1 timer range, so the timer fires almost
 * immediately and a request for a long wait silently becomes a short one.
 * Rejecting a value the built-in also rejects keeps the two tools consistent.
 */
export const MAX_TIMEOUT_SECONDS = 2_147_483.647;

/**
 * Parameter schema for the overridden `bash` tool.
 *
 * A function rather than a constant because two of the descriptions quote
 * configured values (the timeout default and the log directory) — a stale
 * literal there would be a lie told directly to the model.
 *
 * `additionalProperties: false` is deliberate: a misspelled optional field is
 * otherwise accepted and silently ignored, so `{"command":"…","timeuot":1}`
 * would run with the configured timeout instead of erroring. The host validates
 * this before `execute` runs and reports the field path.
 */
export function bashParamSchema(config: ProcessTasksConfig) {
    return Type.Object(
        {
            command: Type.String({ description: "Shell command to run" }),
            timeout: Type.Optional(
                Type.Number({
                    exclusiveMinimum: 0,
                    maximum: MAX_TIMEOUT_SECONDS,
                    description:
                        `Timeout in seconds, greater than 0 (default: ${Math.round(config.timeoutMs / 1000)}). ` +
                        `Maximum ${MAX_TIMEOUT_SECONDS} seconds.`,
                })
            ),
            run_in_background: Type.Optional(
                Type.Boolean({
                    description:
                        "Set to true to run this command in the background immediately. " +
                        `Output is saved to ${config.logDir}/<jobId>.log.`,
                })
            ),
            notify: Type.Optional(Type.Boolean({ description: "Completion notification (default true); only valid with run_in_background=true" })),
            description: Type.Optional(
                Type.String({ description: "Short description of what this command does" })
            ),
        },
        { additionalProperties: false }
    );
}
