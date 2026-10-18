/** Test-only explicit model-tool input; never used to fill product arguments. */
export function listInput(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return { query: "", offset: 0, limit: 20, ...overrides };
}
