<!-- TRELLIS:START -->
# Pi Trellis

Use `/trellis-init --check` to inspect the project and `/skill:trellis-start` to orient.
Read `.trellis/workflow.md` and relevant `.trellis/spec/` indexes before approved changes.
Skills load from the pi-trellis package; project roles live in `.pi/agents/`.
Use project `.trellis/scripts/` Python commands, with the session context supplied by Pi.
Read-only exploration needs no task. Task creation, implementation, Git commits and
archival require user approval; initialization grants none of these approvals.
Managed task worktrees use the package's on-demand execution protocol, never temporary isolation.
<!-- TRELLIS:END -->

# Project Language Conventions

- Specs under `.trellis/spec/` are written in English.
- User documentation under `docs/`, README, and task document prose under `.trellis/tasks/` are written in Chinese.
- Code, code comments, and commit messages are written in English.
- Preserve identifiers, commands, paths, quoted originals, and vendor/license/generated content in their original form. Do not translate JSON/JSONL structural keys or raw execution evidence.
