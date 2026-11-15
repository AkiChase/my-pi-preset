import type { TSchema } from "typebox";

/**
 * Build a complete model call. Fields not given and fields given as JSON null get
 * the "null" sentinel, which every control accepts where it does not apply and
 * defaultable controls also accept as their default. Explicit undefined is
 * preserved for negative cases.
 */
export function completeToolCall(schema: TSchema, values: Record<string, unknown>): Record<string, unknown> {
  const properties = Reflect.get(schema, "properties") as Record<string, unknown>;
  const filled: Record<string, unknown> = Object.fromEntries(Object.keys(properties).map(field => [field, "null"]));
  for (const [field, value] of Object.entries(values)) filled[field] = value === null && Object.hasOwn(properties, field) ? "null" : value;
  return filled;
}
