import { StringEnum } from "@earendil-works/pi-ai";
import { Type, type TSchema } from "typebox";

/** A required model-tool field whose null value means not specified. Legacy; superseded by string sentinels. */
export function nullableControl<T extends TSchema>(schema: T) {
  const description: unknown = Reflect.get(schema, "description");
  return Type.Union([Type.Null(), schema], typeof description === "string" ? { description } : {});
}

/** Check the complete wire shape before removing only declared control nulls. Legacy; superseded by parseControls. */
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

/*
 * String sentinels for model-facing tool controls.
 *
 * Model tool schemas never use the JSON `null` type: several providers encode a
 * model's `null` as the string "null", which then passes a string branch as a
 * real value. Every field stays required; a control field is filled with one of
 * two words instead:
 *
 * - "null": the field does not apply, or nothing is selected/set.
 * - "default": use the configured or built-in default.
 *
 * pi coerces a JSON `null` to "null" for string schemas before validation, so
 * both spellings converge. A defaultable field also accepts "null" where it
 * applies and treats it as "default". Sentinels only carry meaning on fields
 * declared as controls; elsewhere "null" is literal text.
 */
export const NULL_SENTINEL = "null";
export const DEFAULT_SENTINEL = "default";
export type Sentinel = typeof NULL_SENTINEL | typeof DEFAULT_SENTINEL;

/** A string control. The schema stays a plain string; the parser recognizes the sentinel. */
export function sentinelString(description: string) {
  return Type.String({ description });
}

/** A string enum that also accepts "null". */
export function nullableEnum<const T extends readonly string[]>(values: T, description: string) {
  return StringEnum([...values, NULL_SENTINEL] as unknown as readonly [...T, "null"], { description });
}

/** A string enum that also accepts "default" and, as the same default, "null". */
export function defaultableEnum<const T extends readonly string[]>(values: T, description: string) {
  return StringEnum([DEFAULT_SENTINEL, ...values, NULL_SENTINEL] as unknown as readonly ["default", ...T, "null"], { description });
}

/** A non-negative decimal integer written as a string, or one of the given sentinels. */
export function integerString(sentinels: readonly Sentinel[], description: string) {
  const alternatives = [...new Set([...sentinels, ...(sentinels.includes(DEFAULT_SENTINEL) ? [NULL_SENTINEL] : [])])];
  return Type.String({ pattern: `^(${[...alternatives, "[0-9]+"].join("|")})$`, description });
}

/** An object control that is either the object or "null". */
export function nullableObject<T extends TSchema>(schema: T, description: string) {
  return Type.Union([schema, StringEnum([NULL_SENTINEL] as const)], { description });
}

export interface ControlSpec {
  /** "nullable" accepts "null"; "defaultable" accepts "default" and also "null" as the default. */
  kind: "nullable" | "defaultable";
  /** Parse a real value as a decimal integer string with this minimum. */
  integer?: { min: number };
}

export interface ParsedControls {
  /** Real values only. Required non-control fields are copied unchanged; sentinel controls are absent. */
  values: Record<string, unknown>;
  /** The sentinel written for each control that held one. */
  sentinels: Record<string, Sentinel>;
}

function sentinelHint(spec: ControlSpec): string {
  return spec.kind === "defaultable" ? `"default" (or "null" where it does not apply)` : `"null"`;
}

/**
 * Check the complete wire shape and separate sentinel controls from real values.
 * Branch rules (not applicable / required) are applied afterwards by the tool.
 */
export function parseControls(value: unknown, fields: readonly string[], controls: Readonly<Record<string, ControlSpec>>): ParsedControls {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Tool arguments must be an object.");
  const input = value as Record<string, unknown>;
  for (const key of Reflect.ownKeys(input)) {
    if (typeof key !== "string" || !fields.includes(key)) throw new Error(`Field '${String(key)}' is not accepted by this tool. Remove it.`);
  }
  for (const field of fields) {
    if (!Object.hasOwn(input, field) || input[field] === undefined) {
      const spec = controls[field];
      throw new Error(`Field '${field}' must be provided.${spec ? ` Use ${sentinelHint(spec)} when it has no value.` : ""}`);
    }
  }
  const values: Record<string, unknown> = {};
  const sentinels: Record<string, Sentinel> = {};
  for (const field of fields) {
    const raw = input[field];
    const spec = controls[field];
    if (!spec) { values[field] = raw; continue; }
    if (raw === NULL_SENTINEL) { sentinels[field] = NULL_SENTINEL; continue; }
    if (raw === DEFAULT_SENTINEL && spec.kind === "defaultable") { sentinels[field] = DEFAULT_SENTINEL; continue; }
    if (raw === null) throw new Error(`\`${field}\` must not be JSON null; use the string ${sentinelHint(spec)}.`);
    if (raw === "") throw new Error(`\`${field}\` is empty; use ${sentinelHint(spec)} when it has no value.`);
    if (spec.integer) {
      const text = typeof raw === "number" ? String(raw) : raw;
      if (typeof text !== "string" || !/^[0-9]+$/.test(text) || !Number.isSafeInteger(Number(text)) || Number(text) < spec.integer.min) {
        throw new Error(`\`${field}\` must be ${spec.integer.min > 0 ? "a positive" : "a non-negative"} integer string or ${sentinelHint(spec)}.`);
      }
      values[field] = Number(text);
      continue;
    }
    values[field] = raw;
  }
  return { values, sentinels };
}

/** Reject any value other than "null" in fields that do not apply to this branch. */
export function rejectInapplicable(parsed: ParsedControls, fields: readonly string[], context: string): void {
  for (const field of fields) {
    if (parsed.sentinels[field] === NULL_SENTINEL) continue;
    const written = parsed.sentinels[field] === DEFAULT_SENTINEL ? `"default"` : "a value";
    throw new Error(`\`${field}\` does not apply ${context}; set it to "null" (got ${written}).`);
  }
}

/** Require a real value in a field that applies to this branch. */
export function requireValue(parsed: ParsedControls, field: string, context: string): unknown {
  if (Object.hasOwn(parsed.values, field)) return parsed.values[field];
  throw new Error(`\`${field}\` is required ${context}; "${parsed.sentinels[field] ?? NULL_SENTINEL}" is not a value.`);
}

/** For renderers reading raw (possibly unparsed or historical) arguments: a real string value, or undefined for sentinels/JSON null/non-strings. */
export function argText(value: unknown): string | undefined {
  return typeof value === "string" && value !== NULL_SENTINEL && value !== DEFAULT_SENTINEL ? value : undefined;
}
