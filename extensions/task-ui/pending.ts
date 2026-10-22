import { ScrollView, truncateToWidth, wrapTextWithAnsi, matchesKey } from "@earendil-works/pi-tui";
import type { PendingMessage, PendingMessages } from "./types.ts";
import { cleanTaskText, taskOneLine, type TaskTheme } from "./presentation.ts";

/** Independent one-row-per-message viewport, with stable occurrence anchors. */
export class PendingRegion {
    readonly scroll: ScrollView;
    entries: readonly PendingMessage[] = [];
    omitted = 0;
    focused = false;
    private anchor?: string;
    private readonly theme: () => TaskTheme;
    constructor(theme: () => TaskTheme, invalidate: () => void) {
        this.theme = theme;
        this.scroll = new ScrollView({ render: width => this.entries.map(item => {
            const label = item.state === "submitting" ? "Submitting · " : item.state === "failed" ? "Failed · " : item.state === "handled" ? "Handled by input extension · not queued · " : item.state === "notDelivered" ? "Not delivered · " : "";
            const text = label + taskOneLine(item.text) + (item.truncated ? " · text truncated" : "");
            return this.theme().fg(item.state === "failed" ? "error" : item.state === "pending" || item.state === "submitting" ? "text" : "muted", truncateToWidth(text, width, "…"));
        }), invalidate }, { follow: "end", overscroll: "contain", scrollbar: "always",
            scrollbarTrackStyle: text => this.theme().fg("dim", text), scrollbarThumbStyle: text => this.theme().fg("accent", text) });
    }
    accept(snapshot?: PendingMessages): void {
        this.anchor = this.scroll.isFollowingEnd ? undefined : this.entries[this.scroll.scrollTop]?.id;
        const previous = this.entries;
        this.entries = snapshot?.entries ?? []; this.omitted = snapshot?.omitted ?? 0;
        if (this.anchor) {
            let index = this.entries.findIndex(item => item.id === this.anchor);
            // If the anchor was consumed, keep the next surviving occurrence in view.
            if (index < 0) {
                const at = previous.findIndex(item => item.id === this.anchor);
                const next = previous.slice(at + 1).find(item => this.entries.some(entry => entry.id === item.id));
                index = next ? this.entries.findIndex(item => item.id === next.id) : this.scroll.scrollTop;
            }
            this.scroll.scrollTo(Math.max(0, index), { disableFollow: true });
        }
        if (!this.entries.length) this.focused = false;
    }
    title(width: number): string {
        const count = this.entries.length + this.omitted;
        const start = Math.min(this.entries.length, this.scroll.scrollTop + 1), end = Math.min(this.entries.length, this.scroll.scrollTop + this.scroll.viewportHeight);
        return this.theme().fg(this.focused ? "accent" : "muted", truncateToWidth(`Pending ${count} · ${start}–${end}${this.omitted ? ` · ${this.omitted} omitted` : ""}`, width, "…"));
    }
}

/** Full bounded snapshot content in a native scroll view, never a horizontally clipped Input. */
export class PendingReader {
    readonly scroll: ScrollView;
    readonly item: PendingMessage;
    constructor(item: PendingMessage, theme: () => TaskTheme, invalidate: () => void, title?: string) {
        this.item = item;
        this.scroll = new ScrollView({ render: width => [
            theme().fg(item.state === "failed" ? "error" : "muted", `${title ?? (item.state === "submitting" ? "Submitting" : item.state === "handled" ? "Handled by input extension · not queued" : item.state === "failed" ? "Failed" : item.state === "notDelivered" ? "Not delivered" : "Pending")} · Esc Back${item.truncated ? " · source text truncated" : ""}`),
            ...cleanTaskText(item.text).split(/\r\n|\n|\r/).flatMap(line => wrapTextWithAnsi(line, Math.max(1, width))),
            ...(item.error ? wrapTextWithAnsi(cleanTaskText(item.error), Math.max(1, width)).map(line => theme().fg("muted", line)) : []),
        ], invalidate }, { follow: "none", overscroll: "contain", scrollbar: "always",
            scrollbarTrackStyle: text => theme().fg("dim", text), scrollbarThumbStyle: text => theme().fg("accent", text) });
    }
    input(data: string): void {
        if (matchesKey(data, "home")) this.scroll.scrollToStart();
        else if (matchesKey(data, "end")) this.scroll.scrollToEnd();
        else if (matchesKey(data, "up") || matchesKey(data, "k")) this.scroll.scrollBy(-1);
        else if (matchesKey(data, "down") || matchesKey(data, "j")) this.scroll.scrollBy(1);
    }
}
