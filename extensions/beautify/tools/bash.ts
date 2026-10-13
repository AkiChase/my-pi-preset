import { clean, summary, wrap } from "../layout.ts";
import { text } from "../types.ts";
import { fallback, renderers } from "./shared.ts";
export const bashRenderers = renderers("bash", (result, theme, ctx, width) => {
  const output = clean(text(result));
  if (ctx.expanded || ctx.isError || /(?:running in background|manually backgrounded|background job|Job ID|\/tmp\/pi-bg\/)/i.test(output)) return fallback(result, theme, ctx, width);
  const lines = output ? output.split("\n").length : 0;
  const duration = ctx.durationMs === undefined ? "" : ` · ${ctx.durationMs}ms call`;
  return summary("Output", "", `${lines} lines${duration}`, width, theme).concat(!output ? wrap("(no output)", width) : []);
});
