const HIDDEN_FIELDS = /^(?:headers?|request|requestbody|request_body|payload|stack|stacktrace|stack_trace|body)$/iu;
const SECRET_FIELDS = /^(?:(?:x[_-])?api[_-]?key|access[_-]?token|refresh[_-]?token|password|secret|authorization|proxy-authorization|cookie|set-cookie)$/iu;

/** Locate one serialized value, honoring escaped strings and nested diagnostic containers. */
function valueEnd(text: string, start: number): number {
    const first = text[start];
    if (first === '"' || first === "'") {
        for (let i = start + 1; i < text.length; i++) {
            if (text[i] === "\\") { i++; continue; }
            if (text[i] === first) return i + 1;
        }
        return text.length;
    }
    if (first === "{" || first === "[") {
        const stack = [first];
        for (let i = start + 1; i < text.length; i++) {
            if (text[i] === '"' || text[i] === "'") { i = valueEnd(text, i) - 1; continue; }
            if (text[i] === "{" || text[i] === "[") stack.push(text[i]);
            else if (text[i] === "}" || text[i] === "]") {
                const opening = stack.pop();
                if ((opening === "{" && text[i] !== "}") || (opening === "[" && text[i] !== "]")) return text.length;
                if (!stack.length) return i + 1;
            }
        }
        return text.length;
    }
    // Unquoted header values can contain spaces and semicolons (Basic, Cookie).
    // Conservatively consume the line; never expose an unknown credential suffix.
    const end = text.slice(start).search(/[\r\n]/u);
    return end < 0 ? text.length : start + end;
}

function removeDiagnosticFields(text: string, depth = 0): string {
    // Bound recursive decoding of provider-supplied quoted diagnostic messages.
    if (depth > 12) return "[diagnostic nesting truncated]";
    // Also consume standalone quoted values, so their prose is not mistaken for keys.
    const keyPattern = /("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|\b[A-Za-z][A-Za-z0-9_-]*)\s*[:=]\s*|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'/gu;
    let output = "";
    let copied = 0;
    for (let match = keyPattern.exec(text); match; match = keyPattern.exec(text)) {
        const raw = match[1];
        if (raw === undefined) {
            const quoted = match[0];
            if (quoted.startsWith('"')) {
                try {
                    const decoded: unknown = JSON.parse(quoted);
                    if (typeof decoded === "string") {
                        const safe = removeDiagnosticFields(normalizeControls(decoded), depth + 1);
                        output += text.slice(copied, match.index) + JSON.stringify(safe);
                        copied = keyPattern.lastIndex;
                    }
                } catch {
                    output += text.slice(copied, match.index) + '"[unreadable diagnostic]"';
                    copied = keyPattern.lastIndex;
                }
            } else {
                // Single-quoted diagnostic values are not JSON; sanitize their contents too.
                const decoded = quoted.slice(1, -1).replace(/\\(['\\])/gu, "$1");
                const safe = removeDiagnosticFields(normalizeControls(decoded), depth + 1);
                output += text.slice(copied, match.index) + JSON.stringify(safe);
                copied = keyPattern.lastIndex;
            }
            continue;
        }
        let key = raw;
        if (raw.startsWith('"')) {
            try { key = JSON.parse(raw) as string; } catch { key = raw.slice(1, -1); }
        } else if (raw.startsWith("'")) key = raw.slice(1, -1);
        key = normalizeControls(key);
        const start = keyPattern.lastIndex;
        const structured = raw.startsWith('"') || raw.startsWith("'") || text[start] === "{" || text[start] === "[" || /=$/u.test(match[0].trim());
        // "Bad request: reason" is prose, unlike a quoted request field or payload object.
        const hidden = HIDDEN_FIELDS.test(key) && (structured || !/^(?:request|body)$/iu.test(key));
        if (!hidden && !SECRET_FIELDS.test(key)) continue;
        const end = valueEnd(text, start);
        output += text.slice(copied, match.index) + `${match[0]}[redacted]`;
        copied = end;
        keyPattern.lastIndex = end;
    }
    return output + text.slice(copied);
}

function normalizeControls(text: string): string {
    return text
        .replace(/\u001b\][\s\S]*?(?:\u0007|\u001b\\)/gu, "")
        .replace(/\u001b\[[0-?]*[ -/]*[@-~]/gu, "")
        // Preserve line boundaries for unquoted headers; remove decoration within keys.
        .replace(/[\u0000-\u0009\u000b\u000c\u000e-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/gu, "")
        .replace(/(?:\r?\n)\s*at\s+[^\r\n]*/gu, "");
}

/** Keep readable reasons, never display embedded request diagnostics or stacks. */
export function failureDetail(error: unknown): string {
    const raw = error instanceof Error ? error.message : typeof error === "string" ? error : "Request failed without error details";
    // Remove diagnostic fields before flattening lines, which delimit unquoted headers.
    const cleaned = removeDiagnosticFields(normalizeControls(raw))
        .replace(/(?:\r?\n)\s*at\s+[^\r\n]*/gu, "")
        .replace(/\b(Bearer|Basic)\s+[A-Za-z0-9._~+\/-]+=*/giu, "$1 [redacted]")
        .replace(/\bsk-[A-Za-z0-9_-]{8,}\b/gu, "[redacted]")
        .replace(/(https?:\/\/)[^\s/@]+:[^\s/@]+@/giu, "$1[redacted]@")
        .replace(/\s+/gu, " ").trim();
    const text = cleaned || "Request failed without error details";
    const chars = Array.from(text);
    return chars.length > 500 ? `${chars.slice(0, 480).join("")}… [truncated]` : text;
}
