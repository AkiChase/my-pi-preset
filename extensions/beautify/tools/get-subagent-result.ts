import { validArgs, envelope, safeCount, type RetrievalContract } from "./retrieval-contracts.ts";
const notes: Record<string, string> = {
  stopped: " (STOPPED BY THE USER before completion — output is partial; the task was NOT finished)",
  aborted: " (aborted — hit the turn limit before completion; output may be incomplete)",
  steered: " (wrapped up at the turn limit — output may be partial)",
};
export const agentContract: RetrievalContract = (args, result, ctx) => {
  if (!validArgs(args, { agent_id: "string", wait: "boolean", verbose: "boolean" }, ["agent_id"])) return undefined;
  const title = `Agent ${args.agent_id}`;
  if (!result) return { title, stats: args.wait ? "waiting" : "" };
  const raw = envelope(result);
  if (raw === undefined || ctx.isPartial) return undefined;
  if (raw === `Agent not found: "${args.agent_id}". It may have been cleaned up.`) return { title, stats: "not found" };
  const wait = raw.match(/^Result wait (released|cancelled)\. Agent [^\s]+ continues unchanged; completion notification remains eligible\.$/);
  if (wait) return { title, stats: `wait ${wait[1]} · agent unchanged` };
  // The body and verbose conversation are arbitrary. Never search them for metadata.
  const header = raw.match(/^Agent: [^\s]+\nType: [^\n|]+ \| Status: (queued|running|completed|error|aborted|steered|stopped)([^\n]*?) \| (Tool uses: \d+[^\n]*)\nDescription: ([^\n]*(?:\n[^\n]+)*)\n\n/);
  if (!header || header[2] !== (notes[header[1]!] ?? "")) return undefined;
  const fields = header[3]!.split(" | ");
  if (!/^Tool uses: \d+$/.test(fields[0]!) || !safeCount(fields[0]!.slice("Tool uses: ".length))) return undefined;
  const last = fields.at(-1)!;
  if (!/^Duration: \d+\.\d+s(?: \(running\))?$/.test(last)) return undefined;
  const recognized = fields.slice(1, -1).filter(field => /^(?:\d+(?:\.\d+)?[kM]? token|Cost: (?:<|~)\$\d+\.\d+|Context: \d+%|Compactions: \d+)$/.test(field));
  return { title: header[4]?.trim() ? header[4] : title, stats: header[1]!, secondary: [last, fields[0], ...recognized].join(" · ") };
};
