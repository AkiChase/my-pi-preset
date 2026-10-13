import { CustomEditor } from "@earendil-works/pi-coding-agent";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { createPromptEditorClass } from "@heyhuynhgiabuu/pi-pretty/src/prompt-editor.ts";

type Factory = Parameters<ExtensionContext["ui"]["setEditorComponent"]>[0];
type Args = Parameters<NonNullable<Factory>>;
type Hooks = {
  renderTopBorder(width: number, hidden: number): string;
  renderBottomBorder(width: number, hidden: number): string;
};
type Lease = { dispose(): void };
type Diagnose = (reason: string) => void;
const installed = new WeakMap<CustomEditor, Lease>();

// Only data methods can be shadowed transactionally. Accessor setters may have
// arbitrary side effects, even when their descriptors claim to be configurable.
function canShadow(editor: object, key: string): boolean {
  let owner: object | null = editor;
  while (owner) {
    const descriptor = Object.getOwnPropertyDescriptor(owner, key);
    if (descriptor) {
      return "value" in descriptor && descriptor.writable === true &&
        (owner === editor || Object.isExtensible(editor));
    }
    owner = Object.getPrototypeOf(owner) as object | null;
  }
  return false;
}

/** Keep the real editor, its receiver, subclass, history and editing state. */
export function createDecorator(createPrompt: typeof createPromptEditorClass, diagnose: Diagnose = () => {}) {
  return (editor: CustomEditor, args: Args, color: (text: string) => string): Lease | undefined => {
    const existing = installed.get(editor);
    if (existing) return existing;
    // The protected SDK border hooks are a checked interop seam, not history access.
    const hooks = editor as unknown as Hooks;
    const keys = ["render", "getPaddingX", "setPaddingX", "renderTopBorder", "renderBottomBorder"] as const;
    let originals: Pick<CustomEditor, "render" | "getPaddingX" | "setPaddingX"> & Hooks;
    let originalPadding: number;
    let descriptors: Map<typeof keys[number], PropertyDescriptor | undefined>;
    try {
      if (!editor.embedWorkingStatus || keys.some((key) => typeof Reflect.get(editor, key) !== "function" || !canShadow(editor, key))) {
        diagnose("editor lacks embedded-status/border hooks or writable data methods; keeping its original editing UI");
        return undefined;
      }
      originals = {
        render: editor.render, getPaddingX: editor.getPaddingX, setPaddingX: editor.setPaddingX,
        renderTopBorder: hooks.renderTopBorder, renderBottomBorder: hooks.renderBottomBorder,
      };
      descriptors = new Map(keys.map((key) => [key, Object.getOwnPropertyDescriptor(editor, key)]));
      originalPadding = originals.getPaddingX.call(editor);
      if (!Number.isFinite(originalPadding)) throw new Error("invalid editor padding");
    } catch (error) {
      diagnose(`editor preflight failed without mutation: ${String(error)}`);
      return undefined;
    }
    let ownedPadding = originalPadding;
    let active = true;
    const restoreMethod = (key: typeof keys[number]) => {
      const descriptor = descriptors.get(key);
      if (descriptor) Object.defineProperty(editor, key, descriptor);
      else if (!Reflect.deleteProperty(editor, key)) throw new Error(`cannot remove ${key}`);
    };
    // Pretty owns only visual state on this bridge. Its real render implementation
    // calls the original editor's render/hooks; no prototype swap or render copy.
    class RenderBridge extends CustomEditor {
      override render(width: number) { return originals.render.call(editor, width); }
      override getPaddingX() { return originals.getPaddingX.call(editor); }
      override setPaddingX(padding: number) {
        originals.setPaddingX.call(editor, padding);
        ownedPadding = originals.getPaddingX.call(editor);
      }
      protected override renderTopBorder(width: number, hidden: number) {
        return originals.renderTopBorder.call(editor, width, hidden);
      }
      protected override renderBottomBorder(width: number, hidden: number) {
        return originals.renderBottomBorder.call(editor, width, hidden);
      }
    }
    const changed: typeof keys[number][] = [];
    try {
      const Prompt = createPrompt(RenderBridge, color);
      let adapter: CustomEditor | undefined = new Prompt(...args);
      const replacements = {
        render(width: number) {
          if (!active || !adapter) return originals.render.call(editor, width);
          adapter.borderColor = editor.borderColor;
          return adapter.render(width);
        },
        getPaddingX() { return active && adapter ? adapter.getPaddingX() : originals.getPaddingX.call(editor); },
        setPaddingX(padding: number) {
          if (active && adapter) adapter.setPaddingX(padding);
          else originals.setPaddingX.call(editor, padding);
        },
        renderTopBorder(width: number, hidden: number) {
          return active && adapter ? (adapter as unknown as Hooks).renderTopBorder(width, hidden) : originals.renderTopBorder.call(editor, width, hidden);
        },
        renderBottomBorder(width: number, hidden: number) {
          return active && adapter ? (adapter as unknown as Hooks).renderBottomBorder(width, hidden) : originals.renderBottomBorder.call(editor, width, hidden);
        },
      };
      for (const key of keys) {
        changed.push(key); // A Proxy can mutate the property and then throw.
        if (!Reflect.set(editor, key, replacements[key])) throw new Error(`cannot install ${key}`);
      }
      const lease = {
        dispose() {
          if (!active) return;
          // A later setter OR a direct underlying padding update relinquishes ownership.
          let restorePadding = false;
          const userPadding = adapter!.getPaddingX();
          try {
            restorePadding = editor.setPaddingX === replacements.setPaddingX &&
              editor.getPaddingX === replacements.getPaddingX &&
              originals.getPaddingX.call(editor) === ownedPadding;
          } catch (error) { diagnose(`padding ownership check failed: ${String(error)}`); }
          active = false;
          adapter = undefined; // Captured later wrappers must not retain Pretty render state.
          for (const key of keys) {
            try {
              if (Reflect.get(editor, key) === replacements[key]) restoreMethod(key);
            } catch (error) { diagnose(`cannot restore ${key}; retaining inactive wrapper: ${String(error)}`); }
          }
          if (restorePadding) {
            try { originals.setPaddingX.call(editor, userPadding); }
            catch (error) { diagnose(`padding restore failed: ${String(error)}`); }
          }
          installed.delete(editor);
        },
      };
      installed.set(editor, lease);
      return lease;
    } catch (error) {
      active = false;
      for (const key of changed.reverse()) {
        try { restoreMethod(key); } catch (rollback) { diagnose(`method rollback failed: ${String(rollback)}`); }
      }
      try { originals.setPaddingX.call(editor, originalPadding); }
      catch (rollback) { diagnose(`padding rollback failed: ${String(rollback)}`); }
      diagnose(`decoration failed and was rolled back: ${String(error)}`);
      return undefined;
    }
  };
}

type Slot = { previous: Factory; factory: NonNullable<Factory>; deactivate(): void };
// Flatten our own retired factories. Opaque wrappers belonging to other plugins
// remain untouched; they delegate through a deactivated, resource-free factory.
const retired = new WeakMap<NonNullable<Factory>, { previous: Factory }>();
function unwrap(factory: Factory): Factory {
  while (factory && retired.has(factory)) factory = retired.get(factory)!.previous;
  return factory;
}

// Defined outside the lifecycle Proxy: an opaque later wrapper may keep this
// function forever, but retirement drops the only UI/context/render builder.
function createSlot(previous: Factory, build: ((...args: Args) => {
  editor: ReturnType<NonNullable<Factory>>; lease?: Lease;
}) | undefined): Slot {
  let lease: Lease | undefined;
  const current: Slot = {
    previous,
    factory: (...args: Args) => {
      if (!build) return previous?.(...args) ?? new CustomEditor(...args, { embedWorkingStatus: true });
      // There is one host-owned live editor, not an accumulating Set of leases.
      lease?.dispose();
      lease = undefined;
      const result = build(...args);
      lease = result.lease;
      return result.editor;
    },
    deactivate() {
      if (!build) return;
      build = undefined;
      lease?.dispose();
      lease = undefined;
      retired.set(current.factory, { previous });
    },
  };
  return current;
}

/** Local UI boundary used only by Pretty's start/shutdown handlers. */
export function adaptPrettyLifecycle(pi: ExtensionAPI, createPrompt: typeof createPromptEditorClass): ExtensionAPI {
  let slot: Slot | undefined;
  return new Proxy(pi, {
    get(target, property) {
      if (property !== "on") {
        const value: unknown = Reflect.get(target, property, target);
        return typeof value === "function" ? value.bind(target) : value;
      }
      // SDK overload correlations cannot be represented while forwarding event
      // names through a Proxy. Only the two known Pretty lifecycle events change.
      const register = target.on.bind(target) as unknown as
        (event: string, handler: (event: unknown, ctx: ExtensionContext) => void | Promise<void>) => unknown;
      return (event: string, handler: (event: unknown, ctx: ExtensionContext) => void | Promise<void>) => {
        if (event !== "session_start" && event !== "session_shutdown") return register(event, handler);
        register(event, async (payload, ctx) => {
          const diagnose: Diagnose = (reason) => {
            try { ctx?.ui.notify(`preset Pretty editor fallback: ${reason}`, "warning"); }
            catch { /* Diagnostics must not break editing or shutdown. */ }
          };
          const release = () => {
            const current = slot;
            slot = undefined;
            if (!current) return;
            current.deactivate();
            // /reload resets UI BEFORE old-runner shutdown. Never reinstall stale
            // factories after that reset, or overwrite a later plugin's factory.
            if (ctx?.ui.getEditorComponent?.() !== current.factory) return;
            try { ctx.ui.setEditorComponent(current.previous); }
            catch (error) {
              diagnose(`factory restore failed: ${String(error)}`);
              try { ctx.ui.setEditorComponent(undefined); } catch (fallback) { diagnose(`host reset failed: ${String(fallback)}`); }
            }
          };
          if (!ctx) {
            try { await handler(payload, ctx); } finally { if (event === "session_shutdown") release(); }
            return;
          }
          const ui = new Proxy(ctx.ui, {
            get(hostUi, key) {
              if (key === "setEditorComponent") return (prettyFactory: Factory) => {
                if (event === "session_shutdown") { release(); return; }
                if (slot || !prettyFactory) return;
                if (typeof hostUi.getEditorComponent !== "function" || typeof hostUi.setEditorComponent !== "function") {
                  diagnose("host lacks editor factory get/set API; keeping existing editor");
                  return;
                }
                const previous = unwrap(hostUi.getEditorComponent());
                const decorate = createDecorator(createPrompt, diagnose);
                const current = createSlot(previous, (...args: Args) => {
                  const editor = previous?.(...args) ?? prettyFactory(...args);
                  const lease = previous ? decorate(editor as CustomEditor, args, (icon) => {
                    const theme = hostUi.theme;
                    return typeof theme.getThinkingBorderColor === "function"
                      ? theme.getThinkingBorderColor(ctx.thinkingLevel ?? "off")(icon)
                      : theme.fg("thinkingText", icon);
                  }) : undefined;
                  return { editor, lease };
                });
                // SDK sets factory and clears editorContainer BEFORE invoking the
                // factory and wiring callbacks/padding/autocomplete. Recovery MUST
                // traverse that same setter to rebuild the container and focus.
                try {
                  hostUi.setEditorComponent(current.factory);
                  slot = current; // Commit only after ALL host wiring succeeds.
                } catch (error) {
                  current.deactivate();
                  diagnose(`host installation failed; restoring previous factory: ${String(error)}`);
                  try { hostUi.setEditorComponent(previous); }
                  catch (rollback) {
                    diagnose(`previous factory failed; restoring default editor: ${String(rollback)}`);
                    try { hostUi.setEditorComponent(undefined); } catch (fallback) { diagnose(`host reset failed: ${String(fallback)}`); }
                  }
                }
              };
              const value: unknown = Reflect.get(hostUi, key, hostUi);
              return typeof value === "function" ? value.bind(hostUi) : value;
            },
          });
          try {
            await handler(payload, new Proxy(ctx, {
              get(context, key) { return key === "ui" ? ui : Reflect.get(context, key, context); },
            }));
          } finally {
            if (event === "session_shutdown") release();
          }
        });
      };
    },
  });
}
