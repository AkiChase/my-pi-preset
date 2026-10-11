import { execFile } from "node:child_process";
import type { ExtensionAPI, UIPromptKind, UIPromptStartEvent } from "@earendil-works/pi-coding-agent";

// Tells the surrounding multiplexer that pi is waiting for the user, not working.
//
// The hole: pi blocks the whole turn while an extension dialog is open, so `agent_settled` never
// fires and every integration that keys off it keeps the pane in Working. The worst case is
// @juicesharp/rpiv-ask-user-question, whose questionnaire can sit there for minutes with nobody
// notified. pi itself does publish the right thing -- `ui_prompt_start` / `ui_prompt_end` bracket
// every blocking `ctx.ui.*` prompt (select, confirm, input, editor, custom), only for the outermost
// one, so starts and ends pair 1:1 -- but neither integration below subscribes to it:
//
//   - herdr (0.9.1, integration version 9 in ~/.pi/agent/extensions/herdr-agent-state.ts) reports
//     working/idle over its control socket and reports `blocked` only when some *other* extension
//     emits `herdr:blocked` on pi's event bus. Nothing emits it. Its sibling integration for
//     another agent (HERDR_INTEGRATION_ID=omp, version 10) does wire up that agent's approval and
//     ask events, so the pi integration is behind rather than deliberately passive.
//   - cmux (0.65.0) monkey-patches `ui.confirm`, `ui.select` and `ui.input` in its generated
//     ~/.pi/agent/extensions/cmux-session.ts to send its `questionAsked` hook. `ui.custom` and
//     `ui.editor` are not patched, which is exactly how the questionnaire renders.
//
// So: one listener, two sinks, each inert unless its host's environment is present.
//
// Not covered: pi's own OSC 7501 program status. pi reports `blocked` there for
// select/confirm/input/editor but not for `ctx.ui.custom()` (showExtensionCustom never calls
// programStatus.setBlocked, pi 1.1.0). That is an upstream gap, and neither herdr 0.9.1 nor cmux
// 0.65.0 reads the protocol, so there is nothing to gain by working around it here.

/** herdr's channel. Payload: `{ active: true, label?: string }` to block, `{ active: false }` to release. */
const HERDR_BLOCKED_EVENT = "herdr:blocked";

/**
 * Optional label source. @juicesharp/rpiv-ask-user-question emits this right before it opens the
 * overlay; its `ui_prompt_start` carries kind "custom" with no title, so without the payload the
 * pane would read as a bare "waiting". Channel name only -- the package stays an optional peer.
 */
const ASK_USER_PROMPT_EVENT = "rpiv:ask-user:prompt";

/** The kinds cmux's own hooks already cover; notifying for them would double up. */
const CMUX_PATCHED_KINDS: ReadonlySet<UIPromptKind> = new Set<UIPromptKind>(["confirm", "select", "input"]);

const KIND_LABELS: Record<UIPromptKind, string> = {
  select: "Waiting for a choice",
  confirm: "Waiting for confirmation",
  input: "Waiting for input",
  editor: "Waiting for text",
  custom: "Waiting for input",
};

const CLI_TIMEOUT_MS = 2000;

/** What a host integration needs from a prompt. `release()` must tolerate never having blocked. */
export interface PromptSink {
  block(label: string, kind: UIPromptKind): void;
  release(): void;
}

/** One line, short enough for a pane badge. */
export function sanitizeLabel(text: unknown, maxLength = 60): string | undefined {
  if (typeof text !== "string") return undefined;
  const flat = text.replace(/\s+/gu, " ").trim();
  if (!flat) return undefined;
  return flat.length <= maxLength ? flat : `${flat.slice(0, maxLength - 1)}…`;
}

/** First question's header, falling back to its text: "Auth method" reads better than "waiting". */
export function askUserLabel(payload: unknown): string | undefined {
  const questions = (payload as { questions?: unknown })?.questions;
  if (!Array.isArray(questions) || questions.length === 0) return undefined;
  const first = questions[0] as { header?: unknown; question?: unknown };
  const label = sanitizeLabel(first?.header) ?? sanitizeLabel(first?.question);
  if (!label) return undefined;
  return questions.length > 1 ? `${label} (+${questions.length - 1})` : label;
}

export function promptLabel(event: UIPromptStartEvent, askLabel: string | undefined): string {
  const title = sanitizeLabel(event.title);
  if (title) return title;
  if (event.kind === "custom" && askLabel) return askLabel;
  return KIND_LABELS[event.kind] ?? KIND_LABELS.custom;
}

/** herdr's own gate: without these its integration extension is inert, so emitting is pointless. */
export function herdrPresent(env = process.env): boolean {
  return env.HERDR_ENV === "1" && !!env.HERDR_SOCKET_PATH && !!env.HERDR_PANE_ID;
}

/**
 * cmux resolves `notify` targets from the caller's workspace, so that id plus the control socket is
 * the real requirement. CMUX_PI_HOOKS_DISABLED is cmux's own opt-out and is honored here too.
 */
export function cmuxCliPath(env = process.env): string | undefined {
  if (env.CMUX_PI_HOOKS_DISABLED === "1") return undefined;
  if (!env.CMUX_SOCKET_PATH || !env.CMUX_WORKSPACE_ID) return undefined;
  return env.CMUX_BUNDLED_CLI_PATH || undefined;
}

export function createHerdrSink(pi: ExtensionAPI): PromptSink {
  // herdr keeps its own counter, so every `active: true` needs exactly one `active: false` or the
  // pane stays blocked after the dialog closes.
  let blocked = false;
  const send = (data: Record<string, unknown>) => {
    try {
      pi.events.emit(HERDR_BLOCKED_EVENT, data);
    } catch {
      // emit() throws once this extension is unloaded (/reload mid-prompt). Nothing to do: herdr's
      // integration reloads with us and resets its counter.
    }
  };
  return {
    block(label) {
      blocked = true;
      send({ active: true, label });
    },
    release() {
      if (!blocked) return;
      blocked = false;
      send({ active: false });
    },
  };
}

type RunCli = (args: string[], onDone?: (stdout: string) => void) => void;

/**
 * cmux has no public way to set a pane's agent state, so this uses the documented notification CLI:
 * a banner plus a sidebar badge and pane ring. The pane itself keeps reading as running -- that
 * state belongs to cmux's own hook integration, which this only fills the gaps of.
 */
export function createCmuxSink(run: RunCli): PromptSink {
  let notificationId: string | undefined;
  let outstanding = false;
  return {
    block(label, kind) {
      if (CMUX_PATCHED_KINDS.has(kind)) return;
      outstanding = true;
      run(["notify", "--title", "pi is waiting", "--body", label, "--json"], (stdout) => {
        const id = (JSON.parse(stdout) as { id?: unknown }).id;
        // The dialog may already be answered by the time the id arrives.
        if (typeof id !== "string") return;
        if (!outstanding) run(["dismiss-notification", "--id", id]);
        else notificationId = id;
      });
    },
    release() {
      if (!outstanding) return;
      outstanding = false;
      const id = notificationId;
      notificationId = undefined;
      // Answering the prompt means the user is right here, so the banner is stale. Dismiss by id
      // rather than `notify --clear`, which would also drop other tools' notifications.
      if (id) run(["dismiss-notification", "--id", id]);
    },
  };
}

function cliRunner(cliPath: string): RunCli {
  return (args, onDone) => {
    execFile(cliPath, args, { timeout: CLI_TIMEOUT_MS }, (error, stdout) => {
      if (error || !onDone) return;
      try {
        onDone(stdout);
      } catch {
        // A changed output shape must not take the session down.
      }
    });
  };
}

/** Wires `ui_prompt_start` / `ui_prompt_end` to the sinks. Exported for tests. */
export function watchPrompts(pi: ExtensionAPI, sinks: PromptSink[]): void {
  let pending = 0;
  let askLabel: string | undefined;

  const forEachSink = (visit: (sink: PromptSink) => void) => {
    for (const sink of sinks) {
      try {
        visit(sink);
      } catch {
        // One failing host must not starve the others.
      }
    }
  };

  pi.events.on(ASK_USER_PROMPT_EVENT, (payload) => {
    askLabel = askUserLabel(payload);
  });

  pi.on("ui_prompt_start", (event) => {
    pending++;
    const label = promptLabel(event, askLabel);
    forEachSink((sink) => sink.block(label, event.kind));
  });

  pi.on("ui_prompt_end", () => {
    askLabel = undefined;
    if (pending === 0) return;
    pending--;
    forEachSink((sink) => sink.release());
  });

  pi.on("session_shutdown", () => {
    if (pending === 0) return;
    pending = 0;
    forEachSink((sink) => sink.release());
  });
}

export default function (pi: ExtensionAPI) {
  const sinks: PromptSink[] = [];
  if (herdrPresent()) sinks.push(createHerdrSink(pi));
  const cliPath = cmuxCliPath();
  if (cliPath) sinks.push(createCmuxSink(cliRunner(cliPath)));
  if (sinks.length === 0) return;
  watchPrompts(pi, sinks);
}
