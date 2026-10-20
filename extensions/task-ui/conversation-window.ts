import type { ConversationEntry, ConversationPage } from "./types.ts";

export const HISTORY_MAX_PAGES = 3;
export const HISTORY_MAX_ENTRIES = 256;
export const HISTORY_MAX_BYTES = 768 * 1024;

/** Source-owned cursors, bounded resident pages. No I/O or terminal scroll policy. */
export class ConversationWindow {
    private pages: ConversationPage[] = [];
    hint?: string;
    blocked = false;
    get entries(): readonly ConversationEntry[] {
        const seen = new Set<string>();
        return this.pages.flatMap(page => page.entries).filter(entry => {
            if (!entry.id) return true;
            if (seen.has(entry.id)) return false;
            seen.add(entry.id); return true;
        });
    }
    get first(): ConversationPage | undefined { return this.pages[0]; }
    get last(): ConversationPage | undefined { return this.pages.at(-1); }
    get pageCount(): number { return this.pages.length; }
    clear(): void { this.pages = []; this.hint = undefined; this.blocked = false; }
    accept(page: ConversationPage, direction: "latest" | "before" | "after", following: boolean): boolean {
        if (page.status !== "ok") {
            // An unavailable latest page can still carry source-owned terminal
            // annotations. Seed only an empty window, within the same budgets;
            // never replace a readable historical snapshot with a failed read.
            if (page.status === "unavailable" && direction === "latest" && !this.entries.length &&
                page.entries.length <= HISTORY_MAX_ENTRIES && Buffer.byteLength(JSON.stringify(page.entries)) <= HISTORY_MAX_BYTES)
                this.pages = [page];
            this.hint = page.hint ?? (page.status === "reset" ? "History changed. Press End to reload latest." : "Conversation unavailable. Copy the artifact path to inspect it.");
            this.blocked = true; return false;
        }
        if (this.first && this.first.generation !== page.generation && (direction !== "latest" || !following)) {
            this.hint = "History changed. Press End to reload latest."; this.blocked = true; return false;
        }
        if (direction === "latest" && !following && this.pages.length) {
            // Preserve the historical window, but remember that its tail is no longer latest.
            // Otherwise reaching that stale tail could re-enable native follow prematurely.
            const residentIds = new Set(this.entries.map(entry => entry.id));
            if (page.entries.some(entry => entry.id && !residentIds.has(entry.id)) && this.last)
                this.pages[this.pages.length - 1] = { ...this.last, hasNewer: true };
            return false;
        }
        if (page.entries.length > HISTORY_MAX_ENTRIES || Buffer.byteLength(JSON.stringify(page.entries)) > HISTORY_MAX_BYTES) {
            this.hint = "Conversation page exceeds the display budget. Copy the artifact path to inspect it.";
            this.blocked = true; return false;
        }
        if (direction === "latest") this.pages = [page];
        else if (direction === "before") this.pages.unshift(page);
        else this.pages.push(page);
        const over = () => this.pages.length > HISTORY_MAX_PAGES || this.pages.reduce((n, p) => n + p.entries.length, 0) > HISTORY_MAX_ENTRIES ||
            this.pages.reduce((n, p) => n + Buffer.byteLength(JSON.stringify(p.entries)), 0) > HISTORY_MAX_BYTES;
        while (this.pages.length > 1 && over()) {
            if (direction === "before") this.pages.pop(); else this.pages.shift();
        }
        this.blocked = false;
        this.hint = page.hint ?? (page.budgetLimited ? "Additional history not loaded within the source budget." : undefined);
        return true;
    }
}
