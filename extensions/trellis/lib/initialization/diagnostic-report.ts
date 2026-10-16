import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Box, Text } from "@earendil-works/pi-tui";
import { DIAGNOSTIC_LIMITS, type DiagnosticReport, type DiagnosticReportLine } from "./diagnostics.ts";

export const CHECK_REPORT_TYPE = "trellis-check-report";
const tones = new Set(["text", "accent", "error", "warning", "success", "muted"]);
/** Restored session details are untrusted. A renderer never reads the project again. */
export function isDiagnosticReport(value: unknown): value is DiagnosticReport {
	if (!value || typeof value !== "object") return false;
	const report = value as Partial<DiagnosticReport>;
	if (report.version !== 1) return false;
	return [report.compact, report.expanded].every(lines => {
		if (!Array.isArray(lines) || lines.length > 1100) return false;
		let bytes = 0;
		return lines.every((line: DiagnosticReportLine) => {
			if (!line || typeof line !== "object" || typeof line.text !== "string" || line.text.length > DIAGNOSTIC_LIMITS.report || !tones.has(line.tone) || /[\p{C}\p{Zl}\p{Zp}]/u.test(line.text.replace(/\n/g, ""))) return false;
			bytes += Buffer.byteLength(line.text) + 1;
			return bytes <= DIAGNOSTIC_LIMITS.report;
		});
	});
}
export function diagnosticReportLines(details: unknown, content: unknown, expanded: boolean): DiagnosticReportLine[] {
	if (isDiagnosticReport(details)) return expanded ? details.expanded : details.compact;
	const text = typeof content === "string" ? content : "Check project · Report details unavailable";
	// Keep fallback bounded even for malformed restored messages; preserve only newlines.
	return [{ text: text.replace(/\r\n?/g, "\n").slice(0, 4000).replace(/[\p{C}\p{Zl}\p{Zp}]/gu, char => char === "\n" ? char : " "), tone: "text" }];
}
export function registerDiagnosticReport(pi: ExtensionAPI): void {
	pi.registerMessageRenderer(CHECK_REPORT_TYPE, (message, { expanded, outputPad }, theme) => {
		const lines = diagnosticReportLines(message.details, message.content, expanded);
		const box = new Box(outputPad, 1, text => theme.bg("customMessageBg", text));
		const styled = lines.map(line => {
			// Counts carry their own status colors; zero errors/warnings are not alerts.
			if (!/^[✗⊘]/u.test(line.text) || line.text.includes("[")) return theme.fg(line.tone, line.text);
			return line.text.replace(/(Errors|Warnings|Passed|Blocked|Skipped|Cancelled) (\d+)/g, (match, label: string, count: string) => {
				const tone = count === "0" ? "muted" : label === "Errors" ? "error" : label === "Warnings" || label === "Blocked" ? "warning" : label === "Passed" ? "success" : "muted";
				return theme.fg(tone, match);
			});
		});
		box.addChild(new Text(styled.join("\n"), 0, 0));
		return box;
	});
}
