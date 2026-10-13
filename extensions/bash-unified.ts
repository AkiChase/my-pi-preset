import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import * as hostSdk from "@earendil-works/pi-coding-agent";
// Vendored from pi-patty-bg-tasks — see extensions/process-tasks/PROVENANCE.md. It is our code now:
// edit it in place, there is no upstream to merge back from.
import { TaskLifecycle } from "./task-ui/lifecycle.ts";
import { TaskCoordinator } from "./task-ui/coordinator.ts";
import { loadConfig as loadTaskUIConfig } from "./task-ui/config.ts";
import { registerTaskControls } from "./task-ui/controls.ts";
import { registerDownOpener } from "./task-ui/editor.ts";
import { createTaskUIOwner } from "./task-ui/owner.ts";
import processTasks from "./process-tasks/index.ts";
import agentTasks, { runInChildSessionContext } from "./agent-tasks/src/index.ts";
// Public child-marker bridge remains valid across host loader graphs and different cwd.
export { runInChildSessionContext };
// Deep import of `src`, not the package root: pretty's `pi.extensions` manifest points at
// `./src/index.ts`, so this is the entry pi itself loads, and its `dist` build can lag.
// There is no `exports` field blocking the subpath today; if upstream adds one, this throws
// loudly at load time rather than silently degrading.
import pretty from "@heyhuynhgiabuu/pi-pretty/src/index.ts";
import { createPromptEditorClass } from "@heyhuynhgiabuu/pi-pretty/src/prompt-editor.ts";
import { adaptPrettyLifecycle } from "./pretty-compat/editor.ts";

// Composition owner for process-tasks, agent-tasks and pi-pretty.
// Shared waits, sources, panel and footer are composition-owned.
//
// Process-tasks and pretty both register `bash`; capture execution from the backend
// and inject it into pretty so there is exactly one final registration. Agent-tasks
// guards child-session initialization itself; process/pretty still load in children.
// Do not also install the standalone upstream packages listed in preset conflicts.

type ToolDef = Parameters<ExtensionAPI["registerTool"]>[0];

function interceptTool(pi: ExtensionAPI, name: string, onTool: (tool: ToolDef) => void): ExtensionAPI {
  return new Proxy(pi, {
    get(target, prop) {
      if (prop === "registerTool") {
        return (tool: ToolDef) => (tool.name === name ? onTool(tool) : target.registerTool(tool));
      }
      const value = Reflect.get(target, prop, target);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}

export default async function bashUnified(pi: ExtensionAPI): Promise<void> {
  let capturedBash: ToolDef | undefined;
  const coordinator = new TaskCoordinator();
  const lifecycle = new TaskLifecycle(coordinator);
  const uiLoad = loadTaskUIConfig();
  processTasks(interceptTool(pi, "bash", (tool) => (capturedBash = tool)), { coordinator, lifecycle, uiConfig: uiLoad.config });
  const uiOwner = createTaskUIOwner(pi, coordinator, lifecycle, uiLoad.config);
  const warnings = registerTaskControls(pi, coordinator, uiLoad.config, uiOwner.openPanel);
  for (const warning of [...uiLoad.warnings, ...warnings]) console.error(`[task-ui] config: ${warning}`);
  if (!capturedBash) {
    throw new Error("bash-unified: extensions/process-tasks did not register a `bash` tool; its entry point changed");
  }
  const backgroundBash = capturedBash;
  agentTasks(pi, { coordinator, lifecycle });
  pi.on("session_shutdown", async () => { await lifecycle.shutdown(); });

  await pretty(
    adaptPrettyLifecycle(
      interceptTool(pi, "bash", (tool) =>
        pi.registerTool({
          ...tool,
          // Pretty replaces the snippet with its own, which drops the background-task hint.
          promptSnippet: `${backgroundBash.promptSnippet ?? "Run shell commands"}. For text search: \`rg -n\`.`,
        }),
      ),
      createPromptEditorClass,
    ),
    {
      sdk: {
        createReadToolDefinition: hostSdk.createReadToolDefinition,
        createLsToolDefinition: hostSdk.createLsToolDefinition,
        createFindToolDefinition: hostSdk.createFindToolDefinition,
        createGrepToolDefinition: hostSdk.createGrepToolDefinition,
        createBashToolDefinition: () => backgroundBash,
      },
    } as Parameters<typeof pretty>[1],
  );
  // Pretty installs its editor in session_start; our live-instance handoff must run last.
  registerDownOpener(pi, lifecycle, uiLoad.config.downOpener, uiOwner);
}
