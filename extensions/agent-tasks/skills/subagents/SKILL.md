---
name: subagents
description: "Plan and coordinate subagent delegation and explicitly user-authorized workflow orchestration. Use for substantial independent work, coordinating running or resumed agents, and before writing or modifying authorized workflow scripts. Reading this skill does not authorize workflow execution."
---

# Subagents

Current tools and schemas are authoritative for available types, fields and safe calls. This manual adds no tools and grants no workflow, file modification, commit, installation or worktree permission. Automatically reading it is not the user's explicit opt-in to multi-agent orchestration.

Read only what the current task needs; do not expand all references by default:

- Ordinary delegation or agent coordination: read [delegation](references/delegation.md).
- Writing or modifying a workflow: confirm user authorization, then fully read [workflow API](references/workflow-api.md).
- Complex authorized orchestration: after the API, read [patterns](references/patterns.md).

Resolve relative references against this SKILL.md directory to absolute paths and use a permitted reader. This plugin-owned manual uses extension-added resource discovery, independently of ordinary skill filters. It still requires a loaded extension, an available entry and readable files; it does not bypass tool permissions. If absent, disabled for model invocation, unreadable or displaced by a same-name resource, explain the limitation rather than assuming this manual was read or loading a guessed path. The tool's safety contracts always apply.
