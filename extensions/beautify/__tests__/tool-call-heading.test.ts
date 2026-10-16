import { test } from "node:test";
import assert from "node:assert/strict";
import { createToolCallHeading } from "../tool-call-heading.ts";
import { visibleWidth } from "@earendil-works/pi-tui";
import type { Theme } from "@earendil-works/pi-coding-agent";
const theme = { fg: (_: string, t: string) => t } as Theme;
test("public heading preserves tool identity, bounds Unicode and sanitizes detail without extension activation", () => {
  for (const expanded of [false, true]) for (const width of [1, 8, 12, 40, 100]) {
    const heading = createToolCallHeading({ name: "subagent_run", detail: "Explore · 检查接口\x1b]0;bad\x07", theme, context: { expanded } });
    const rows = heading.render(width);
    assert.ok(rows.every(row => visibleWidth(row) <= width));
    if (width >= 12) assert.ok(rows[0]!.startsWith("subagent_run"));
    assert.ok(rows.every(row => !row.includes("\x1b]")));
  }
});
