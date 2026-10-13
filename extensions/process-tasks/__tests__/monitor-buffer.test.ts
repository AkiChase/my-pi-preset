import { test } from "node:test";
import assert from "node:assert/strict";
import { MonitorBuffer, previewText } from "../monitor-buffer.ts";
import { MonitorLineDecoder } from "../monitor-source.ts";

test("AC12/15: bounded prefix, exact whole/truncated omission counts survive rebatching", () => {
    const source = new MonitorBuffer(2, 5); source.addText("abcdef\nother\nlast");
    const preview = source.take(); assert.deepEqual(preview.lines, [{ text: "abcde", omittedChars: 1 }]);
    assert.equal(preview.omittedLines, 2); assert.equal(preview.omittedChars, 10); assert.equal(preview.truncatedLines, 1);
    const pending = new MonitorBuffer(2, 5); pending.add(preview);
    assert.deepEqual(pending.take(), preview); assert.equal(pending.hasContent, false);
    assert.match(previewText(preview), /2 whole lines, 10 characters; 1 truncated lines/);
});
test("AC12/15: characters include newlines; empty lines capped; surrogate pairs not split", () => {
    const b = new MonitorBuffer(3, 4); b.addText("😀x\ny"); const p = b.take();
    assert.equal(p.lines.map(l => l.text).join("\n").length, 3);
    const unicode = new MonitorBuffer(1, 1); unicode.addLine("😀");
    assert.equal(unicode.take().lines[0]!.text, "");
    const empty = new MonitorBuffer(2, 10); empty.addText("\n".repeat(100000));
    const e = empty.take(); assert.equal(e.lines.length, 2); assert.equal(e.omittedLines, 99998);
});
test("AC4/12/19: independent UTF-8 decoders and bounded partials only produce activity at newline", () => {
    const a = new MonitorLineDecoder({ maxLines: 2, maxChars: 5 });
    const b = new MonitorLineDecoder({ maxLines: 2, maxChars: 5 });
    const bytes = Buffer.from("😀");
    assert.equal(a.feed(bytes.subarray(0, 2)).activity, false);
    assert.equal(b.feed(Buffer.from("ERR")).activity, false);
    const done = a.feed(Buffer.concat([bytes.subarray(2), Buffer.from("\n")]));
    assert.equal(previewText(done.preview), "😀"); assert.equal(done.activity, true);
    assert.equal(previewText(b.feed(Buffer.from("OR\n")).preview), "ERROR");
    a.feed(Buffer.from("x".repeat(100000))); const final = a.finish();
    assert.equal(final.preview.lines[0]!.text.length, 5); assert.equal(final.preview.omittedChars, 99995);
    const incomplete = new MonitorLineDecoder({ maxLines: 2, maxChars: 5 });
    incomplete.feed(bytes.subarray(0, 2)); assert.equal(incomplete.finish().incomplete, true);
});

test("AC12/15: once a prefix is truncated, later small lines/fragments cannot fill its gap", () => {
    const b = new MonitorBuffer(3, 3); b.addText("xx😀\na"); const p = b.take();
    assert.deepEqual(p.lines, [{ text: "xx", omittedChars: 2 }]); assert.equal(p.omittedLines, 1);
    const decoder = new MonitorLineDecoder({ maxLines: 3, maxChars: 3 });
    decoder.feed(Buffer.from("xx😀")); const line = decoder.feed(Buffer.from("a\n")).preview;
    assert.deepEqual(line.lines, [{ text: "xx", omittedChars: 3 }]);
});

test("AC12: empty WS preview plus Unicode at zero budget matches direct prefix and omission counts", () => {
    const text = "x".repeat(198) + "\n😀";
    const direct = new MonitorBuffer(50, 200);
    direct.addText(""); direct.addText(text);
    const expected = direct.take();
    assert.deepEqual(expected.lines, [{ text: "", omittedChars: 0 }, { text: "x".repeat(198), omittedChars: 0 }]);
    assert.equal(expected.omittedLines, 1); assert.equal(expected.omittedChars, 2); assert.equal(expected.truncatedLines, 0);
    const pending = new MonitorBuffer(50, 200);
    for (const message of ["", text]) {
        const source = new MonitorBuffer(50, 200); source.addText(message); pending.add(source.take());
    }
    assert.deepEqual(pending.take(), expected);

    // Source truncation remains a truncated line when its prefix fits the batch.
    const source = new MonitorBuffer(50, 200); source.addText("x".repeat(199) + "😀");
    const preview = source.take(); const merged = new MonitorBuffer(50, 200); merged.add(preview);
    assert.equal(preview.truncatedLines, 1); assert.equal(preview.omittedChars, 2);
    assert.deepEqual(merged.take(), preview);
});
