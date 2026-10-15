import { createHash } from "node:crypto";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
type SessionReader = ExtensionContext["sessionManager"];

function fingerprint(value: unknown): string {
    return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

/** Context-neutral entries must not invalidate their owner's own request. */
export function branchIdentity(manager: SessionReader): string {
    return fingerprint(manager.getBranch().filter(entry => entry.type !== "custom" &&
        entry.type !== "usage" && entry.type !== "label" && entry.type !== "session_info")
        .map(entry => entry.id));
}
