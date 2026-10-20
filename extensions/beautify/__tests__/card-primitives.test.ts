import assert from "node:assert/strict";
import { test } from "node:test";
import { visibleWidth } from "@earendil-works/pi-tui";
import type { Theme } from "@earendil-works/pi-coding-agent";
import { createCardHeading, textPreview } from "../card-primitives.ts";

const theme = { fg: (_tone: string, text: string) => text } as Theme;

test("card heading keeps marker and statistics when a narrow title must move them below the summary", () => {
  let suppliedWidth = -1;
  const heading = createCardHeading({
    identity: "subagent_run",
    summary: ({ availableWidth }) => {
      suppliedWidth = availableWidth;
      return "Review a very long rendering contract";
    },
    marker: { label: "Running", tone: "accent" },
    statistics: [{ label: "elapsed 12.4s", tone: "muted" }],
    expandHint: "alt+o expand",
    theme,
    context: { expanded: false },
  });

  const narrow = heading.render(24);
  assert.ok(suppliedWidth >= 0);
  assert.ok(narrow.length > 1);
  assert.match(narrow.join("\n"), /Running/);
  assert.match(narrow.join("\n"), /elapsed 12\.4s/);
  assert.doesNotMatch(narrow.join("\n"), /alt\+o/);
  assert.ok(narrow.every(row => visibleWidth(row) <= 24));

  const wide = heading.render(100).join("\n");
  assert.match(wide, /alt\+o expand/);
  assert.match(wide, /Running/);
  assert.match(wide, /elapsed 12\.4s/);
});

test("text preview counts rendered physical rows and preserves complete expanded text", () => {
  const source = "第一段 text ".repeat(24) + "\x1b]0;unsafe\x07";
  const collapsed = textPreview(source, 20, { expanded: false });
  assert.equal(collapsed.rows.length, 3);
  assert.equal(collapsed.hidden, true);
  assert.ok(collapsed.rows.every(row => visibleWidth(row) <= 20));
  assert.ok(collapsed.rows.every(row => !row.includes("\x1b]")));

  const expanded = textPreview(source, 20, { expanded: true });
  assert.ok(expanded.rows.length > 3);
  assert.equal(expanded.hidden, false);
  assert.ok(expanded.rows.every(row => visibleWidth(row) <= 20));
});
