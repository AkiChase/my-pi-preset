# Delegation and coordination

## Tasks and evidence

Use specialized agents for substantial independent work or broad exploration; direct tools are more efficient for a small change with a known target. Do not duplicate work already delegated. Choose a permitted type from the current subagent_run tool/schema, not a fixed list in this manual.

Provide a self-contained prompt: goal, relevant files/background, scope, explicit read-only or edit permission, prohibitions and expected output. Include relevant background text even when work crosses sessions; a cold agent cannot be assumed to know this discussion.

Ask for concise results with evidence and unresolved limitations. Execution completion is not task acceptance. Inspect actual diffs, commands and results before reporting success; a delegated summary is not proof. Divide parallel edits into non-overlapping ownership. A temporary worktree does not replace the project's approved working-directory protocol.

## Modes and configuration

Every model-tool field is required, and control fields are strings, never JSON null: `"null"` marks a field that does not apply to the current mode, `"default"` uses configuration/defaults. Do not add unexposed fields. Do not copy top-level name into nested calls: nested tools do not expose it. Use the current tool's complete mode table and examples.

For subagent_run, an explicit model takes precedence over the agent-file model. model `"default"` uses agent configuration, otherwise the parent session model. Other applicable requests remain subordinate to agent-file configuration. thinking `"default"` uses agent configuration, otherwise child session settings/defaults, not the parent's current thinking; it is not `"off"`. tools/context `"default"` use configuration, otherwise `"full"`/`"fresh"`. context `"inherit"` adds parent conversation text to the prompt; it is not an SDK fork. Top-level execution `"default"` uses configuration; nested new agents default to foreground unless agent configuration says otherwise.

Use foreground when your next action depends on the result; otherwise do independent work during background execution. An agent file can override even an explicit foreground request: inspect the result's effective mode. Distinguish tools `"builtin"` (no extension/MCP tools) from isolation `"worktree"` (a Git copy that cannot see the main checkout's uncommitted or staged changes). Follow project authorization.

## Running, resuming and retrieving

The launch agent_id identifies the session for subagent_message and subagent_run resume. execution_id identifies one execution for agent_manage. Do not message/resume with names, type aliases or execution_id; do not construct execution IDs. A background launch means accepted/queued, not completed. Save the real IDs.

Use subagent_message to steer a running agent. Queued/Sent does not confirm reading or processing. Resume a finished, resumable agent to retain its type, name and session settings. Top-level mode is resolved again for this execution; nested resume always waits foreground with all other controls, including execution, `"null"`. Resume issues a new execution_id: new requests using the old handle are stale, while an already-admitted wait still belongs to the original execution. Workflow replay is a new, separate execution.

agent_manage output reads current progress/results; wait awaits the whole execution. detail `"full"` requests additional conversation for subagent output/wait (`"default"` equals `"summary"`), not an unlimited trace. Workflow targets cannot use detail `"full"`. /task-detach or cancellation only releases waiting; stop requests execution cancellation, which may still drain. Successful terminal output/wait delivery avoids duplicate completion notifications; list/status do not consume results. Do not poll solely to detect completion. Top-level background completion is automatically notified, but notifications are not diff/test verification.

## Nested boundaries

Delegate only permitted parent-authorized types within the depth limit. If no nested tools are available, complete the task directly; do not recursively bypass their absence. Nested background requires an available owned agent_manage. A parent finishing stops its owned children: collect results before finishing, without relying on top-level notifications. Visibility is not management authority; another owner's visible child may not be directly manageable. Stopping a workflow stops its owned agents, not independent siblings.
