// Test-only dynamic SDK loading; uses the installed implementation, never a copied setter.
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
const sdkUrl = import.meta.resolve("@earendil-works/pi-coding-agent");
const root = dirname(dirname(fileURLToPath(sdkUrl)));
export const { InteractiveMode } = await import(join(root, "dist/modes/interactive/interactive-mode.js"));
export const { KeybindingsManager } = await import(join(root, "dist/core/keybindings.js"));
export const themeSdk = await import(join(root, "dist/modes/interactive/theme/theme.js"));
themeSdk.initTheme("dark", false);
