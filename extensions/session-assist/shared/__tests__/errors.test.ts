import assert from "node:assert/strict";
import { it } from "node:test";
import { failureDetail } from "../errors.ts";

it("keeps ordinary provider details, removes controls and does not serialize objects", () => {
    assert.equal(failureDetail(new Error("Provider rejects reasoning=none")), "Provider rejects reasoning=none");
    assert.equal(failureDetail(new Error("\u001b[31mBad\u001b[0m\nrequest\u202e")), "Bad request");
    assert.equal(failureDetail({ headers: { authorization: "private" }, message: "private object" }), "Request failed without error details");
    assert.equal(failureDetail(new Error("   ")), "Request failed without error details");
});
it("normalizes decoded escaped keys and removes decoded stack frames before reencoding", () => {
    const input = JSON.stringify({ message: "Invalid key", ['api\u001b[31m_key\u001b[0m']: "private-key", ['head\u0000ers']: { trace: "private-header" } });
    const detail = failureDetail(new Error(input));
    assert.match(detail, /Invalid key/);
    for (const value of ["private-key", "private-header"]) assert.equal(detail.includes(value), false, detail);
    const stack = failureDetail(new Error(JSON.stringify({ error: { message: "Provider unavailable\n    at provider (private-stack-path:1:2)", code: "provider_error" } })));
    assert.match(stack, /Provider unavailable/); assert.match(stack, /provider_error/);
    assert.equal(stack.includes("private-stack-path"), false);
    const colored = failureDetail(new Error(JSON.stringify({ error: {
        message: "Provider unavailable\n    \u001b[31mat provider (private-colored-stack:1:2)\u001b[0m", code: "provider_error",
    } })));
    assert.match(colored, /Provider unavailable/); assert.match(colored, /provider_error/);
    assert.equal(colored.includes("private-colored-stack"), false);
});
it("sanitizes decoded JSON message and nested error.message without losing reason/code", () => {
    const message = 'Unsupported reasoning api_key="private-embedded-key" headers={"trace":"private-header"} payload={"messages":["private-body"]} stack="private-stack"';
    for (const data of [{ message, code: "invalid_reasoning" }, { error: { message, code: "invalid_reasoning" } },
        { message: 'Bad request x-api-key: private-key', code: "invalid_reasoning" },
        { error: { message: 'Invalid key api\u001b[31m_key="private-key"', code: "invalid_reasoning" } }]) {
        const detail = failureDetail(new Error(JSON.stringify(data)));
        for (const value of ["private-embedded-key", "private-header", "private-body", "private-stack", "private-key"]) assert.equal(detail.includes(value), false, detail);
        assert.match(detail, /Unsupported reasoning|Bad request|Invalid key/);
        assert.match(detail, /invalid_reasoning/);
        assert.doesNotThrow(() => JSON.parse(detail));
    }
});
it("normalizes decorated credentials before scanning and covers canonical API-key headers", () => {
    for (const raw of [
        "401 X-Api-Key: private-header",
        '{"message":"Invalid key","x-api-key":"private-header"}',
        '401 api\u001b[31m_key\u001b[0m="private-control"',
        '401 api_key\u0000="private-control"',
        "403 Co\u001b[31mokie\u001b[0m: session=private-cookie",
    ]) {
        const detail = failureDetail(new Error(raw));
        for (const value of ["private-header", "private-control", "private-cookie"]) assert.equal(detail.includes(value), false, detail);
        assert.match(detail, /\[redacted\]/);
    }
});
it("preserves Bad request prose and JSON message/code without scanning inside quoted values", () => {
    for (const reason of ["Bad request: Unsupported reasoning level high", "Invalid request: context length exceeded", "Invalid request: Missing required parameter model"]) {
        assert.equal(failureDetail(new Error(reason)), reason);
        const json = JSON.stringify({ message: reason, code: "invalid_request" });
        assert.equal(failureDetail(new Error(json)), json);
    }
});
it("removes complete Basic/Cookie and escaped credential values", () => {
    for (const raw of [
        "401 invalid Authorization: Basic dXNlcjpwYXNz",
        "403 rejected; Cookie: session=private-cookie; token=private-tail",
        '401: {"message":"Invalid key","api_key":"abc\\\"private-tail"}',
        '401: {"message":"Invalid key","api_key":"abc\\\\private-tail"}',
        '401: {"message":"Invalid key","api\\u005fkey":"private-tail"}',
        "401 invalid Proxy-Authorization: Basic private-tail",
        "403 Set-Cookie: private-tail; HttpOnly",
    ]) {
        const detail = failureDetail(new Error(raw));
        for (const value of ["dXNlcjpwYXNz", "private-cookie", "private-tail"]) assert.equal(detail.includes(value), false, detail);
        assert.match(detail, /401|403/);
        assert.match(detail, /\[redacted\]/);
    }
});
it("removes serialized nested diagnostics while preserving readable message/code", () => {
    const input = '401: {"message":"Unsupported reasoning","code":"invalid_reasoning","headers":{"x-trace":"trace-private"},"payload":{"messages":[{"content":"body-private"}]},"stack":"Error at path-private"}';
    const detail = failureDetail(new Error(input));
    assert.match(detail, /Unsupported reasoning/); assert.match(detail, /invalid_reasoning/);
    for (const value of ["trace-private", "body-private", "path-private"]) assert.equal(detail.includes(value), false);
    assert.equal(failureDetail(new Error("Rejected\n    at provider-private (/private/path:1)")), "Rejected");
    assert.equal(failureDetail(new Error('Rejected payload={"content":"private-tail"')), "Rejected payload=[redacted]");
});
it("redacts credentials without hiding the ordinary cause and bounds Unicode output", () => {
    const message = failureDetail(new Error('Invalid credential Bearer abc.DEF-123 api_key="hidden-key" password=hidden-pass sk-1234567890 https://user:pass@example.invalid/path'));
    assert.match(message, /Invalid credential/);
    for (const secret of ["abc.DEF-123", "hidden-key", "hidden-pass", "sk-1234567890", "user:pass"]) assert.equal(message.includes(secret), false);
    assert.match(message, /\[redacted\]/);
    const long = failureDetail(new Error("😃".repeat(600)));
    assert.ok(Array.from(long).length <= 500);
    assert.match(long, /\[truncated\]$/);
});
