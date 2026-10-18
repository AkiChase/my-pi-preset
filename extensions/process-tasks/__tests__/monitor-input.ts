/** Test-only shorthand for valid complete Monitor wire envelopes. */
export function monitorInput(input: Record<string, unknown>): Record<string, unknown> {
    const ws = input.ws;
    return {
        command: null, ws: null, description: "test monitor", timeout_ms: null, wake_absent_ms: null,
        ...input,
        ...(ws && typeof ws === "object" && !Array.isArray(ws)
            ? { ws: { protocols: null, ...ws } } : {}),
    };
}
