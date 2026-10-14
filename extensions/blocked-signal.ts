import { execFile } from "node:child_process";
import type { ExtensionAPI, UIPromptKind, UIPromptStartEvent } from "@earendil-works/pi-coding-agent";

// Reports explicit human-attention waits to optional terminal hosts. A custom screen owns input,
// but is not necessarily a question: browsers and settings panels must stay notification-free.
// Standard Pi dialogs use ui_prompt_start/end; the optional questionnaire peer declares its own
// attention lifetime, including nested/overlapping mounts, through rpiv:ask-user:blocked.
// This adapter does not alter execution or make a focused browser safe for terminal prompt input.

/** herdr's channel. Payload: `{ active: true, label?: string }` to block, `{ active: false }` to release. */
const HERDR_BLOCKED_EVENT = "herdr:blocked";

/**
 * Optional label source. @juicesharp/rpiv-ask-user-question emits this right before it opens the
 * overlay; its `ui_prompt_start` carries kind "custom" with no title, so without the payload the
 * pane would read as a bare "waiting". Channel name only -- the package stays an optional peer.
 */
const ASK_USER_PROMPT_EVENT = "rpiv:ask-user:prompt";
const ASK_USER_BLOCKED_EVENT = "rpiv:ask-user:blocked";

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
  accepts?(kind: UIPromptKind): boolean;
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
  // Just the first header. A "(+2)" suffix for the other tabs only reads as noise in a pane badge.
  return sanitizeLabel(first?.header) ?? sanitizeLabel(first?.question);
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
  let current: { id?: string } | undefined;
  return {
    accepts: (kind) => !CMUX_PATCHED_KINDS.has(kind),
    block(label, kind) {
      if (CMUX_PATCHED_KINDS.has(kind)) return;
      const notification: { id?: string } = {};
      current = notification;
      run(["notify", "--title", "pi is waiting", "--body", label, "--json"], (stdout) => {
        const id = (JSON.parse(stdout) as { id?: unknown }).id;
        if (typeof id !== "string") return;
        // Bind late replies to their own attention segment, not the next questionnaire.
        if (current !== notification) run(["dismiss-notification", "--id", id]);
        else notification.id = id;
      });
    },
    release() {
      const notification = current;
      current = undefined;
      if (notification?.id) run(["dismiss-notification", "--id", notification.id]);
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

/** Aggregate standard dialogs and explicitly declared questionnaire waits per host. */
export function watchPrompts(pi: ExtensionAPI, sinks: PromptSink[]): void {
  let closed = false;
  let prompt: UIPromptStartEvent | undefined;
  let askPending = 0;
  let askLabel: string | undefined;
  let activeAskLabel: string | undefined;
  const blocked = new Set<PromptSink>();

  const reconcile = () => {
    for (const sink of sinks) {
      try {
        const standard = !closed && prompt && prompt.kind !== "custom" &&
          (sink.accepts?.(prompt.kind) ?? true) ? prompt : undefined;
        const questionnaire = !closed && askPending > 0 && (sink.accepts?.("custom") ?? true);
        if (standard || questionnaire) {
          if (blocked.has(sink)) continue;
          blocked.add(sink);
          sink.block(standard ? promptLabel(standard, undefined) : activeAskLabel ?? KIND_LABELS.custom,
            standard?.kind ?? "custom");
        } else if (blocked.delete(sink)) {
          sink.release();
        }
      } catch {
        // A broken sink must not starve other hosts or prevent lifecycle cleanup.
      }
    }
  };

  pi.events.on(ASK_USER_PROMPT_EVENT, (payload) => {
    if (!closed) askLabel = askUserLabel(payload);
  });
  pi.events.on(ASK_USER_BLOCKED_EVENT, (payload) => {
    if (closed) return;
    const active = (payload as { active?: unknown } | null)?.active;
    if (active === true) {
      if (askPending++ === 0) activeAskLabel = askLabel;
      askLabel = undefined;
    } else if (active === false) {
      askPending = Math.max(0, askPending - 1);
      if (askPending === 0) {
        activeAskLabel = undefined;
        askLabel = undefined;
      }
    } else return;
    reconcile();
  });
  pi.on("ui_prompt_start", (event) => {
    if (closed) return;
    prompt = event;
    reconcile();
  });
  pi.on("ui_prompt_end", () => {
    if (closed) return;
    prompt = undefined;
    askLabel = undefined;
    reconcile();
  });
  pi.on("session_shutdown", () => {
    closed = true;
    prompt = undefined;
    askPending = 0;
    askLabel = activeAskLabel = undefined;
    reconcile();
  });
}

export default function (pi: ExtensionAPI) {
  const sinks: PromptSink[] = [];
  const underHerdr = herdrPresent();
  if (underHerdr) sinks.push(createHerdrSink(pi));
  // herdr already forwards its own "<agent> needs attention: <cwd>" toast to whatever terminal it
  // runs in (verified: a blocked pane raises a cmux notification, while a bare BEL raises none), so
  // adding ours on top would notify twice for one prompt. The cmux sink is for pi running directly
  // in a cmux pane.
  const cliPath = underHerdr ? undefined : cmuxCliPath();
  if (cliPath) sinks.push(createCmuxSink(cliRunner(cliPath)));
  if (sinks.length === 0) return;
  watchPrompts(pi, sinks);
}
