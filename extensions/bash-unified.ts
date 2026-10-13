import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import * as hostSdk from "@earendil-works/pi-coding-agent";
// Vendored from pi-patty-bg-tasks — see extensions/bg-tasks/PROVENANCE.md. It is our code now:
// edit it in place, there is no upstream to merge back from.
import bgTasks from "./bg-tasks/index.ts";
// Deep import of `src`, not the package root: pretty's `pi.extensions` manifest points at
// `./src/index.ts`, so this is the entry pi itself loads, and its `dist` build can lag.
// There is no `exports` field blocking the subpath today; if upstream adds one, this throws
// loudly at load time rather than silently degrading.
import pretty from "@heyhuynhgiabuu/pi-pretty/src/index.ts";
import { createPromptEditorClass } from "@heyhuynhgiabuu/pi-pretty/src/prompt-editor.ts";
import { adaptPrettyLifecycle } from "./pretty-compat/editor.ts";

// Loads the vendored bg-tasks extension and pi-pretty as one extension so they can share `bash`.
//
// Both packages register a tool named `bash`, and pi refuses two extensions owning the
// same tool name. Their halves are complementary: bg-tasks' bash only changes execution
// (run_in_background, auto-background on timeout, Ctrl+B), pretty's bash only changes
// rendering and delegates execution to the SDK bash definition it is given.
//
// So: run bg-tasks with its `bash` registration captured instead of registered, then hand
// that definition to pretty as its "SDK" bash via pretty's `deps.sdk` injection point.
// Pretty registers the single `bash`: bg-tasks' execute + parameters, pretty's renderers.
// Every other tool, command, shortcut and event handler from both passes through as-is.
//
// Do not also install npm:pi-patty-bg-tasks or npm:@heyhuynhgiabuu/pi-pretty as separate
// pi packages: they would register their tools a second time and conflict again.

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
  bgTasks(interceptTool(pi, "bash", (tool) => (capturedBash = tool)));
  if (!capturedBash) {
    throw new Error("bash-unified: extensions/bg-tasks did not register a `bash` tool; its entry point changed");
  }
  const backgroundBash = capturedBash;

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
}
