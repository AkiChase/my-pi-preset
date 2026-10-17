import type { ProcessManagementParams } from "../tools.ts";

/** Complete valid model calls in tests; admission failure cases must use raw input. */
export function processInput(input: { action: string; [key: string]: unknown }): ProcessManagementParams & Record<string, string | number | boolean | null> {
  return { task_id: null, task_type: null, offset: null, limit: null, pattern: null, ignore_case: null, context: null, ...input } as ProcessManagementParams & Record<string, string | number | boolean | null>;
}
