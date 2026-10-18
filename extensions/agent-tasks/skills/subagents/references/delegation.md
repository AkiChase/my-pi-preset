# Delegation and coordination

## Tasks and evidence

Use specialized agents for substantial independent work or broad exploration; direct tools are more efficient for a small change with a known target. Do not duplicate work already delegated. Choose a permitted type from the current subagent_run tool/schema, not a fixed list in this manual.

Provide a self-contained prompt: goal, relevant files/background, scope, explicit read-only or edit permission, prohibitions and expected output. Include relevant background text even when work crosses sessions; a cold agent cannot be assumed to know this discussion.

Ask for concise results with evidence and unresolved limitations. Execution completion is not task acceptance. Inspect actual diffs, commands and results before reporting success; a delegated summary is not proof. Divide parallel edits into non-overlapping ownership. A temporary worktree does not replace the project's approved working-directory protocol.

## Modes and configuration

Every model-tool field is required. Set unused controls to null for the current mode; do not add unexposed fields even as null. Do not copy top-level name or schedule into nested calls: nested tools expose neither. Use the current tool's complete mode table and examples.

For subagent_run, agent-file configuration takes precedence over applicable requests. Null model uses agent configuration, otherwise the parent session model. Null thinking uses agent configuration, otherwise child session settings/defaults, not the parent's current thinking. Null isolated/inherit_context uses configuration, otherwise false. inherit_context adds parent conversation text to the prompt; it is not an SDK fork. Top-level null execution mode uses configuration; nested new agents default to foreground unless agent configuration says otherwise.

Use foreground when your next action depends on the result; otherwise do independent work during background execution. An agent file can override even an explicit foreground request: inspect the result's effective mode. Distinguish isolated (no extension/MCP tools) from isolation:worktree (a Git copy that cannot see the main checkout's uncommitted or staged changes). Follow project authorization. Only use schedule for explicitly requested delayed/recurring execution; it creates a schedule definition, not an already-running agent, and cannot combine with resume, inherit_context or run_in_background:false.

## Running, resuming and retrieving

The launch agent_id identifies the session for subagent_message and subagent_run resume. execution_id identifies one execution for agent_manage. Do not message/resume with names, type aliases or execution_id; do not construct execution IDs. A background launch means accepted/queued, not completed. Save the real IDs.

Use subagent_message to steer a running agent. Queued/Sent does not confirm reading or processing. Resume a finished, resumable agent to retain its type, name and session settings. Top-level mode is resolved again for this execution; nested resume always waits foreground with all other controls, including run_in_background, null. Resume issues a new execution_id: new requests using the old handle are stale, while an already-admitted wait still belongs to the original execution. Workflow replay is a new, separate execution.

agent_manage output reads current progress/results; wait awaits the whole execution. verbose requests additional conversation for subagent output/wait (null equals false), not an unlimited trace. Workflow verbose must be null. /bg or cancellation only releases waiting; stop requests execution cancellation, which may still drain. Successful terminal output/wait delivery avoids duplicate completion notifications; list/status do not consume results. Do not poll solely to detect completion. Top-level background completion is automatically notified, but notifications are not diff/test verification.

## Nested boundaries

Delegate only permitted parent-authorized types within the depth limit. If no nested tools are available, complete the task directly; do not recursively bypass their absence. Nested background requires an available owned agent_manage. A parent finishing stops its owned children: collect results before finishing, without relying on top-level notifications. Visibility is not management authority; another owner's visible child may not be directly manageable. Stopping a workflow stops its owned agents, not independent siblings.
