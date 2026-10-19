import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
// Vendored from pi-patty-bg-tasks — see extensions/process-tasks/PROVENANCE.md. It is our code now:
// edit it in place, there is no upstream to merge back from.
import { TaskLifecycle } from "./task-ui/lifecycle.ts";
import { TaskCoordinator } from "./task-ui/coordinator.ts";
import { loadConfig as loadTaskUIConfig } from "./task-ui/config.ts";
import { registerTaskControls } from "./task-ui/controls.ts";
import { registerDownOpener } from "./task-ui/editor.ts";
import { createTaskUIOwner } from "./task-ui/owner.ts";
import { type RuntimeTaskCapability } from "./runtime-tasks/facade.ts";
import { managementTool } from "./runtime-tasks/tools.ts";
import { childManagement, childManagementRegistered } from "./runtime-tasks/child-handoff.ts";
import processTasks from "./process-tasks/index.ts";
import agentTasks, { runInChildSessionContext } from "./agent-tasks/src/index.ts";
import { inChildSessionContext } from "./agent-tasks/src/child-context.ts";
import { registerBackgroundReminder } from "./runtime-tasks/reminder-owner.ts";
// Public child-marker bridge remains valid across host loader graphs and different cwd.
export { runInChildSessionContext };
// Composition owns execution, lifecycle and shared task UI; beautify owns presentation.
export default async function taskComposition(pi: ExtensionAPI): Promise<void> {
  const coordinator = new TaskCoordinator();
  const lifecycle = new TaskLifecycle(coordinator);
  const uiLoad = loadTaskUIConfig();
  const capabilities: RuntimeTaskCapability[] = [];
  const branch = childManagement(coordinator);
  if (branch) capabilities.push(branch);
  processTasks(pi, { coordinator, lifecycle, uiConfig: uiLoad.config, onManagement: capability => capabilities.push(capability) });
  const uiOwner = createTaskUIOwner(pi, coordinator, lifecycle, uiLoad.config);
  const warnings = registerTaskControls(pi, coordinator, uiLoad.config, uiOwner.openPanel);
  for (const warning of [...uiLoad.warnings, ...warnings]) console.error(`[task-ui] config: ${warning}`);
  let reportResult: ((id: string, result: import("./runtime-tasks/contracts.ts").RuntimeTaskResult) => import("./runtime-tasks/contracts.ts").RuntimeTaskResult) | undefined;
  agentTasks(pi, { coordinator, lifecycle, onManagement: capability => capabilities.push(capability), onManagementResult: reporter => { reportResult = reporter; } });
  const process = managementTool("process", capabilities);
  const agent = managementTool("agent", capabilities, (id, result) => reportResult?.(id, result) ?? result);
  lifecycle.onClose(() => { process.close(); agent.close(); reportResult = undefined; });
  pi.registerTool(process.tool);
  pi.registerTool(agent.tool);
  childManagementRegistered(agent.tool);
  // Only the main agent is reminded; child sessions report through their owner.
  if (!inChildSessionContext()) registerBackgroundReminder(pi, { capabilities: () => capabilities, lifecycle, interval: uiLoad.config.backgroundReminderInterval });
  pi.on("session_shutdown", async () => { await lifecycle.shutdown(); });

  registerDownOpener(pi, lifecycle, uiLoad.config.downOpener, uiOwner);
}
