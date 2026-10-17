import type { TSchema } from "typebox";

/** Build a complete model call; explicit undefined is preserved for negative cases. */
export function completeToolCall(schema: TSchema, values: Record<string, unknown>): Record<string, unknown> {
  const properties = Reflect.get(schema, "properties") as Record<string, unknown>;
  return { ...Object.fromEntries(Object.keys(properties).map(field => [field, null])), ...values };
}
