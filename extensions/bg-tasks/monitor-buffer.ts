/** Bounded prefix previews shared by monitor sources and notification batches. */
export interface MonitorPreview {
    lines: { text: string; omittedChars: number }[];
    omittedLines: number;
    omittedChars: number;
    truncatedLines: number;
}

export function prefix(text: string, chars: number): string {
    let end = Math.min(text.length, Math.max(0, chars));
    if (end > 0 && end < text.length && /[\uD800-\uDBFF]/.test(text[end - 1]!)) end--;
    return text.slice(0, end);
}

export class MonitorBuffer {
    private lines: { text: string; omittedChars: number }[] = [];
    private chars = 0;
    private omittedLines = 0;
    private omittedChars = 0;
    private truncatedLines = 0;
    private exhausted = false;
    private maxLines: number;
    private maxChars: number;
    constructor(maxLines: number, maxChars: number) {
        this.maxLines = maxLines;
        this.maxChars = maxChars;
    }

    addLine(text: string, missingChars = 0): void {
        const separator = this.lines.length ? 1 : 0;
        const available = this.maxChars - this.chars - separator;
        if (this.exhausted || this.lines.length >= this.maxLines || available < 0 ||
            (available === 0 && (text.length > 0 || missingChars > 0))) {
            this.exhausted = true;
            this.omittedLines++;
            this.omittedChars += text.length + missingChars;
            return;
        }
        const shown = prefix(text, available);
        this.lines.push({ text: shown, omittedChars: text.length - shown.length + missingChars });
        this.chars += separator + shown.length;
        const omitted = text.length - shown.length + missingChars;
        this.omittedChars += omitted;
        if (omitted) { this.truncatedLines++; this.exhausted = true; }
    }

    addText(text: string): void {
        // Scan rather than split: a huge WS frame must not leave a huge array.
        let start = 0;
        for (let i = 0; i < text.length; i++) {
            if (text[i] === "\n") {
                this.addLine(text.slice(start, i));
                start = i + 1;
            }
        }
        if (start < text.length || text.length === 0) this.addLine(text.slice(start));
    }

    add(preview: MonitorPreview): void {
        for (const line of preview.lines) this.addLine(line.text, line.omittedChars);
        this.omittedLines += preview.omittedLines;
        if (preview.omittedLines || preview.omittedChars) this.exhausted = true;
        this.omittedChars += preview.omittedChars - preview.lines.reduce((sum, line) => sum + line.omittedChars, 0);
    }

    get hasContent(): boolean {
        return this.lines.length > 0 || this.omittedLines > 0 || this.omittedChars > 0;
    }

    take(): MonitorPreview {
        const result = { lines: this.lines, omittedLines: this.omittedLines,
            omittedChars: this.omittedChars, truncatedLines: this.truncatedLines };
        this.lines = [];
        this.exhausted = false;
        this.chars = this.omittedLines = this.omittedChars = this.truncatedLines = 0;
        return result;
    }
}

export function previewText(preview: MonitorPreview): string {
    const lines = preview.lines.map((line) => line.text);
    if (preview.omittedLines || preview.omittedChars || preview.truncatedLines) {
        lines.push(`[notification omitted: ${preview.omittedLines} whole lines, ${preview.omittedChars} characters; ${preview.truncatedLines} truncated lines — full output in log]`);
    }
    return lines.join("\n");
}
