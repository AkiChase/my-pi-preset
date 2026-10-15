import { createHash } from "node:crypto";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { cleanText } from "./output.ts";

export const OMITTED = "[Earlier context omitted]";
export const TOOL_RESULT_LIMIT = 100;
interface Block { auxiliary: boolean; label: string; points: string[]; removed: boolean }
export interface Material { text: string; identity: string; empty: boolean; chars: number }
function textOf(content: string | readonly { type: string; text?: string }[]): string {
    return typeof content === "string" ? content : content.filter(part => part.type === "text").map(part => part.text ?? "").join("\n");
}
function capped(text: string, limit: number): string {
    const points = Array.from(text);
    return points.length <= limit ? text : `${points.slice(0, limit - 1).join("")}…`;
}
/** Linear budgeting over the canonical, context-edited current projection, never raw history. */
export function buildMaterial(manager: ExtensionContext["sessionManager"], budget: number): Material {
    if (!Number.isSafeInteger(budget) || budget < 1) throw new Error("Invalid Recap material budget");
    const blocks: Block[] = [];
    const hash = createHash("sha256");
    const add = (id: string, label: string, text: string, auxiliary = false, limit?: number, rawLabel = label) => {
        if (!text.trim()) return;
        // Full relevant content identifies freshness even when budgeting hides older evidence.
        hash.update(JSON.stringify([id, rawLabel, text]));
        blocks.push({ auxiliary, label: `${label}: `, points: Array.from(limit ? capped(text, limit) : text), removed: false });
    };
    for (const projected of manager.buildSessionProjection().entries) {
        for (const message of projected.messages) {
            const id = projected.sourceEntry.id;
            if (message.role === "user" || message.role === "assistant") {
                add(id, message.role === "user" ? "User" : "Assistant", textOf(message.content));
                if (message.role === "assistant") for (const part of message.content) {
                    if (part.type === "toolCall") {
                        const raw = `Tool call ${part.namespace ? `${part.namespace}.` : ""}${part.name}`;
                        add(id, cleanText(raw).replace(/\u061c/g, ""), JSON.stringify(part.arguments), true, undefined,
                            JSON.stringify(["Tool call", part.namespace ?? null, part.name]));
                    }
                }
            } else if (message.role === "compactionSummary" || message.role === "branchSummary") {
                add(id, message.role === "compactionSummary" ? "Compaction summary" : "Branch summary", message.summary);
            } else if (message.role === "toolResult") {
                const raw = `Tool result ${message.toolName}${message.isError ? " (error)" : ""}`;
                add(id, cleanText(raw).replace(/\u061c/g, ""), textOf(message.content), true, TOOL_RESULT_LIMIT, raw);
            } else if (message.role === "bashExecution" && !message.excludeFromContext) {
                add(id, "Execution command", message.command, true);
                add(id, `Execution result (exit ${message.exitCode ?? "unknown"}${message.cancelled ? ", cancelled" : ""})`, message.output, true, TOOL_RESULT_LIMIT);
            } else if (message.role === "custom") {
                // Model-visible custom messages are context; plain custom entries remain neutral.
                add(id, "Context", textOf(message.content), true);
            }
        }
    }
    const identity = hash.digest("hex");
    if (!blocks.length) return { text: "", identity, empty: true, chars: 0 };
    const size = (block: Block) => Array.from(block.label).length + block.points.length + 1;
    // Count a trailing separator for every block, then subtract exactly one at final render.
    let total = blocks.reduce((sum, block) => sum + size(block), 0) - 1;
    let omitted = false;
    if (total > budget) {
        omitted = true;
        total += Array.from(OMITTED).length + 1;
        for (const block of blocks) {
            if (total <= budget) break;
            if (block.auxiliary) { block.removed = true; total -= size(block); }
        }
        for (const block of blocks) {
            if (total <= budget) break;
            if (block.removed) continue;
            const excess = total - budget;
            if (excess >= block.points.length || budget <= Array.from(OMITTED).length + block.label.length + 1) {
                block.removed = true; total -= size(block);
            } else {
                block.points = block.points.slice(excess);
                total -= excess;
            }
        }
    }
    const kept = blocks.filter(block => !block.removed).map(block => block.label + block.points.join(""));
    const text = [ ...(omitted ? [OMITTED] : []), ...kept ].join("\n");
    // Tiny test budgets can only hold a prefix of the omission marker.
    const bounded = Array.from(text).slice(0, budget).join("");
    return { text: bounded, identity, empty: false, chars: Array.from(bounded).length };
}
