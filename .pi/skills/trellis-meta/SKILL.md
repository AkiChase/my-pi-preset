---
name: trellis-meta
description: "Inspect Pi Trellis architecture and safely customize project workflow, config, specs, role definitions or Trellis skills. Use when changing Trellis integration or understanding resource ownership."
---

# Pi Trellis Architecture and Customization

Read [architecture overview](references/local-architecture/overview.md) first, then the relevant topic. In the main session, `.trellis` material paths resolve from the source project root. Dispatched roles derive absolute source material paths from host-verified sourceRoot, taskDir and role manifest, not their execution-root `.trellis`; code and tests stay at `executionRoot`. Project `.pi` settings/resources still resolve from the execution root, and personal settings retain their own scope. Supporting references resolve from this skill directory. Preserve custom content and obtain approval before modifications; source read authority grants no write or lifecycle permission.

## References
- [local-architecture/overview](references/local-architecture/overview.md)
- [local-architecture/generated-files](references/local-architecture/generated-files.md)
- [local-architecture/workflow](references/local-architecture/workflow.md)
- [local-architecture/task-system](references/local-architecture/task-system.md)
- [local-architecture/spec-system](references/local-architecture/spec-system.md)
- [local-architecture/workspace-memory](references/local-architecture/workspace-memory.md)
- [local-architecture/context-injection](references/local-architecture/context-injection.md)
- [local-architecture/bundled-skills](references/local-architecture/bundled-skills.md)
- [platform-files/overview](references/platform-files/overview.md)
- [platform-files/platform-map](references/platform-files/platform-map.md)
- [platform-files/hooks-and-settings](references/platform-files/hooks-and-settings.md)
- [platform-files/agents](references/platform-files/agents.md)
- [platform-files/skills-and-commands](references/platform-files/skills-and-commands.md)
- [customize-local/overview](references/customize-local/overview.md)
- [customize-local/change-workflow](references/customize-local/change-workflow.md)
- [customize-local/change-task-lifecycle](references/customize-local/change-task-lifecycle.md)
- [customize-local/change-context-loading](references/customize-local/change-context-loading.md)
- [customize-local/change-hooks](references/customize-local/change-hooks.md)
- [customize-local/change-agents](references/customize-local/change-agents.md)
- [customize-local/change-skills-or-commands](references/customize-local/change-skills-or-commands.md)
- [customize-local/change-spec-structure](references/customize-local/change-spec-structure.md)
- [customize-local/add-project-local-conventions](references/customize-local/add-project-local-conventions.md)
