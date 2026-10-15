import assert from "node:assert/strict";
import { it } from "node:test";
import { cleanText, readRecap, RECAP_PROMPT } from "../output.ts";
import { cleanText as sharedCleanText } from "../../shared/text.ts";
import { reply as response } from "./harness.ts";

it("output is plain single-line bounded Unicode with empty/control rejection and exactly one language instruction", () => {
    assert.equal(cleanText, sharedCleanText);
    assert.equal(readRecap(response("\u001b[31m目标\n状态\t下一步\u001b[0m\u202e")), "目标 状态 下一步");
    const text = readRecap(response("😀".repeat(300))); assert.equal(Array.from(text).length, 240); assert.ok(text.endsWith("…"));
    assert.throws(() => readRecap(response("\u0000 \n\t")), /empty recap/);
    assert.equal(RECAP_PROMPT.match(/Use the user's language, inferred from their messages\./g)?.length, 1);
});
