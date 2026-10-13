// Actual SDK loader, resolver and components; no replacement host implementation.
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
const root = dirname(dirname(fileURLToPath(import.meta.resolve("@earendil-works/pi-coding-agent"))));
export const { loadExtensions } = await import(join(root, "dist/core/extensions/loader.js"));
export const { ExtensionRunner } = await import(join(root, "dist/core/extensions/runner.js"));
export const { ToolExecutionComponent } = await import(join(root, "dist/modes/interactive/components/tool-execution.js"));
export const { KeybindingsManager } = await import(join(root, "dist/core/keybindings.js"));
export const themeSdk = await import(join(root, "dist/modes/interactive/theme/theme.js"));
themeSdk.initTheme("dark", false);
export function resolver(loaded, cwd) { return new ExtensionRunner(loaded.extensions, loaded.runtime, cwd, {}, {}); }
