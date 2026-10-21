import type { MessageRenderOptions, Theme } from "@earendil-works/pi-coding-agent";
import type { Component } from "@earendil-works/pi-tui";
import { createNotificationCard } from "../beautify/notification-card.ts";
import { clean, wrap } from "../beautify/layout.ts";
import type { ProcessTasksConfig } from "./config.ts";

const TERMINAL = new Set(["completed", "failed", "killed"]);
const MONITOR_STATES = new Set(["progress", "absent", "resumed", "completed", "failed", "killed"]);

type Tone = "accent" | "muted" | "success" | "warning" | "error";
interface ProcessDetails {
  status?: "completed" | "failed" | "killed";
  summary?: string;
  outputFile?: string;
  outputTail?: string;
  monitor?: { state: string; description: string };
  monitorBatch?: readonly unknown[];
  monitorBatchOverflow?: { sourceCount?: number; omittedSources?: number };
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

function parseDetails(value: unknown): ProcessDetails {
  const details = record(value);
  if (!details) return {};
  const status = typeof details.status === "string" && TERMINAL.has(details.status) ? details.status as ProcessDetails["status"] : undefined;
  const monitorRaw = record(details.monitor);
  const monitor = monitorRaw && typeof monitorRaw.state === "string" && MONITOR_STATES.has(monitorRaw.state) && typeof monitorRaw.description === "string"
    ? { state: monitorRaw.state, description: monitorRaw.description }
    : undefined;
  const overflowRaw = record(details.monitorBatchOverflow);
  const monitorBatchOverflow = overflowRaw && Number.isSafeInteger(overflowRaw.sourceCount) && Number.isSafeInteger(overflowRaw.omittedSources)
    ? { sourceCount: Number(overflowRaw.sourceCount), omittedSources: Number(overflowRaw.omittedSources) }
    : undefined;
  return {
    status,
    summary: typeof details.summary === "string" ? details.summary : undefined,
    outputFile: typeof details.outputFile === "string" ? details.outputFile : undefined,
    outputTail: typeof details.outputTail === "string" ? details.outputTail : undefined,
    monitor,
    monitorBatch: Array.isArray(details.monitorBatch) ? details.monitorBatch : undefined,
    monitorBatchOverflow,
  };
}

function sourceText(value: unknown): string {
  return typeof value === "string" ? value : "Process notification details unavailable.";
}

function toneFor(state: string): Tone {
  if (state === "completed" || state === "resumed") return "success";
  if (state === "failed") return "error";
  if (state === "absent" || state === "killed") return "warning";
  return "accent";
}

function terminalBody(details: ProcessDetails, options: MessageRenderOptions, theme: Theme, config: Pick<ProcessTasksConfig, "failureTailLinesShown">): Component {
  return {
    invalidate() {},
    render(width) {
      const rows: string[] = [];
      if (details.outputFile) rows.push(...wrap(`log: ${clean(details.outputFile)}`, width).map(row => theme.fg("muted", row)));
      const tail = details.outputTail ? clean(details.outputTail).split(/\r\n|\n|\r/) : [];
      const shown = options.expanded ? tail : config.failureTailLinesShown > 0 ? tail.slice(-config.failureTailLinesShown) : [];
      for (const line of shown) rows.push(...wrap(`  │ ${line}`, width).map(row => theme.fg("muted", row)));
      if (!options.expanded && shown.length < tail.length) {
        const omitted = tail.length - shown.length;
        rows.push(...wrap(`… (${omitted} tail line${omitted === 1 ? "" : "s"} hidden, expand)`, width).map(row => theme.fg("muted", row)));
      }
      return rows;
    },
  };
}

/** Render a process/monitor custom message without changing delivery or batching. */
export function renderProcessNotification(
  message: { content: unknown; details?: unknown },
  options: MessageRenderOptions,
  theme: Theme,
  config: Pick<ProcessTasksConfig, "failureTailLinesShown">,
): Component {
  const details = parseDetails(message.details);
  const content = sourceText(message.content);
  if (details.monitorBatch) {
    const count = details.monitorBatchOverflow?.sourceCount ?? details.monitorBatch.length;
    return createNotificationCard({
      identity: "monitor",
      summary: `${count} source${count === 1 ? "" : "s"}`,
      marker: { label: "batch", tone: "muted" },
      ...(details.monitorBatchOverflow?.omittedSources ? { statistics: [{ label: `${details.monitorBatchOverflow.omittedSources} omitted`, tone: "warning" as const }] } : {}),
      textBody: content,
      bodyTone: "muted",
    }, options, theme);
  }
  if (details.monitor) {
    return createNotificationCard({
      identity: "monitor",
      summary: details.monitor.description,
      marker: { label: details.monitor.state, tone: toneFor(details.monitor.state) },
      textBody: content,
      bodyTone: "muted",
    }, options, theme);
  }
  if (details.status && details.summary) {
    return createNotificationCard({
      identity: "process",
      summary: details.summary,
      marker: { label: details.status, tone: toneFor(details.status) },
      body: terminalBody(details, options, theme, config),
    }, options, theme);
  }
  return createNotificationCard({
    identity: "process",
    summary: details.summary,
    marker: { label: "attention", tone: "warning" },
    textBody: content,
    bodyTone: "muted",
  }, options, theme);
}
