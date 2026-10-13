import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Highlighter } from "./highlight.ts";
import { readRenderers } from "./tools/read.ts";
import { bashRenderers } from "./tools/bash.ts";
import { findRenderers } from "./tools/find.ts";
import { grepRenderers } from "./tools/grep.ts";
import { registerAppearance } from "./editor/owner.ts";
export default function beautify(pi: ExtensionAPI): void {
  const highlighter = new Highlighter();
  const tools = { read: readRenderers(highlighter), bash: bashRenderers, find: findRenderers, grep: grepRenderers };
  pi.registerToolRenderer((name, next) => Object.hasOwn(tools, name) ? tools[name as keyof typeof tools] : next());
  registerAppearance(pi);
  pi.on("session_shutdown", () => highlighter.dispose());
}
