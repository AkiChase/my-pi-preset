# Thinking Guides

## Use the Actual Preset Boundaries

These guides support the [preset guidelines](../preset/index.md); they do not introduce application layers or upstream template-maintenance duties.

| Guide | Trigger |
| --- | --- |
| [Cross-Layer Thinking](./cross-layer-thinking-guide.md) | A manifest/config/registration change crosses sync, runtime, tests or README; a lifecycle change crosses execution and notification/rendering |
| [Code Reuse Thinking](./code-reuse-thinking-guide.md) | Adding a helper, changing a shared default, copying parsing/rendering/state logic, or editing several consumers |

Before non-trivial work, identify the behavior gap, the actual owner, required files and exclusions. Search related symbols and values in `extensions/`, `scripts/`, `pi-preset.json`, `package.json` and README; expand the search only when evidence points elsewhere.

For review findings, trace the real source and caller. The bundled manifest is repository-controlled, but current machine JSON and external host payloads are separate inputs; neither blanket distrust nor blanket trust is useful. Verify a comment's claimed behavior against code and assertions. Confirm a regression would fail if the feature were removed, and prioritize demonstrated failures rather than unsupported severity labels.

After a fix, put a reusable convention in the owning preset spec and a task-specific finding in task research. Keep generated development integrations outside product changes.
