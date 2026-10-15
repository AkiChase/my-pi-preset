import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { createRuntimeTaskFacade, registerRuntimeTaskTool } from "../../runtime-tasks/facade.ts";
import { createProcessManagement } from "../management.ts";
import { createProcessTaskSource } from "../source.ts";
import type { BackgroundRegistry } from "../state.ts";
export function registerManagementFixture(pi: ExtensionAPI, reg: BackgroundRegistry) {
  const source = createProcessTaskSource(reg);
  const facade = createRuntimeTaskFacade([createProcessManagement(reg, source)]);
  registerRuntimeTaskTool(pi, facade);
  return () => { facade.close(); source.dispose(); };
}
