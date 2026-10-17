import { Type, type TSchema } from "typebox";

/** A required model-tool field whose null value means not specified. */
export function nullableControl<T extends TSchema>(schema: T) {
  const description: unknown = Reflect.get(schema, "description");
  return Type.Union([Type.Null(), schema], typeof description === "string" ? { description } : {});
}

/** Check the complete wire shape before removing only declared control nulls. */
export function parseControlArguments(value: unknown, fields: readonly string[], controls: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Tool arguments must be an object.");
  const input = value as Record<string, unknown>;
  for (const key of Reflect.ownKeys(input)) {
    if (typeof key !== "string" || !fields.includes(key)) throw new Error(`Field '${String(key)}' is not accepted by this tool. Remove it; setting an unknown or disabled field to null does not make it valid.`);
  }
  for (const field of fields) {
    if (!Object.hasOwn(input, field) || input[field] === undefined) throw new Error(`Field '${field}' must be provided. Set unused nullable control fields to null.`);
  }
  const params = { ...input };
  for (const field of controls) if (params[field] === null) delete params[field];
  return params;
}
