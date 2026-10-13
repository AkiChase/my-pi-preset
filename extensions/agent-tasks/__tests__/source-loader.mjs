// Native node:test only: transform non-erasable vendor TS in memory, without dist.
// Production continues to use Pi's jiti loader. Keep this hook scoped to our fork.
import { registerHooks, stripTypeScriptTypes } from "node:module";

const vendorRoot = new URL("../src/", import.meta.url).href;
registerHooks({
  load(url, context, nextLoad) {
    const result = nextLoad(url, context);
    if (!url.startsWith(vendorRoot) || !url.endsWith(".ts")) return result;
    return {
      ...result,
      format: "module",
      source: stripTypeScriptTypes(String(result.source), { mode: "transform", sourceUrl: url }),
    };
  },
});
