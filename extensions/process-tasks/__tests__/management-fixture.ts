import { registerManagementTool } from "../../runtime-tasks/tools.ts";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { createProcessManagement } from "../management.ts";
import { createProcessTaskSource } from "../source.ts";
import type { BackgroundRegistry } from "../state.ts";
export function registerManagementFixture(pi: ExtensionAPI, reg: BackgroundRegistry) {
  const source = createProcessTaskSource(reg);
  const registered = registerManagementTool(pi, "process", [createProcessManagement(reg, source)]);
  return () => { registered.close(); source.dispose(); };
}
