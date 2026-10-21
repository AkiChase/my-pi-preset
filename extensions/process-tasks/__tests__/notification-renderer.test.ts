import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { visibleWidth } from "@earendil-works/pi-tui";
import { renderProcessNotification } from "../notification-renderer.ts";

const theme = {
  fg: (_colour: string, text: string) => text,
  bg: (_colour: string, text: string) => text,
} as never;
const config = { failureTailLinesShown: 2 };
const collapsed = { expanded: false, outputPad: 0 };
const expanded = { expanded: true, outputPad: 0 };

describe("process notification cards", () => {
  it("retains the configured terminal tail budget and expands to delivered tail text", () => {
    const message = {
      content: "[task b123 · failed] command failed\nlog: /tmp/task.log\n--- output tail ---\none\ntwo\nthree",
      details: { status: "failed", summary: "command failed", outputFile: "/tmp/task.log", outputTail: "one\ntwo\nthree" },
    };
    const compact = renderProcessNotification(message, collapsed, theme, config).render(100).join("\n");
    assert.match(compact, /process.*command failed.*failed/);
    assert.match(compact, /log: \/tmp\/task.log/);
    assert.doesNotMatch(compact, /│ one/);
    assert.match(compact, /│ two/);
    assert.match(compact, /│ three/);
    assert.match(compact, /1 tail line hidden, expand/);

    const full = renderProcessNotification(message, expanded, theme, config).render(100).join("\n");
    assert.match(full, /│ one/);
    assert.doesNotMatch(full, /hidden, expand/);
  });

  it("renders a monitor batch as one neutral card without inventing an aggregate state", () => {
    const content = "[monitor batch · 2 sources]\n[monitor m1 · completed] first\n[monitor m2 · failed] second";
    const lines = renderProcessNotification({
      content,
      details: { monitorBatch: [{ jobId: "m1" }, { jobId: "m2" }], monitorBatchOverflow: { sourceCount: 4, omittedSources: 2 } },
    }, collapsed, theme, config).render(100);
    const text = lines.join("\n");
    assert.match(text, /monitor.*4 sources.*batch.*2 omitted/);
    assert.match(text, /monitor batch.*2 sources/);
    assert.match(text, /m1.*completed/);
    assert.match(text, /m2.*failed/);
  });

  it("uses the shared bounded plain-text preview for monitor events and removes control sequences", () => {
    const lines = renderProcessNotification({
      content: "[monitor m1 · absent] watch\nlog: /tmp/m1\n\u001b[2Junsafe\nfourth row",
      details: { monitor: { state: "absent", description: "watch" } },
    }, collapsed, theme, config).render(100);
    const text = lines.join("\n");
    assert.match(text, /monitor.*watch.*absent/);
    assert.match(text, /1 more lines, expand/);
    assert.doesNotMatch(text, /\u001b/);
    for (const width of [1, 7, 100]) {
      for (const line of renderProcessNotification({ content: "one\ntwo\nthree\nfour", details: { monitor: { state: "progress", description: "watch" } } }, collapsed, theme, config).render(width)) {
        assert.ok(visibleWidth(line) <= width);
      }
    }
  });

  it("falls back to a safe attention card for malformed details", () => {
    const text = renderProcessNotification({ content: "still delivered", details: { monitor: { state: "bogus" }, monitorBatch: "not an array" } }, collapsed, theme, config)
      .render(100).join("\n");
    assert.match(text, /process.*attention/);
    assert.match(text, /still delivered/);
  });
});
