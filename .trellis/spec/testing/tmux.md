# Real Terminal Testing with tmux

This is a reusable CLI/TUI test method, not a completed test report. Component tests, real terminal interaction and online model quality are separate evidence layers. Offline success does not cover arbitrary themes, IME, plugin combinations or providers.

## 1. Authorization and Isolation

Describe actions, matrix and cleanup scope and obtain real-terminal test authorization before running. Use existing CLI/tmux only; never connect to personal panes or download dependencies to fill coverage.

- Use a unique `tmux -L <test-id>` server; every management command includes that same `-L`. Never use an unqualified `kill-server`.
- Create owned temporary HOME, `PI_CODING_AGENT_DIR`, cwd, session, config and log directories. Do not inherit personal authentication or package registration.
- Prefer `env -i` with explicit PATH, TERM and isolation variables. Disable automatic resource discovery and explicitly load checked-out target extensions with `-e`; verify actual flags against installed CLI help.
- Use a scripted local provider or minimal no-model flow; no online APIs without separate authorization. Label providers as fixtures, not autonomous model-quality evidence.
- No installation, full sync or reload of personal instances. Missing dependencies mean NOT_RUN, not a second installed SDK.

## 2. Start with a Minimal Matrix

Start with one success, one error and core expand/collapse or enter/back interaction before specialized cases. Do not first build a complete agent/workflow harness. Select dimensions by actual change and record omissions.

| Dimension | Examples |
| --- | --- |
| Mode | regular, fullscreen |
| Width | 140, 80, 40 columns; dynamic resize separately |
| Theme | explicitly fixed dark/light/system; do not substitute one for another |
| Text | CJK, combining characters, long paths/titles, controls, empty/error states |
| Input | actual keys, Esc cancellation, back, focus restoration, relevant dialogs |
| Lifecycle | new session, closure, normal quit and actual owned process cleanup |

Fixed-width startup is not dynamic resize. Keyboard success does not prove physical mouse or IME. Choose keys from actual registered behavior, not task plans.

## 3. Driving, Waiting and Capture

Use `tmux send-keys` for actual keys such as `C-o`. Preserve before/after evidence; successful key delivery does not prove the action occurred.

Wait with bounded condition loops or monitor for expected screens/events/raw frames. Never guess completion with fixed sleeps. Set an overall deadline and explicit failure exit.

- `capture-pane -p` saves text; `capture-pane -p -e` retains SGR. Neither is an image screenshot.
- For rendering diagnosis, confirm installed CLI support for `PI_TUI_WRITE_LOG` and collect owned raw ANSI writes. Keep bounded fragments/action markers and inspect for credentials.
- After resize, confirm a completed new-width frame in raw CLI output before judging it. tmux can clip old frames; border length alone is misleading.
- Check background continuity by displayed cells: 48m does not prove a full row, and 0m/49m after ellipsized text may cancel the background early.
- Injecting mouse SGR bytes through stdin is simulated input, not physical mouse end-to-end validation.
- `/debug` and event logs cannot substitute for actual overlay and focus evidence.

## 4. Results and Fixture Errors

Mark cases PASS, FAIL or NOT_RUN. Record commands, installed CLI version, theme, mode, dimensions and exit status. A driver catching exceptions and exiting zero is not success: read report.error, cases, screens and events.

Preserve product and fixture failures separately. Changed labels/order or old-frame clipping are fixture issues only after actual source/raw-output verification. Do not change product behavior or weaken expectations to fit failure. Rerun affected cases after scoped fixture repairs and retain initial failures.

Online models, installed original third-party input-history compatibility, physical IME and arbitrary plugin combinations remain NOT_RUN unless tested. Stage completion is not acceptance.

## 5. Cleanup and Evidence

In finally, request normal quit from the owned CLI and verify CLI and owned children actually exit. If necessary, signal only verified test PIDs/process groups; stale PIDs do not authorize signals. Stop only the unique test server and delete only self-created temporary config.

Report residual processes, timeouts and cleanup failures. A closed panel or terminal status is not OS-level exit. Keep bounded evidence in the task research directory, not accumulating historical PASS counts here.

Before reusing historical fixtures, read failures, launch flags and versions:

- [Tool background validation](../../tasks/archive/2026-10/10-13-beautify-tool-shell-collapse/research/tmux-validation.md)
- [Focused terminal revalidation](../../tasks/archive/2026-10/10-13-beautify-tool-shell-collapse/research/terminal-fix-report.md)

These are historical evidence, not current acceptance. General commands/reporting boundaries are in [testing guidelines](index.md).
