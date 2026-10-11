import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

// Normalizes SSE response bodies before pi's provider parsers see them.
//
// pi 1.1.0's Anthropic SSE splitter treats a lone "\r" at a network chunk boundary as a
// line end, so a CRLF split across two chunks turns the "\n" into a blank line and
// flushes an `event:` frame with no data -> "Could not parse Anthropic SSE event ...:
// Unexpected end of JSON input; data=". Relays that cut a stream mid-frame produce the
// same data-less frame, and that error is not auto-retried.
//
// This rewrites every text/event-stream body to LF line endings (holding a trailing "\r"
// until the next byte) and drops frames that carry no `data:` line, which the SSE spec
// says must not be dispatched anyway. A truncated stream then surfaces as pi's retryable
// "Anthropic stream ended before message_stop" instead.

const ORIGINAL_FETCH = Symbol.for("my-pi-preset.sse-normalize.originalFetch");

type PatchedGlobal = typeof globalThis & { [ORIGINAL_FETCH]?: typeof fetch };

export function createSseNormalizer(): TransformStream<Uint8Array, Uint8Array> {
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();
  let buffer = "";
  let frame: string[] = [];
  let hasData = false;

  const takeLines = (final: boolean): string[] => {
    const lines: string[] = [];
    let start = 0;
    for (let i = 0; i < buffer.length; i++) {
      const char = buffer[i];
      if (char !== "\r" && char !== "\n") continue;
      // A trailing "\r" may be the first half of a CRLF split across chunks.
      if (char === "\r" && i === buffer.length - 1 && !final) break;
      lines.push(buffer.slice(start, i));
      if (char === "\r" && buffer[i + 1] === "\n") i++;
      start = i + 1;
    }
    buffer = buffer.slice(start);
    return lines;
  };

  const flushFrame = (): string => {
    const out = hasData ? `${frame.join("\n")}\n\n` : "";
    frame = [];
    hasData = false;
    return out;
  };

  const processLines = (lines: string[]): string => {
    let out = "";
    for (const line of lines) {
      if (line === "") {
        out += flushFrame();
        continue;
      }
      frame.push(line);
      if (line === "data" || line.startsWith("data:")) hasData = true;
    }
    return out;
  };

  return new TransformStream({
    transform(chunk, controller) {
      buffer += decoder.decode(chunk, { stream: true });
      const out = processLines(takeLines(false));
      if (out) controller.enqueue(encoder.encode(out));
    },
    flush(controller) {
      buffer += decoder.decode();
      let out = processLines(takeLines(true));
      if (buffer) out += processLines([buffer]);
      buffer = "";
      out += flushFrame();
      if (out) controller.enqueue(encoder.encode(out));
    },
  });
}

function isEventStream(response: Response): boolean {
  return (response.headers.get("content-type") ?? "").toLowerCase().includes("text/event-stream");
}

export default function (_pi: ExtensionAPI) {
  const g = globalThis as PatchedGlobal;
  // Keep the first original across /reload so the wrapper never wraps itself.
  const original = (g[ORIGINAL_FETCH] ??= g.fetch);

  g.fetch = async (input, init) => {
    const response = await original(input, init);
    if (!response.body || !isEventStream(response)) return response;
    return new Response(response.body.pipeThrough(createSseNormalizer()), {
      status: response.status,
      statusText: response.statusText,
      headers: response.headers,
    });
  };
}
