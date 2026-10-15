import type { AssistantMessage, ModelThinkingLevel } from "@earendil-works/pi-ai";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";

export const REQUEST_TIMEOUT_MS = 120_000;
export class RequestCancelled extends Error {}
export class RequestFailed extends Error {}

/** A deadline owns the wait even if a third-party provider ignores its signal. */
export async function generateText(args: {
    registry: ExtensionContext["modelRegistry"];
    model: NonNullable<ExtensionContext["model"]>;
    thinking: ModelThinkingLevel;
    sessionId: string;
    systemPrompt: string;
    data: unknown;
    /** Explicit literal material; omitting it preserves the naming JSON wire format. */
    textMaterial?: string;
    signal: AbortSignal;
    timeoutMs?: number;
}): Promise<AssistantMessage> {
    if (args.signal.aborted) throw new RequestCancelled("Request cancelled");
    const controller = new AbortController();
    const timeoutMs = args.timeoutMs ?? REQUEST_TIMEOUT_MS;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let rejectWait: (reason: Error) => void = () => {};
    const cancelled = new Promise<never>((_resolve, reject) => { rejectWait = reject; });
    const onAbort = () => {
        controller.abort();
        rejectWait(new RequestCancelled("Request cancelled"));
    };
    args.signal.addEventListener("abort", onAbort, { once: true });
    timer = setTimeout(() => {
        controller.abort();
        rejectWait(new RequestFailed("Request timed out"));
    }, timeoutMs);
    try {
        const result = await Promise.race([
            args.registry.streamSimple(args.model, {
                systemPrompt: args.systemPrompt,
                messages: [{ role: "user", content: args.textMaterial ?? JSON.stringify(args.data), timestamp: Date.now() }],
            }, {
                // Public simple options represent the current 'off' level by absence.
                reasoning: args.thinking === "off" ? undefined : args.thinking, signal: controller.signal,
                sessionId: args.sessionId, timeoutMs,
            }).result(),
            cancelled,
        ]);
        if (args.signal.aborted) throw new RequestCancelled("Request cancelled");
        if (result.stopReason !== "stop") {
            const detail = result.errorMessage?.trim();
            throw new RequestFailed(detail || `Provider response ended with ${result.stopReason}`);
        }
        return result;
    } finally {
        clearTimeout(timer);
        args.signal.removeEventListener("abort", onAbort);
    }
}
