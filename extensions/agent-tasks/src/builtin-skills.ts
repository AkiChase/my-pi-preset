import { fileURLToPath } from "node:url";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

/** Plugin-owned manual, located from the installed module rather than session cwd. */
export function registerBuiltinSkills(pi: ExtensionAPI): void {
  const skillPath = fileURLToPath(new URL("../skills/subagents/SKILL.md", import.meta.url));
  // Extension-added resources intentionally do not follow ordinary skill filters.
  // Register in children too, but never create another execution manager here.
  pi.on("resources_discover", () => ({ skillPaths: [skillPath] }));
}
