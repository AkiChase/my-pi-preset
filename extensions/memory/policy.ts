export const TOPIC_BYTES = 16 * 1024;
export const METADATA_BYTES = 1024;
export const SCAN_BYTES = 2 * 1024 * 1024;
export const DIRECTORY_ENTRIES = 2000;
export const INDEX_BYTES = 25000;
export const INDEX_ENTRIES = 200;
export const LIST_BYTES = 8 * 1024;
export const TYPES = ["user", "feedback", "project", "reference"] as const;
export type MemoryType = typeof TYPES[number];
export interface Metadata { name: string; description: string; type: MemoryType; created: string; updated: string }
export interface WriteInput { name: string; description: string; type: MemoryType; body: string; expectedRevision: string | null }
export class MemoryError extends Error {
  readonly code: string;
  constructor(code: string, message: string) { super(message); this.code = code; this.name = "MemoryError"; }
}
export function fail(code: string, message: string): never { throw new MemoryError(code, message); }
export function validName(name: unknown): asserts name is string {
  if (typeof name !== "string" || !/^[a-z0-9][a-z0-9_-]{0,79}$/.test(name) || /^(?:index|memory|lock)$/.test(name))
    fail("name", "Invalid memory name: use a non-reserved lowercase ASCII slug of at most 80 characters.");
}
export function revision(value: unknown, nullable = false): void {
  if (!(nullable && value === null) && (typeof value !== "string" || !/^[a-f0-9]{64}$/.test(value))) fail("revision", "An exact SHA256 expectedRevision is required; creation requires null.");
}
const controls = /[\x00-\x1f\x7f-\x9f]/u;
export function metadata(value: Metadata): void {
  validName(value.name);
  if (typeof value.description !== "string" || !value.description.trim() || [...value.description].length > 160 || controls.test(value.description)) fail("metadata", "Description must be nonblank, control-free and at most 160 Unicode codepoints.");
  if (!TYPES.includes(value.type)) fail("type", "Memory type must be user, feedback, project or reference.");
  for (const date of [value.created, value.updated]) {
    if (typeof date !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(date) || !Number.isFinite(Date.parse(date)) || new Date(date).toISOString() !== date) fail("metadata", "Invalid memory timestamp.");
  }
}
export function checkSecrets(text: string): void {
  const rules: [string, RegExp][] = [
    ["private-key", /-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----/],
    ["api-token", /\b(?:sk-[A-Za-z0-9_-]{16,}|gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|AKIA[A-Z0-9]{16})\b/],
    ["credential-assignment", /\b(?:api[_-]?key|password|secret|access[_-]?token)\s*[:=]\s*["']?[^\s"']{8,}/i],
  ];
  for (const [rule, pattern] of rules) if (pattern.test(text)) fail("secret", `Memory rejected by secret rule: ${rule}. Values are not displayed.`);
}
export function header(meta: Metadata): string {
  metadata(meta);
  const text = `---\nname: ${JSON.stringify(meta.name)}\ndescription: ${JSON.stringify(meta.description)}\ntype: ${JSON.stringify(meta.type)}\ncreated: ${JSON.stringify(meta.created)}\nupdated: ${JSON.stringify(meta.updated)}\n---\n`;
  if (Buffer.byteLength(text) > METADATA_BYTES) fail("metadata", "Frontmatter exceeds 1KiB.");
  return text;
}
export function parseHeader(text: string, name: string): Metadata {
  const lines = text.split("\n");
  if (lines.shift() !== "---" || lines.pop() !== "" || lines.pop() !== "---" || lines.length !== 5) fail("metadata", "Malformed or oversized memory frontmatter.");
  const fields: Record<string, unknown> = {};
  for (const line of lines) {
    const match = /^(name|description|type|created|updated): (.+)$/.exec(line);
    if (!match || Object.hasOwn(fields, match[1])) fail("metadata", "Malformed memory frontmatter.");
    try { fields[match[1]] = JSON.parse(match[2]); } catch { fail("metadata", "Malformed memory frontmatter value."); }
  }
  const meta = fields as unknown as Metadata;
  metadata(meta);
  if (meta.name !== name) fail("metadata", "Memory filename and name do not match.");
  return meta;
}
export function topic(meta: Metadata, body: string): string {
  if (typeof body !== "string" || !body.trim()) fail("body", "A nonblank body is required; use memory_forget to delete.");
  if (/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f-\x9f]/u.test(body)) fail("body", "Body contains unsupported control characters.");
  checkSecrets(`${meta.description}\n${body}`);
  const text = header(meta) + body;
  if (Buffer.byteLength(text) > TOPIC_BYTES) fail("size", "Complete memory file exceeds 16KiB; shorten the body.");
  return text;
}
