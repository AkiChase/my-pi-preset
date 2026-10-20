/** Explicit subagent input namespace. Ordinary @ text remains Pi file input. */
export const MENTION_TRIGGER = /(^|[\s。、？！])(@agent:(?:create|resume):[^\s]*)$/;
const INPUT = /^@agent:(create|resume):([^\s]+)\s+([\s\S]+)$/;

export type AgentInput = { operation: "create" | "resume"; target: string; message: string };
export function parseAgentInput(text: string): AgentInput | null {
  const match = INPUT.exec(text);
  if (!match) return null;
  const message = match[3].trim();
  return message ? { operation: match[1] as "create" | "resume", target: match[2], message } : null;
}
/** User-friendly, scope-local resume spelling. */
export function resumeKey(type: string, index: number): string {
  return `${type.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "") || "agent"}_${index}`;
}
