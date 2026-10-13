/**
 * Shared bash parameter schema (TypeBox) used by the overridden `bash` tool.
 *
 * A function rather than a constant because two of the descriptions quote
 * configured values (the timeout default and the log directory) — a stale
 * literal there would be a lie told directly to the model.
 */

import { Type } from "@earendil-works/pi-ai";
import type { ProcessTasksConfig } from "../config.ts";

export function bashParamSchema(config: ProcessTasksConfig) {
    return Type.Object({
        command: Type.String({ description: "Shell command to run" }),
        timeout: Type.Optional(
            Type.Number({
                description: `Timeout in seconds (default: ${Math.round(config.timeoutMs / 1000)})`,
            })
        ),
        run_in_background: Type.Optional(
            Type.Boolean({
                description:
                    "Set to true to run this command in the background immediately. " +
                    `Output is saved to ${config.logDir}/<jobId>.log.`,
            })
        ),
        description: Type.Optional(
            Type.String({ description: "Short description of what this command does" })
        ),
    });
}
