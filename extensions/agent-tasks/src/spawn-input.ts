/** Minimal admission guards shared by programmatic dispatch and the manager. */
export function normalizeAgentDescription(description: unknown, type: string): string {
  if (description == null) return type;
  if (typeof description !== "string") throw new Error("Agent description must be a string, null, or omitted");
  return description.trim() ? description : type;
}

export function parseSpawnOptions(options: unknown): Record<string, unknown> {
  if (options === undefined) return {};
  if (options === null || typeof options !== "object" || Array.isArray(options)) {
    throw new Error("Agent spawn options must be an object or omitted");
  }
  return { ...options };
}

export function assertSpawnInput(type: unknown, prompt: unknown): asserts type is string {
  if (typeof type !== "string" || !type.trim()) throw new Error("Agent type must be a non-empty string");
  if (typeof prompt !== "string") throw new Error("Agent prompt must be a string");
}

/**
 * A required non-empty string.
 *
 * The host's job is the type; this is the emptiness half, which a schema cannot
 * express without a pattern that would have to allow every language's
 * whitespace. A run started from a blank prompt or a blank description wastes a
 * full agent turn before anyone finds out, so the tools reject it up front.
 */
export function assertNonEmptyString(value: unknown, label: string): asserts value is string {
  if (typeof value !== "string") throw new Error(`${label} must be a string, got ${value === null ? "null" : typeof value}.`);
  if (!value.trim()) throw new Error(`${label} must be a non-empty string; it was blank.`);
}
