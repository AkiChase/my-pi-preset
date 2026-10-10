import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

// Smoke test: run /hello in pi to confirm this package is loaded. Delete once real extensions exist.
export default function (pi: ExtensionAPI) {
  pi.registerCommand("hello", {
    description: "Confirm my-pi-extensions is loaded",
    handler: async (_args, ctx) => {
      ctx.ui.notify("my-pi-extensions is loaded", "info");
    },
  });
}
