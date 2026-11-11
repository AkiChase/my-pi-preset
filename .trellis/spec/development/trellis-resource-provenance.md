# Trellis Resource Provenance

## 1. Scope / Trigger

Git-shared runtime, roles, skills, templates and root blocks cross initialization, Update/repair/adoption, backups, diagnostics and dispatch. Permissions vary with checkout/umask and are not resource identity. The implementation owner is `extensions/trellis/lib/initialization/`; native material reading lives in `runtime/pi_trellis_worktree/materials.py`.

## 2. Signatures

- `Fingerprint = { sha256: string }`; missing files use `null`.
- `normalizeManifest(value: unknown): InstalledManifest` returns schema 4.
- `verifyRuntime(root, reader?, pkg?): InstalledManifest | undefined` checks current execution authority.
- `InitPlan.schemaVersion = 2`; actions contain `path/original/output/kind`, guards contain content fingerprints, and `planHash` covers the original plan body.
- Captured-source rows contain `data/sha256/origin/package`, never permission fields.

## 3. Contracts

Publish schema 4 without mode in files/templates/skills. Parse well-formed schemas 2/3 then discard legacy modes before comparison. Runtime rows require current bytes, exact inventory and logical source. Stale role/default-template hashes are safe update candidates, not runtime blockers.

Content-only publication guards protect edits; backups copy contents, not original permissions. Write shared/root files with default `0644`, backup contents with `0600`, retaining private locks/directories. A chmod-only change never rewrites an unchanged resource, marks a template as custom or conflicts on a skill folder.

Bounded reads retain dev/ino, regular-file type, size and write-time checks, not mode/ctime. Directory expansion retains membership drift checks and native graph rereads compare hashes. These fences are not a filesystem transaction or proof of agent reads.

## 4. Validation & Error Matrix

| Input / change | Behavior |
| --- | --- |
| Schema 4 with mode; malformed legacy rows | Reject before resource comparison |
| Unknown inventory/source; unsafe path, symlink or nonregular file | Reject; no fallback or overwrite |
| Current runtime hash mismatch or concurrent content edit | Reject and preserve contents |
| Older release missing package-added rows | Allow explicit Update planning; current-release gaps reject |
| Completed legacy operation | Verify original shape/hash as history; do not reconstruct current canonical outputs |
| Legacy incomplete plan | Preserve and reject; no migration or execution |
| Current incomplete plan | Canonical output, lock and content-guarded retry checks remain required |

## 5. Base / Good / Bad Cases

```ts
// Base fingerprint; sha256 is exactly 64 lowercase hexadecimal characters.
const fingerprint = { sha256: digest(bytes) };
```

Good: `644 → 664` with unchanged bytes stays Current. Permission differences between historical action/guard rows do not change their content equality.

Bad: changed runtime bytes or forged sources remain unauthorized, even if filesystem permissions match the package.

## 6. Tests Required

- `resource-hash-only.test.mjs`: schema/legacy/history, chmod/umask, content conflicts, no-op locks, private backups and captured protocol parity.
- `read-content-identity.test.mjs`: open/read chmod tolerance and content/inode replacement rejection.
- Python `test_worktree.py`: ancestor/FIFO, directory membership and graph hash fencing.
- Focused initialization/resource/diagnostic consumers plus natural-exit Trellis/Python checks under the [testing guidelines](../testing/index.md).

## 7. Wrong vs Correct

Wrong: copy package `stat.mode` into a fingerprint or retain ctime as a chmod-induced drift failure.

Correct: compare content hashes for resources, use default creation permissions and keep path/type/content/descriptor protections separate.
