// Native node:test only: transform non-erasable vendor TS in memory, without dist.
// Production continues to use Pi's jiti loader. Keep this hook scoped to our fork.
import { registerHooks, stripTypeScriptTypes } from "node:module";

const workflowControlKey = Symbol.for("my-pi-preset:test:workflow-control");
export function observeWorkflowControl(listener) {
  if (globalThis[workflowControlKey]) throw new Error("Workflow control observer already installed");
  globalThis[workflowControlKey] = listener;
  return () => { delete globalThis[workflowControlKey]; };
}
const vendorRoot = new URL("../src/", import.meta.url).href;
registerHooks({
  load(url, context, nextLoad) {
    const result = nextLoad(url, context);
    if (!url.startsWith(vendorRoot) || !url.endsWith(".ts")) return result;
    let source = String(result.source);
    if (url === new URL("index.ts", vendorRoot).href) {
      const boundary = "task.control = control; manager.notifyChanged();";
      if (!source.includes(boundary)) throw new Error("Workflow control test boundary changed");
      source = source.replace(boundary, `task.control = control; globalThis[Symbol.for("my-pi-preset:test:workflow-control")]?.(task); manager.notifyChanged();`);
    }
    return {
      ...result,
      format: "module",
      source: stripTypeScriptTypes(source, { mode: "transform", sourceUrl: url }),
    };
  },
});
