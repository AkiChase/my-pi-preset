import { AsyncLocalStorage } from "node:async_hooks";

// Pi 1.1.0 loadExtensionsCached clears its factory cache when cwd changes and
// imports a fresh jiti graph (moduleCache: false). A worktree child's loader.reload
// runs inside the root graph's guard, so module-local ALS would miss that scope.
// Share ONLY this async marker across our vendor graphs, not managers or UI state.
const CHILD_CONTEXT_KEY = Symbol.for("my-pi-preset:agent-tasks:child-session-context:v1");
type ChildContextGlobal = typeof globalThis & {
  [CHILD_CONTEXT_KEY]?: AsyncLocalStorage<boolean>;
};

function sharedChildSessionContext(): AsyncLocalStorage<boolean> {
  // The symbol is a deliberately namespaced process capability. Check its value
  // at runtime as well as declaring the typed slot: another graph owns creation.
  const shared = globalThis as ChildContextGlobal;
  const existing = shared[CHILD_CONTEXT_KEY];
  if (existing !== undefined) {
    if (!(existing instanceof AsyncLocalStorage)) {
      throw new TypeError("agent-tasks: invalid shared child-session context");
    }
    return existing;
  }
  const context = new AsyncLocalStorage<boolean>();
  shared[CHILD_CONTEXT_KEY] = context;
  return context;
}

/**
 * Marks resource loading/session construction performed for a subagent. This is
 * async-context-local so concurrent top-level extension work is unaffected.
 * Child shutdown must not disable/delete this process-lifetime marker: other
 * graphs and overlapping child scopes still use it. No runtime lives here.
 */
const childSessionContext = sharedChildSessionContext();

export function inChildSessionContext(): boolean {
  return childSessionContext.getStore() === true;
}

export function runInChildSessionContext<T>(fn: () => Promise<T>): Promise<T> {
  return childSessionContext.run(true, fn);
}
