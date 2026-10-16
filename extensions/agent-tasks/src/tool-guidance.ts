export interface RunGuidanceOptions {
  nested: boolean;
  backgroundByDefault: boolean;
  isolation: boolean;
  scheduling: boolean;
  agentTypes: string;
}

/** Official registration guidance; no alternate prompt assembler or template I/O. */
export function runToolGuidance(options: RunGuidanceOptions): string[] {
  const spawnExtras = `${options.isolation ? ", isolation" : ""}${options.scheduling ? ", schedule" : ""}`;
  const modeRule = options.nested
    ? "New nested agents default to foreground unless their configuration overrides it. Background launch requires an available owned agent_manage tool, and owned children are stopped when their parent finishes. Nested resume is always foreground; do not pass run_in_background with resume."
    : `Without an agent-file pin or an explicit run_in_background, execution defaults to ${options.backgroundByDefault ? "background" : "foreground"}. Use foreground when your next action depends on the result; otherwise do useful independent work while background execution runs.`;
  return [`Subagent_run usage:
  - Use specialized agents for substantial independent work or broad exploration. Use direct tools for small work whose target is already known. Do not duplicate delegated investigation.
  - Give a self-contained prompt with the goal, relevant context, constraints, permission to edit or research only, and the expected result. Inspect actual changes and verification before reporting success; a delegated summary is not proof.
  - Accepted arguments by mode:
    New: prompt, description, subagent_type; optional ${options.nested ? "" : "name, "}model, thinking, run_in_background, isolated, inherit_context${spawnExtras}.
    Resume: prompt, resume${options.nested ? "" : "; optional run_in_background"}.
    Do not pass fields outside the selected mode. Required strings must be non-empty; description is a short, specific UI summary for new agents only.
  - Available permitted agent types:
${options.agentTypes.split("\n").map(line => `    ${line}`).join("\n")}
  - Resume uses the real agent_id of a finished, resumable agent and retains its type, name and stored session settings. Do not repeat new-agent fields. Use subagent_message for a running agent.
  - Agent-file configuration takes precedence over call parameters. Omitted values use configuration/defaults. Results state explicit requests overridden by configuration; do not assume a requested value became effective.
  - ${modeRule}
  - A background launch means accepted or queued, not completed. Copy agent_id for messaging/resume and execution_id for agent_manage status/output/wait/stop. Do not substitute IDs. Foreground returns inline results; releasing a wait does not stop execution.
  - Background completion is notified automatically. Do not poll or sleep solely to detect it, and never invent pending results. Summarize actual results for the user.
${options.isolation ? '  - isolation selects Git working-directory isolation: off uses the current checkout, worktree uses a temporary copy that cannot see uncommitted changes. Follow project worktree authorization. isolated is different: it disables extension/MCP tools.\n' : ""}${options.scheduling ? '  - Use schedule only for explicitly requested delayed/recurring execution. It creates a scheduled definition, not a current execution; it cannot combine with resume, inherit_context or run_in_background:false.\n' : ""}  - Examples:
    New: {"subagent_type":"<available_type>","prompt":"Inspect login validation; do not edit files; report concrete defects.","description":"Inspect login validation","run_in_background":false}
    Resume: {"resume":"<agent_id>","prompt":"Check the remaining boundary cases."}`];
}

export function messageToolGuidance(): string[] {
  return [`Subagent_message usage:
  - Send additional guidance to a currently running agent within your permitted ownership scope. This does not start a new execution or resume a finished agent.
  - Provide agent_id and a non-empty message. Copy the real agent_id from launch/list; names, type aliases and execution_id are not accepted.
  - Queued means waiting for the agent session to initialize. Sent means submitted to that session. Neither confirms that the agent has read, acted on or answered the message.
  - For a finished agent use subagent_run with resume. For execution progress/results use agent_manage with execution_id.
  - Example:
    {"agent_id":"<agent_id>","message":"Also check expired verification codes; keep the scope unchanged."}`];
}
