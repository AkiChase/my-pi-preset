/**
 * Complete valid process_manage model calls in tests; admission failure cases must use raw input.
 * Unset fields and JSON null become "null"; numbers become the decimal strings a model sends.
 */
export function processInput(input: { action: string; [key: string]: unknown }): Record<string, string> {
  const call: Record<string, string> = { task_id: "null", task_type: "null", offset: "null", limit: "null", pattern: "null", case: "null", context: "null" };
  for (const [key, value] of Object.entries(input)) {
    call[key] = value === null ? "null" : String(value);
  }
  return call;
}
