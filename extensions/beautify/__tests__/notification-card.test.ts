import assert from "node:assert/strict";
import { test } from "node:test";
import { stripVTControlCharacters as plain } from "node:util";
import { visibleWidth, type Component } from "@earendil-works/pi-tui";
import { createNotificationCard } from "../notification-card.ts";
import { themeSdk } from "./renderer-host.mjs";

function visible(component: Component, width: number): string[] {
  return component.render(width).map(row => plain(row).trim()).filter(Boolean);
}

test("notification card owns title framing and physical text preview without tool semantics", () => {
  const body = ["first row", "second row", "third row", "fourth row", "fifth row"].join("\n");
  const collapsed = createNotificationCard({
    identity: "subagent_message",
    summary: "explore",
    marker: { label: "notice", tone: "muted" },
    textBody: body,
  }, { expanded: false, outputPad: 2 }, themeSdk.theme);
  const expanded = createNotificationCard({
    identity: "subagent_message",
    summary: "explore",
    marker: { label: "notice", tone: "muted" },
    textBody: body,
  }, { expanded: true, outputPad: 2 }, themeSdk.theme);
  for (const width of [8, 20, 40, 100]) {
    const compact = visible(collapsed, width);
    const full = visible(expanded, width);
    assert.ok([...compact, ...full].every(row => visibleWidth(row) <= width), `physical width ${width}`);
    if (width >= 40) {
      assert.equal(compact.length, 5, "one title, three body rows, and a separate hint");
      assert.match(compact.join("\n"), /first row/);
      assert.doesNotMatch(compact.join("\n"), /fifth row/);
      assert.match(compact.join("\n"), /2 more lines, expand/);
      assert.match(full.join("\n"), /fifth row/);
    }
  }
});

test("notification card preserves producer-owned rich bodies", () => {
  let invalidated = 0;
  const rich: Component = {
    invalidate() { invalidated++; },
    render(width) { return ["rich line one", "rich line two"].map(line => line.slice(0, width)); },
  };
  const card = createNotificationCard({
    identity: "trellis_check",
    marker: { label: "Warnings 1", tone: "warning" },
    body: rich,
  }, { expanded: false, outputPad: 1 }, themeSdk.theme);
  assert.match(visible(card, 80).join("\n"), /rich line two/);
  card.invalidate();
  assert.equal(invalidated, 1);
});
