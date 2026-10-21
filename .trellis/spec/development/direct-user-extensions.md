# Direct User Extension Sync Contract

## 1. Scope / Trigger

Use this contract when changing `scripts/sync.mjs` handling for direct resources under the user Pi extensions root. The `extensions` sync domain exists because package reconciliation cannot see entries that Pi discovers directly from `<agent-dir>/extensions/`.

## 2. Signatures

```text
--sync extensions
--prune extensions
preserve.extensions: string[]
```

`extensions` participates in `all`; a bare `--prune` prunes every selected domain. `preserve.extensions` contains exact first-level entry names only and never installs or updates a resource.

## 3. Contracts

- The root is the user agent directory resolved by Pi, followed by `extensions/`; never derive it from cwd, a manifest path, project `.pi/extensions`, or an arbitrary settings resource path.
- Merge discovers and displays direct entries but does not change them. Prune removes only unpreserved direct Pi entry roots.
- Candidate files are visible first-level `.ts` and `.js` files. Candidate directories are visible first-level directories with `index.ts`, `index.js`, or an active Pi package extension declaration.
- Hidden entries and `node_modules` are outside Pi auto-discovery and outside this deletion domain. Do not infer or remove adjacent metadata, JSON, or other unknown files.
- Resolve a symlink only to classify its entry kind; removal deletes the link, never its target.
- If the shared `extensions/` root itself resolves as an extension package or index, prune fails closed. It must not recursively delete the shared root.
- A missing or unreadable root produces no candidates. An unselected `extensions` domain must not inspect it.

## 4. Validation & Error Matrix

| Condition | Required result |
| --- | --- |
| `preserve.extensions` is absent | Treat as `[]`. |
| It is not an array, has duplicate names, names `node_modules`, or contains a path/traversal/hidden name | Reject the manifest before side effects. |
| `--prune extensions` without selecting `extensions` | Reject through the ordinary domain-selection check. |
| Root is a file | Fail with a clear root-is-not-directory error. |
| Root is an extension package/index and prune is selected | Fail closed; preserve the root. |
| Root is missing or unreadable | Plan no direct entries; do not invent a deletion. |
| `--dry-run` | Print keep/preserve/remove plan only; never call `rmSync`. |

## 5. Good / Base / Bad Cases

- **Good:** `extensions/foo.ts` is unpreserved under prune → remove `foo.ts`; unrelated `extensions/foo.ts.metadata` stays.
- **Base:** `extensions/` is absent → no plan entries and no directory creation.
- **Good:** `extensions/tool/index.ts` is unpreserved → remove the `tool` directory entry.
- **Good:** a preserved first-level name remains during prune.
- **Bad:** recursively treat every `*.json` or nested `*.ts` as an extension → this deletes files Pi never auto-loaded.
- **Bad:** remove the whole shared root when it has a root `package.json` → this can delete unrelated support files.

## 6. Tests Required

`scripts/sync.test.mjs` must use a temporary `PI_CODING_AGENT_DIR` and fake `pi` binary to assert:

- merge, prune, bare-prune and dry-run plans;
- no `pi list` call or extension-root inspection when the domain is unselected;
- file, index-directory and package-manifest-directory discovery;
- JSON/unknown-file preservation, hidden-entry exclusion and preserve-list validation;
- root-package refusal, unreadable/missing root behavior, and symlink target preservation;
- resulting filesystem state, not only printed plan text.

## 7. Wrong vs Correct

### Wrong

```js
for (const name of readdirSync(extensionsRoot)) {
  rmSync(join(extensionsRoot, name), { recursive: true, force: true });
}
```

This makes prune a generic directory wipe and violates Pi discovery and user-file boundaries.

### Correct

```js
const entries = readDirectExtensions(extensionsRoot, prune);
const plan = buildExtensionPlan(entries, manifest.preserve.extensions, prune);
for (const entry of plan.filter((step) => step.action === "remove")) removeExtension(entry);
```

Discover logical Pi entry roots first, validate preservation names, and remove only planned roots after dry-run has been ruled out.
