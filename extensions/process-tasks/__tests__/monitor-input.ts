/**
 * Test-only shorthand for valid complete Monitor wire envelopes, in the form the
 * host delivers after coercion: unset fields and JSON null become "null",
 * numbers become decimal strings and ws.protocols defaults to [].
 */
export function monitorInput(input: Record<string, unknown>): Record<string, unknown> {
    const call: Record<string, unknown> = { command: "null", ws: "null", description: "test monitor", timeout_ms: "null", wake_absent_ms: "null" };
    for (const [key, value] of Object.entries(input)) {
        if (value === null) call[key] = "null";
        else if (typeof value === "number" && (key === "timeout_ms" || key === "wake_absent_ms")) call[key] = String(value);
        else if (key === "ws" && value && typeof value === "object" && !Array.isArray(value)) {
            const ws = value as Record<string, unknown>;
            call.ws = { ...ws, protocols: ws.protocols === null || ws.protocols === undefined ? [] : ws.protocols };
        } else call[key] = value;
    }
    return call;
}
