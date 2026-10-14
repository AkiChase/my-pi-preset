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
