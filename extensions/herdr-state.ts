import net from "node:net";
import path from "node:path";
import type { ExtensionAPI, ExtensionContext, UIPromptKind, UIPromptStartEvent } from "@earendil-works/pi-coding-agent";

// Reports Pi's lifecycle and explicit human-attention waits directly to Herdr. A custom screen
// is not necessarily a question: browsers and settings panels remain notification-free. Standard
// Pi dialogs use ui_prompt_start/end; the optional questionnaire peer declares its own attention
// lifetime, including nested/overlapping mounts, through rpiv:ask-user:blocked.

const ASK_USER_PROMPT_EVENT = "rpiv:ask-user:prompt";
const ASK_USER_BLOCKED_EVENT = "rpiv:ask-user:blocked";
const SOURCE = "herdr:pi";
const AGENT = "pi";
const FIRST_ATTEMPT_TIMEOUT_MS = 500;
const RETRY_TIMEOUT_MS = 1500;

type AgentState = "working" | "blocked" | "idle";
type SessionReference = { agent_session_path: string } | { agent_session_id: string };
type PendingState = { state: AgentState; message?: string; seq: number };
type SendRequest = (request: HerdrRequest) => Promise<void>;

export interface HerdrRequest {
  id: string;
  method: "pane.report_agent" | "pane.report_agent_session";
  params: Record<string, unknown>;
}

export interface HerdrReporter {
  updateSession(context: Pick<ExtensionContext, "sessionManager">): void;
  reportSession(reason?: string): Promise<void>;
  publish(state: AgentState, message?: string): void;
  close(): void;
  flush(): Promise<void>;
}

export interface HerdrReporterOptions {
  platform?: NodeJS.Platform;
  send?: SendRequest;
}

const KIND_LABELS: Record<UIPromptKind, string> = {
  select: "Waiting for a choice",
  confirm: "Waiting for confirmation",
  input: "Waiting for input",
  editor: "Waiting for text",
  custom: "Waiting for input",
};

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
  return sanitizeLabel(first.header) ?? sanitizeLabel(first.question);
}

export function promptLabel(event: UIPromptStartEvent, askLabel: string | undefined): string {
  const title = sanitizeLabel(event.title);
  if (title) return title;
  if (event.kind === "custom" && askLabel) return askLabel;
  return KIND_LABELS[event.kind] ?? KIND_LABELS.custom;
}

/** Herdr requires the managed-pane environment; merely having a socket path is not enough. */
export function herdrPresent(env = process.env): boolean {
  return env.HERDR_ENV === "1" && !!env.HERDR_SOCKET_PATH && !!env.HERDR_PANE_ID;
}

/** Herdr's Windows server accepts the named-pipe spelling used by its own integration template. */
export function herdrSocketEndpoint(env = process.env, platform = process.platform): string | undefined {
  const socketPath = env.HERDR_SOCKET_PATH;
  if (!socketPath) return undefined;
  return platform === "win32" ? `\\\\.\\pipe\\${socketPath}` : socketPath;
}

export function isAbsoluteSessionPath(file: unknown): file is string {
  return typeof file === "string" && (path.posix.isAbsolute(file) || path.win32.isAbsolute(file));
}

function socketAttempt(endpoint: string, request: HerdrRequest, timeoutMs: number): Promise<boolean> {
  return new Promise((resolve) => {
    let done = false;
    let socket: net.Socket | undefined;
    let timeout: ReturnType<typeof setTimeout> | undefined;
    const finish = (delivered: boolean) => {
      if (done) return;
      done = true;
      if (timeout) clearTimeout(timeout);
      socket?.destroy();
      resolve(delivered);
    };

    try {
      socket = net.createConnection(endpoint);
      socket.on("error", () => finish(false));
      socket.on("connect", () => {
        try {
          socket?.write(`${JSON.stringify(request)}\n`);
        } catch {
          finish(false);
        }
      });
      socket.on("data", () => finish(true));
      socket.on("end", () => finish(false));
      timeout = setTimeout(() => finish(false), timeoutMs);
      timeout.unref?.();
    } catch {
      finish(false);
    }
  });
}

async function sendSocketRequest(endpoint: string, request: HerdrRequest): Promise<void> {
  if (await socketAttempt(endpoint, request, FIRST_ATTEMPT_TIMEOUT_MS)) return;
  await socketAttempt(endpoint, request, RETRY_TIMEOUT_MS);
}

function sessionReference(context: Pick<ExtensionContext, "sessionManager">): SessionReference | undefined {
  try {
    const file = context.sessionManager?.getSessionFile?.();
    if (isAbsoluteSessionPath(file)) return { agent_session_path: file };
  } catch {
    // A missing session reference is tolerated; a later lifecycle event may provide one.
  }
  try {
    const id = context.sessionManager?.getSessionId?.();
    if (typeof id === "string" && id.length > 0) return { agent_session_id: id };
  } catch {
    // No usable fallback.
  }
  return undefined;
}

function requestId(kind: "state" | "session"): string {
  return `${SOURCE}:${kind}:${Date.now()}:${Math.random().toString(36).slice(2)}`;
}

/**
 * Owns one activation's request ordering and state coalescing. The send seam makes lifecycle
 * tests independent of a real terminal socket and makes transport failure harmless to Pi.
 */
export function createHerdrReporter(env = process.env, options: HerdrReporterOptions = {}): HerdrReporter | undefined {
  if (!herdrPresent(env)) return undefined;
  const paneId = env.HERDR_PANE_ID!;
  const endpoint = herdrSocketEndpoint(env, options.platform);
  if (!endpoint) return undefined;
  const send = options.send ?? ((request: HerdrRequest) => sendSocketRequest(endpoint, request));

  let closed = false;
  let sequence = Date.now() * 1000;
  let reference: SessionReference | undefined;
  let requestQueue: Promise<void> = Promise.resolve();
  let pending: PendingState | undefined;
  let draining: Promise<void> | undefined;

  const nextSequence = () => {
    sequence += 1;
    return sequence;
  };
  const enqueue = (request: HerdrRequest) => {
    requestQueue = requestQueue.catch(() => undefined).then(async () => {
      try {
        await send(request);
      } catch {
        // Terminal state reporting must never fail a Pi lifecycle handler.
      }
    });
    return requestQueue;
  };
  const withReference = (params: Record<string, unknown>): Record<string, unknown> => reference ? { ...params, ...reference } : params;
  const sendState = (state: PendingState) => enqueue({
    id: requestId("state"),
    method: "pane.report_agent",
    params: withReference({ pane_id: paneId, source: SOURCE, agent: AGENT, seq: state.seq, state: state.state, ...(state.message ? { message: state.message } : {}) }),
  });
  const drain = async () => {
    while (!closed && pending) {
      const next = pending;
      pending = undefined;
      await sendState(next);
    }
  };
  const ensureDrain = () => {
    if (draining) return;
    draining = drain().finally(() => {
      draining = undefined;
      if (!closed && pending) ensureDrain();
    });
  };

  return {
    updateSession(context) {
      if (closed) return;
      reference = sessionReference(context);
    },
    reportSession(reason) {
      if (closed || !reference) return Promise.resolve();
      return enqueue({
        id: requestId("session"),
        method: "pane.report_agent_session",
        params: {
          pane_id: paneId,
          source: SOURCE,
          agent: AGENT,
          seq: nextSequence(),
          ...(reason ? { session_start_source: reason } : {}),
          ...reference,
        },
      });
    },
    publish(state, message) {
      if (closed) return;
      pending = { state, message, seq: nextSequence() };
      ensureDrain();
    },
    close() {
      closed = true;
      pending = undefined;
    },
    async flush() {
      while (draining) await draining;
      await requestQueue;
    },
  };
}

function isBusy(context: ExtensionContext): boolean {
  try {
    return context.isIdle() === false;
  } catch {
    return false;
  }
}

function isSettledIdle(context: ExtensionContext): boolean {
  try {
    return context.isIdle() === true;
  } catch {
    return false;
  }
}

function sessionStartReason(event: unknown): string | undefined {
  const reason = (event as { reason?: unknown } | null)?.reason;
  return typeof reason === "string" ? reason : undefined;
}

/** Combine standard dialogs and questionnaire attention with Herdr's agent lifecycle. */
export function watchHerdrState(pi: ExtensionAPI, reporter: HerdrReporter): void {
  let closed = false;
  let rootSession = false;
  let agentActive = false;
  let prompt: UIPromptStartEvent | undefined;
  let askPending = 0;
  let askLabel: string | undefined;
  let activeAskLabel: string | undefined;
  let lastState: AgentState | undefined;
  let lastMessage: string | undefined;

  const attentionLabel = () => {
    if (prompt && prompt.kind !== "custom") return promptLabel(prompt, undefined);
    if (askPending > 0) return activeAskLabel ?? KIND_LABELS.custom;
    return undefined;
  };
  const publish = (force = false) => {
    if (closed || !rootSession) return;
    const label = attentionLabel();
    const state: AgentState = label ? "blocked" : agentActive ? "working" : "idle";
    const message = label;
    if (!force && state === lastState && message === lastMessage) return;
    lastState = state;
    lastMessage = message;
    try {
      reporter.publish(state, message);
    } catch {
      // A custom reporter must not break Pi's lifecycle either.
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
    publish();
  });
  pi.on("ui_prompt_start", (event) => {
    if (closed) return;
    prompt = event;
    publish();
  });
  pi.on("ui_prompt_end", () => {
    if (closed) return;
    prompt = undefined;
    askLabel = undefined;
    publish();
  });
  pi.on("session_start", async (event, context) => {
    if (context.mode !== "tui") return;
    rootSession = true;
    reporter.updateSession(context);
    try {
      await reporter.reportSession(sessionStartReason(event));
    } catch {
      // Reporter implementations are intentionally optional and fail-open.
    }
    if (closed || !rootSession) return;
    agentActive = isBusy(context);
    publish(true);
  });
  pi.on("agent_start", (_event, context) => {
    if (closed || !rootSession) return;
    reporter.updateSession(context);
    void reporter.reportSession();
    agentActive = true;
    publish();
  });
  pi.on("agent_settled", (_event, context) => {
    if (closed || !rootSession || !isSettledIdle(context)) return;
    agentActive = false;
    publish();
  });
  pi.on("session_shutdown", () => {
    if (closed) return;
    closed = true;
    rootSession = false;
    prompt = undefined;
    askPending = 0;
    askLabel = activeAskLabel = undefined;
    reporter.close();
  });
}

export default function herdrState(pi: ExtensionAPI): void {
  const reporter = createHerdrReporter();
  if (!reporter) return;
  watchHerdrState(pi, reporter);
}
