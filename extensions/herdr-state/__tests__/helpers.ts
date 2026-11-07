import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { ProgramStatus, Terminal, TUI } from "@earendil-works/pi-tui";

type Handler = (event: unknown, context: ExtensionContext) => unknown;
export function fakePi(onSubscribe?: (channel: string) => void) {
  const lifecycle = new Map<string, Set<Handler>>();
  const bus = new Map<string, Set<(data: unknown) => void>>();
  const pi = {
    on(event: string, handler: Handler) {
      const handlers = lifecycle.get(event) ?? new Set<Handler>();
      lifecycle.set(event, handlers);
      handlers.add(handler);
      return () => { handlers.delete(handler); };
    },
    events: {
      on(channel: string, handler: (data: unknown) => void) {
        onSubscribe?.(channel);
        const handlers = bus.get(channel) ?? new Set<(data: unknown) => void>();
        bus.set(channel, handlers);
        handlers.add(handler);
        return () => { handlers.delete(handler); };
      },
    },
  };
  return {
    pi: pi as unknown as ExtensionAPI,
    async fire(event: string, context: ExtensionContext) {
      for (const handler of [...(lifecycle.get(event) ?? [])]) await handler({}, context);
    },
    fireSync(event: string, context: ExtensionContext) {
      for (const handler of [...(lifecycle.get(event) ?? [])]) handler({}, context);
    },
    emit(channel: string, data: unknown) {
      for (const handler of [...(bus.get(channel) ?? [])]) handler(data);
    },
    subscribers() { return [...bus.values()].reduce((sum, handlers) => sum + handlers.size, 0); },
    registrations() { return [...lifecycle.values()].reduce((sum, handlers) => sum + handlers.size, 0); },
  };
}

export function recordingTerminal() {
  const calls: ProgramStatus[] = [];
  const receivers: unknown[] = [];
  const terminal: Pick<Terminal, "setProgramStatus"> = {
    setProgramStatus(status) { receivers.push(this); calls.push(status); },
  };
  return { terminal, calls, receivers };
}

export function captureContext(terminal: Pick<Terminal, "setProgramStatus">, options: {
  mode?: ExtensionContext["mode"];
  gate?: Promise<void>;
  fail?: boolean;
} = {}) {
  let captures = 0;
  let completions = 0;
  const context = {
    mode: options.mode ?? "tui",
    ui: {
      async custom(factory: (screen: TUI, theme: unknown, keys: unknown, done: () => void) => unknown) {
        captures += 1;
        if (options.gate) await options.gate;
        if (options.fail) throw new Error("capture unavailable");
        factory({ terminal } as TUI, undefined, undefined, () => { completions += 1; });
      },
    },
  } as unknown as ExtensionContext;
  return { context, captures: () => captures, completions: () => completions };
}
