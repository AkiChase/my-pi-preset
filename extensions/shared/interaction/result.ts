import type { ExtensionContext } from "@earendil-works/pi-coding-agent";

export type InteractionResult<T> =
    | { kind: "completed"; value: T }
    | { kind: "cancelled" }
    | { kind: "stale" }
    | { kind: "unsupported"; mode: ExtensionContext["mode"] }
    | { kind: "error"; error: unknown };
