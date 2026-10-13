// Test-only dynamic SDK loading; uses the installed implementation, never a copied setter.
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
const sdkUrl = import.meta.resolve("@earendil-works/pi-coding-agent");
const root = dirname(dirname(fileURLToPath(sdkUrl)));
const { createJiti } = createRequire(sdkUrl)("jiti");
const jiti = createJiti(import.meta.url, { fsCache: false });
export const { InteractiveMode } = await import(join(root, "dist/modes/interactive/interactive-mode.js"));
export const { KeybindingsManager } = await import(join(root, "dist/core/keybindings.js"));
export const themeSdk = await import(join(root, "dist/modes/interactive/theme/theme.js"));
themeSdk.initTheme("dark", false);
export const pretty = (await jiti.import(fileURLToPath(import.meta.resolve("@heyhuynhgiabuu/pi-pretty/src/index.ts")))).default;
export const fff = await jiti.import(fileURLToPath(import.meta.resolve("@heyhuynhgiabuu/pi-pretty/src/fff.ts")));
export const { createPromptEditorClass } = await jiti.import(fileURLToPath(import.meta.resolve("@heyhuynhgiabuu/pi-pretty/src/prompt-editor.ts")));
