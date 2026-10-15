import assert from "node:assert/strict";
import { it } from "node:test";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { branchIdentity } from "../context.ts";

it("actual SDK branch identity ignores context-neutral metadata but follows messages and navigation", () => {
    const sm = SessionManager.inMemory();
    const first = sm.appendMessage({ role: "user", content: "用户目标", timestamp: 1 });
    const identity = branchIdentity(sm);
    sm.appendCustomEntry("metadata", { count: 1 });
    sm.appendSessionInfo("title");
    sm.appendLabelChange(first, "label");
    assert.equal(branchIdentity(sm), identity);
    sm.appendMessage({ role: "user", content: "next", timestamp: 2 });
    const next = branchIdentity(sm);
    assert.notEqual(next, identity);
    sm.branch(first);
    assert.equal(branchIdentity(sm), identity);
});
