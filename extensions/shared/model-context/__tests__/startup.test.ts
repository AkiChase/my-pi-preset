import assert from "node:assert/strict";
import { it } from "node:test";
import type { SessionEntry } from "@earendil-works/pi-coding-agent";
import { hasStartup, startupDetails } from "../startup.ts";

const owner = "fixture", origin = "stable-source", customType = "fixture-startup";
const entry = (details: unknown, type: "custom_message" | "custom" = "custom_message"): SessionEntry => ({ type, id: "one", parentId: null, timestamp: "2026-10-15T00:00:00.000Z", customType,
  ...(type === "custom_message" ? { content: "snapshot", display: false, details } : { data: details }) } as SessionEntry);

it("composite details recognize startup parts without interpreting owner state or authorizing anything", () => {
  const details = { ...startupDetails(owner, origin, ["overview", "workflow"]), state: { task: "planning" } };
  for (const part of ["overview", "workflow"]) assert.equal(hasStartup([entry(details)], customType, owner, origin, part), true);
  assert.equal(hasStartup([entry(details)], customType, owner, origin, "other"), false);
  assert.equal(hasStartup([entry(details)], customType, owner, "other-source", "overview"), false);
  assert.equal(hasStartup([entry(details)], "other-type", owner, origin, "overview"), false);
  assert.equal(hasStartup([entry(details)], customType, "other-owner", origin, "overview"), false);
  assert.equal(hasStartup([], customType, owner, origin, "overview"), false, "draft creation is not confirmation");
});

it("skip and unavailable records count as handled only with supported complete metadata", () => {
  for (const outcome of ["provided", "skipped", "unavailable"] as const) {
    assert.equal(hasStartup([entry(startupDetails(owner, origin, ["index"], outcome), outcome === "skipped" ? "custom" : "custom_message")], customType, owner, origin, "index"), true);
  }
  for (const malformed of [null, {}, { startup: null }, { startup: { ...startupDetails(owner, origin, ["index"]).startup, version: 2 } },
    { startup: { ...startupDetails(owner, origin, ["index"]).startup, parts: ["index", 3] } },
    { startup: { ...startupDetails(owner, origin, ["index"]).startup, outcome: "pending" } }]) {
    assert.equal(hasStartup([entry(malformed)], customType, owner, origin, "index"), false);
  }
});

it("legacy recognition is owner supplied and applies only to entries in the selected branch", () => {
  const legacy = entry(undefined);
  assert.equal(hasStartup([legacy], customType, owner, origin, "index", value => value.id === "one"), true);
  assert.equal(hasStartup([], customType, owner, origin, "index", value => value.id === "one"), false);
});
