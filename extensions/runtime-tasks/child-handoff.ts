import { AsyncLocalStorage } from "node:async_hooks";
import type { RuntimeTaskCapability } from "./facade.ts";
import type { TaskCoordinator } from "../task-ui/coordinator.ts";
import type { ToolDefinition } from "@earendil-works/pi-coding-agent";

export type ChildManagementFactory = (coordinator: TaskCoordinator) => RuntimeTaskCapability;
const KEY = Symbol.for("my-pi-preset:runtime-tasks:child-capability:v1");
type Admission = { factory?: ChildManagementFactory; registered?: (tool: ToolDefinition) => void };
type Shared = typeof globalThis & { [KEY]?: AsyncLocalStorage<Admission> };
const shared = globalThis as Shared;
if (shared[KEY] !== undefined && !(shared[KEY] instanceof AsyncLocalStorage)) throw new TypeError("Invalid child management scope");
const scope = shared[KEY] ??= new AsyncLocalStorage<Admission>();
/** Only a branch-scoped finite builder is shared during resource loading, never a root registry. */
export async function withChildManagement<T>(factory: ChildManagementFactory | undefined, fn: () => Promise<T>, registered?: (tool: ToolDefinition) => void): Promise<T> {
  const admission = { factory, registered };
  // Async descendants inherit the store, so revoke its reference when loading ends.
  // An absent factory must also mask an outer branch rather than inherit it.
  try { return await scope.run(admission, fn); }
  finally { admission.factory = undefined; admission.registered = undefined; }
}
export function childManagementRegistered(tool: ToolDefinition): void {
  scope.getStore()?.registered?.(tool);
}
export function childManagement(coordinator: TaskCoordinator): RuntimeTaskCapability | undefined {
  return scope.getStore()?.factory?.(coordinator);
}
