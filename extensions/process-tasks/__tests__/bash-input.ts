/** Test-only complete input for the registered Bash override, never SDK built-in Bash. */
export function bashInput(input: { command: string; background_after_seconds?: number; description?: string } & Record<string, unknown>) {
    return { background_after_seconds: -1, description: "", ...input };
}
