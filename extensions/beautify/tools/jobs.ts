import { validArgs, envelope, jobStatus, duration, safeCount, type RetrievalContract } from "./retrieval-contracts.ts";
const fields = { action: "string", jobId: "string", pattern: "string", wait: "boolean", offset: "number", limit: "number", ignoreCase: "boolean", context: "number" } as const;
export const jobsContract: RetrievalContract = (args, result, ctx) => {
  if (!validArgs(args, fields, ["action"])) return undefined;
  const action = args.action;
  if (!["list", "output", "search", "stats", "attach", "kill"].includes(String(action))) return undefined;
  if (["output", "attach", "kill"].includes(String(action)) && !args.jobId) return undefined;
  if (action === "search" && !args.pattern) return undefined;
  const title = `${action}${action === "search" ? ` /${args.pattern}/${args.ignoreCase ? "i" : ""}` : ""}${args.jobId ? ` ${args.jobId}` : ""}`;
  if (!result) return { title, stats: action === "attach" && args.wait !== false ? "following · waiting" : "" };
  const raw = envelope(result);
  if (raw === undefined) return undefined;
  // streamLog supplies raw current output: it is not a status envelope.
  if (ctx.isPartial) return action === "attach" && args.wait !== false ? { title, stats: "following · waiting" } : undefined;
  const meta = (stats: string, secondary?: string) => ({ title, stats, secondary });
  if (ctx.isError) {
    if (raw === `No task found with ID: ${args.jobId}` || raw === `Job is not running: ${args.jobId}` || (action === "search" && /^Invalid regex: [^\n]+$/.test(raw))) return meta(`error: ${raw}`);
    return undefined;
  }
  if (action === "list") {
    if (raw === "No background jobs") return meta("0 jobs");
    if (!raw.startsWith("Background Jobs:\n")) return undefined;
    const lines = raw.slice("Background Jobs:\n".length).split("\n");
    // Names and commands may contain parentheses/status lookalikes. Validate each
    // record but omit status counts rather than choosing an ambiguous delimiter.
    const line = new RegExp(`^[^\\n]+ \\[(?:shell|agent|monitor)\\]: [^\\n]* - (?:◌ pending|[▶◉] (?:bg|fg|monitor) \\(${duration}\\)|✓ completed|✗ (?:failed|killed))(?: \\[notification failed: [^\\n]*\\])?$`);
    return lines.every(row => line.test(row)) ? meta(`${lines.length} jobs`) : undefined;
  }
  if (action === "output") {
    const head = raw.split("\n")[0]!;
    const match = head.match(new RegExp(`^Output for [^\\n]+ \\(${jobStatus}\\) — bytes (\\d+)-(\\d+) of (\\d+)$`));
    if (match && match.slice(1).every(safeCount)) {
      const [start, end, size] = match.slice(1).map(Number) as [number, number, number];
      if (start <= end && end <= size && raw.includes("\n")) return meta(`bytes ${start}-${end} of ${size}${start > 0 || end < size ? " · omitted" : ""}`);
    }
    const where = args.offset === undefined ? "yet " : `at offset ${args.offset} `;
    if (raw.startsWith(`No output ${where}for `) && new RegExp(` \\(${jobStatus}\\)\\. Log: [^\\n]+$`).test(raw) && !raw.includes("\n")) return meta("no output");
  }
  if (action === "search") {
    const pattern = `/${args.pattern}/${args.ignoreCase ? "i" : ""}`;
    const header = raw.split("\n")[0]!;
    const match = header.match(/^Found (\d+) matches for ([\s\S]+) across (\d+) job\(s\):$/);
    if (match && match[2] === pattern && safeCount(match[1]!) && safeCount(match[3]!) && raw.startsWith(`${header}\n\n`)) return meta(`${match[1]} matches · ${match[3]} jobs`, "preview limited per job");
    if (raw.startsWith(`No matches for ${pattern} in `) && raw.endsWith(".") && !raw.includes("\n")) return meta("0 matches");
  }
  if (action === "stats") {
    const match = raw.match(new RegExp(`^Background Jobs Stats:\\nTotal started: +(\\d+)\\nCurrently running: +(\\d+)\\nCompleted: +(\\d+)\\nFailed: +(\\d+)\\nKilled: +(\\d+)\\nAverage duration: +${duration}\\nTotal elapsed: +${duration}$`));
    if (match && match.slice(1).every(safeCount)) {
      const terminal = Number(match[3]) + Number(match[4]) + Number(match[5]);
      if (Number.isSafeInteger(terminal)) return meta(`${match[2]} running · ${terminal} terminal`);
    }
  }
  if (action === "kill" && raw.startsWith(`Successfully stopped task: ${args.jobId} (`) && raw.endsWith(")") && !raw.includes("\n")) return meta("stop reported");
  if (action === "attach") {
    if (new RegExp(`^Stopped following [^\\n]+ — (?:status: ${jobStatus}\\. Use jobs output for the full log\\.|it's still ${jobStatus} in the (?:background|foreground)\\. Use jobs output to check on it\\.)$`).test(raw)) return meta("following released");
    const finished = raw.match(new RegExp(`^[^\\n]+ finished\\. Status: (${jobStatus})\\. Use jobs output for the full log\\.$`));
    if (finished && ["completed", "failed", "killed"].includes(finished[1]!)) return meta(finished[1]!);
    const current = raw.match(new RegExp(`^[^\\n]+ is (${jobStatus})\\. Use jobs output for a non-blocking peek\\.$`));
    if (current && args.wait === false) return meta(current[1]!);
  }
  return undefined;
};
