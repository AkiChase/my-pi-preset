import { text } from "../types.ts";
import { fallback, genericMetadata, renderers } from "./shared.ts";
export const bashRenderers = renderers("bash", fallback, (result, ctx) => {
  if (!result || ctx.isError) return genericMetadata(result, ctx);
  const raw = text(result);
  const background = raw.match(/^Command (?:running in background|was manually backgrounded by user) with ID: ([^\s.]+)\. Output is being written to: [^\n]+$/);
  if (background) return { stats: `background ID: ${background[1]}` };
  const meta = genericMetadata(result, ctx);
  if (typeof ctx.durationMs === "number" && Number.isFinite(ctx.durationMs) && ctx.durationMs >= 0) meta.secondary = `${ctx.durationMs}ms call`;
  return meta;
});
