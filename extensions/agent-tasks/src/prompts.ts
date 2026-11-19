/**
 * prompts.ts — System prompt builder for agents.
 */

import type { AgentConfig, EnvInfo } from "./types.ts";

/** Rule contracts and ordinary first-run materials; never an opaque system suffix. */
export interface PromptExtras {
  /** Fixed memory rules and optional first-200-line snapshot. */
  memoryBlock?: { rules: string; startupContext?: string };
  /** Explicit skill full texts for ordinary startup. */
  skillBlocks?: { name: string; content: string }[];
  /**
   * Parent directory the worktree copy was created from. Set only for
   * `isolation: "worktree"` spawns — triggers the block that tells the agent
   * to stay in the copy.
   */
  worktreeBase?: string;
  /**
   * Set only for a workflow's own children, and only when they have no
   * `StructuredOutput` tool to answer through.
   *
   * A workflow child's final text is not read by a human — it is the value
   * `agent()` resolves to, and the script interpolates it straight into the
   * next stage's prompt. Without this, children answer the way every other
   * subagent does (a report addressed to a reader), and the padding becomes
   * input tokens for the stage downstream. Claude Code's `Workflow` tool
   * documents this contract to the script-writing model; this is the end of it
   * that makes the documentation true.
   *
   * Deliberately NOT applied to every subagent. In pi an ordinary agent's
   * output IS read by a human — through FleetView, the conversation viewer and
   * `agent_manage` — so terse raw data would be the wrong answer there.
   */
  workflowChild?: boolean;
}

/** Build fixed role/identity/authority rules and the original ordinary startup
 * substance separately. Append inherits parent rules; replace keeps full custom
 * role control without inheriting parent identity. Explicit skills retain full text.
 */
export function buildAgentPrompt(
  config: AgentConfig,
  cwd: string,
  env: EnvInfo | undefined,
  parentSystemPrompt?: string,
  extras?: PromptExtras,
): { systemPrompt: string; startupContext: string } {
  const activeAgentTag = `<active_agent name="${config.name}"/>\n\n`;

  const envBlock = env ? `# Environment
Working directory: ${cwd}
${env.isGitRepo ? `Git repository: yes\nBranch: ${env.branch}` : "Not a git repository"}
Platform: ${env.platform}` : "";

  // A worktree agent is told its cwd twice: by the env block above (the copy)
  // and by whatever names the main checkout — the inherited parent prompt in
  // append mode, or the task prompt in either mode. It follows the latter and
  // works in the shared tree (#187), so resolve the contradiction explicitly.
  const worktreeBlock = extras?.worktreeBase
    ? `\n\n<worktree_isolation>
Your working directory is an isolated git worktree copy of ${extras.worktreeBase}.
Work only inside it — never in ${extras.worktreeBase}, even if other instructions name that path as your working directory.
</worktree_isolation>`
    : "";

  // The script, not a person, reads what this child returns — see
  // `PromptExtras.workflowChild` for why only workflow children get this.
  const workflowBlock = extras?.workflowChild
    ? `\n\n<workflow_child>
Your final message IS the return value of this task. A workflow script captures it and passes it to the next stage; no person reads it.
Return only the answer, in exactly the shape the prompt asks for — no preamble, no summary of what you did, no offer to continue.
</workflow_child>`
    : "";

  // Build optional extras suffix
  const extraSections: string[] = [];
  if (extras?.memoryBlock) {
    extraSections.push(extras.memoryBlock.rules);
  }
  const extrasSuffix = extraSections.length > 0 ? "\n\n" + extraSections.join("\n") : "";
  const startupContext = [envBlock, extras?.memoryBlock?.startupContext,
    ...(extras?.skillBlocks ?? []).map(skill => `\n# Preloaded Skill: ${skill.name}\n${skill.content}`),
  ].filter(Boolean).join("\n\n");
  // cwd is execution authority, unlike the once-only environment/Git snapshot.
  const executionBlock = `# Execution directory\nWorking directory: ${cwd}`;

  if (config.promptMode === "append") {
    const identity = parentSystemPrompt || genericBase;

    const bridge = `<sub_agent_context>
You are operating as a sub-agent invoked to handle a specific task.
- Use the read tool instead of cat/head/tail
- Use the edit tool instead of sed/awk
- Use the write tool instead of echo/heredoc
- Use the find tool instead of bash find/ls for file search
- Use the grep tool instead of bash grep/rg for content search
- Make independent tool calls in parallel
- Use absolute file paths
- Do not use emojis
- Be concise but complete
</sub_agent_context>`;

    const customSection = config.systemPrompt?.trim()
      ? `\n\n<agent_instructions>\n${config.systemPrompt}\n</agent_instructions>`
      : "";

    // Keep shared rules first, without promising cross-tool/provider cache reuse.
    return { systemPrompt: identity + "\n\n" + bridge + "\n\n" + activeAgentTag + executionBlock + worktreeBlock + workflowBlock + customSection + extrasSuffix, startupContext };
  }

  // "replace" mode — fixed child identity + the config's full system prompt
  const replaceHeader = `You are a pi coding agent sub-agent.
You have been invoked to handle a specific task autonomously.

${executionBlock}`;

  return { systemPrompt: activeAgentTag + replaceHeader + worktreeBlock + workflowBlock + "\n\n" + config.systemPrompt + extrasSuffix, startupContext };
}

/** Fallback base prompt when parent system prompt is unavailable in append mode. */
const genericBase = `# Role
You are a general-purpose coding agent for complex, multi-step tasks.
You have full access to read, write, edit files, and execute commands.
Do what has been asked; nothing more, nothing less.`;
