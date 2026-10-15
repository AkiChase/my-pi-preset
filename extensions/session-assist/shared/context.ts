import { createHash } from "node:crypto";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
type SessionReader = ExtensionContext["sessionManager"];

export interface ConversationPart {
    role: "user" | "assistant" | "compactionSummary" | "branchSummary";
    text: string;
}

/** Use the canonical projection before converting custom roles into user messages. */
export function prepareConversation(manager: SessionReader): ConversationPart[] {
    return manager.buildSessionProjection().messages.flatMap<ConversationPart>(message => {
        if (message.role === "compactionSummary" || message.role === "branchSummary") {
            return [{ role: message.role, text: message.summary }];
        }
        if (message.role !== "user" && message.role !== "assistant") return [];
        const text = typeof message.content === "string" ? message.content : message.content
            .filter(part => part.type === "text").map(part => part.text).join("\n");
        return text.trim() ? [{ role: message.role, text }] : [];
    });
}

export function fingerprint(value: unknown): string {
    return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

/** Context-neutral entries must not invalidate their owner's own request. */
export function branchIdentity(manager: SessionReader): string {
    return fingerprint(manager.getBranch().filter(entry => entry.type !== "custom" &&
        entry.type !== "usage" && entry.type !== "label" && entry.type !== "session_info")
        .map(entry => entry.id));
}
