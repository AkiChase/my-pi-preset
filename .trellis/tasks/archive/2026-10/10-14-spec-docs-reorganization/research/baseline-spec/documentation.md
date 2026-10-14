# Documentation Maintenance

## Language and Content Placement

All files under `.trellis/spec/preset/` are English. All root `docs/` documents are Chinese. README and task plans/research remain Chinese; code/comments/commit messages remain English. Keep identifiers, commands, and quoted upstream originals unchanged. This supersedes the former Chinese-only preset-spec policy.

| Location | Content |
| --- | --- |
| `README.md` | Overview, installation, concise plugin descriptions, and detailed-document links |
| `docs/extensions/` | Plugin purpose, usage, commands, configuration, design explanations, and focused test entry points |
| `docs/testing/` | Reusable testing procedures, including isolated tmux validation |
| `.trellis/spec/preset/` | How to develop/test and constraints future changes must preserve |
| `.trellis/tasks/` | Current plans, historical execution reports, logs, and acceptance evidence |

A new plugin does not require a new specification chapter. Add a spec rule only when it captures a reusable development or architecture constraint backed by evidence. Concrete code/test links may illustrate a rule without turning it into a full implementation manual.

Do not move stale prose verbatim. Check actual sources, registrations, schemas, and tests; distinguish currently shipped behavior from planned or parallel changes. Do not migrate personal memory or credentials into documentation.

## Synchronization Checklist

- Adding/removing a plugin: update the README overview and its detailed documentation link.
- Changing behavior, commands, keys, or config: update the owning Chinese plugin document and any affected README summary/config table.
- Changing manifest packages/conflicts/resources: update loading/install explanations and discovery tests where relevant.
- Changing sync semantics/options: update the relevant README action table/examples and [sync constraints](sync-guidelines.md).
- Adding a validation method: document the procedure in `docs/testing/` or the owning plugin page; update generic testing requirements only if the requirement itself changed.
- Changing document paths: update indexes and affected active references/JSONL. Preserve archived task evidence rather than rewriting historical results en masse.

README need not duplicate all plugin details. Small plugins may use a concise section instead of an artificial standalone page. Delegate substantial plugin-document research/writing per plugin when requested; the main agent must verify actual changes and integrate links, not treat subagent intent as acceptance.

## Verification and Boundaries

Check local relative targets and affected anchors, language policy, whitespace (including new files), and consistency with actual behavior. Report historical test evidence as historical, never as a fresh run.

Keep development integrations, task lifecycle instructions, and private spec navigation out of user-facing README and preset resources. Do not hand-edit generated infrastructure to repair a documentation reference. Preserve unrelated parallel edits and original vendor/license materials.
