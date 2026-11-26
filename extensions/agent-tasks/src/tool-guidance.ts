export interface RunGuidanceOptions {
  nested: boolean;
  isolation: boolean;
  agentTypes: string;
}

/** Official registration guidance; no alternate prompt assembler or template I/O. */
export function runToolGuidance(options: RunGuidanceOptions): string[] {
  const isolation = options.isolation ? { isolation: "default" } : {};
  const newExample = JSON.stringify({ prompt: "Inspect login validation; do not edit files; report concrete defects.", description: "Inspect login validation", subagent_type: "<available_type>", model: "default", thinking: "default", execution: "foreground", resume: "null", tools: "default", context: "default", ...isolation });
  const resumeExample = JSON.stringify({ prompt: "Check the remaining boundary cases.", description: "null", subagent_type: "null", model: "null", thinking: "null", execution: options.nested ? "null" : "default", resume: "<agent_id>", tools: "null", context: "null", ...(options.isolation ? { isolation: "null" } : {}) });
  const spawnExtras = options.isolation ? ", isolation" : "";
  const modeRule = options.nested
    ? 'New nested agents: execution "default" uses agent configuration, otherwise foreground. Background needs owned agent_manage; collect before finishing, when owned children are stopped.'
    : 'execution "default" uses the configured execution mode. Use "foreground" for dependent next steps; otherwise use "background" and do independent work meanwhile.';
  return [`Subagent_run usage:
  - Use specialized agents for substantial independent work/broad exploration; known small tasks use direct tools. Do not duplicate delegated investigation. Self-contained prompt: goal, context, constraints, edit/read-only permission, expected result. Verify actual changes/results; a delegated summary is not proof.
  - Detailed coordination: read the currently discovered, model-invocable subagents Skill at its supplied path with a permitted reader. If unavailable/unreadable/displaced, do not guess paths or claim it was read; the basic tool contract still applies.
  - Provide every exposed field as a string; never JSON null. Two sentinel words: "null" means the field does not apply; "default" means use configuration/defaults. resume "null" starts a new agent. Unknown/disabled fields are invalid.
  - Fields by mode:
    New: prompt, description, subagent_type required; model, thinking, execution, tools, context${spawnExtras} take a value or "default"; resume "null".
    Resume: prompt, resume required${options.nested ? "" : "; execution takes a value or \"default\""}; every other field "null".
    Required strings must be non-empty; description is a short, specific UI summary for new agents only.
  - Available permitted agent types:
${options.agentTypes.split("\n").map(line => `    ${line}`).join("\n")}
  - Resume uses a finished, resumable ${options.nested ? "owned child's " : "agent's "}real agent_id; retain type and session settings. ${options.nested ? "Nested resume waits inline; execution must be \"null\"." : "This execution mode is resolved again."} Set resume to \"null\" for a new agent; an empty string is invalid. Use subagent_message for a running agent.
  - An explicit model takes precedence over agent configuration; model "default" uses agent configuration, otherwise the parent session model. Other applicable call parameters remain subordinate to agent-file configuration; inspect effective/overridden requests in results. ${modeRule}
  - Background launch is accepted/queued, not completed. Copy agent_id for messaging, resume, and agent_manage; never substitute IDs. Foreground returns inline; releasing wait does not stop execution.
  - A foreground wait also ends early when the agent sends an attention message${options.nested ? " (only when you own agent_manage)" : ""}: the result carries the message and the agent continues in the background, not finished. Decide whether to steer, stop or wait again; ${options.nested ? "collect its result with agent_manage before finishing." : "its completion is still notified."}
  - ${options.nested ? "Collect owned background results before finishing; do not rely on top-level completion notifications." : "Background completion is notified automatically."} Do not poll/sleep solely to detect completion or invent results.
${options.isolation ? '  - isolation selects Git working-directory isolation: off uses the current checkout, worktree uses a temporary copy that cannot see uncommitted changes. Follow project worktree authorization. tools \"builtin\" is different: it disables extension/MCP tools.\n' : ""}  - Examples:
    New: ${newExample}
    Resume: ${resumeExample}`];
}

export function messageToolGuidance(options: { reply: boolean; nested?: boolean } = { reply: false }): string[] {
  if (!options.reply) return [`Subagent_message usage:
  - Send additional guidance to a currently running agent within your permitted ownership scope. This does not start a new execution or resume a finished agent.
  - Provide agent_id and message as non-empty strings. Copy the real agent_id from launch/list; names, type aliases and execution_id are not accepted.
  - Queued means waiting for the agent session to initialize. Sent means submitted to that session. Neither confirms that the agent has read, acted on or answered the message.
  - For a finished agent use subagent_run with resume. For execution progress/results use agent_manage with agent_id.
  - Example:
    {"agent_id":"<agent_id>","message":"Also check expired verification codes; keep the scope unchanged."}`];
  return [`Subagent_message usage:
  - Send guidance or a question to a currently running agent within your permitted ownership scope. This does not start a new execution or resume a finished agent.
  - Provide agent_id and message as non-empty strings. Copy the real agent_id from launch/list; names, type aliases and execution_id are not accepted.
  - reply "skip" sends plain guidance. Queued means waiting for the agent session to initialize; sent means submitted to it. Neither confirms the agent has read or acted on it.
  - reply "wait" asks a question and waits in this call for the agent's reply via its reply_to_parent tool. The agent sees the question after its current tool calls finish. The wait ends on reply, when that execution ends unanswered, when the agent sends an attention message, or when the user releases it; an early end does not withdraw the question, and a later reply is delivered to you.
  - reply "notify" asks a question and returns its request_id at once; the reply is delivered to you when it arrives.
  - Agents also send unsolicited notices while they keep working. Replies and notices arrive as <subagent-message> context; ones received while you wait on that execution are appended to that wait's result instead${options.nested ? ", except agent_manage wait, after which they arrive as context" : ""}. An attention notice (marked urgency="attention" or [attention]) ends ${options.nested ? "a reply wait, an agent_manage wait, and a foreground wait when you own agent_manage" : "any wait on that execution"} at once; the agent keeps running, so act on it rather than waiting blindly.
  - An agent that needs your decision to continue ends its run and explains why; answer it with subagent_run resume. For execution progress/results use agent_manage with agent_id.
  - Examples:
    {"agent_id":"<agent_id>","message":"Also check expired verification codes; keep the scope unchanged.","reply":"skip"}
    {"agent_id":"<agent_id>","message":"Which file defines the session schema?","reply":"wait"}`];
}
