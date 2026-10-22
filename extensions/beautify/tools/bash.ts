import { isLaunchMetadata, launchText } from "../../runtime-tasks/launch.ts";
import { text } from "../types.ts";
import type { RenderContext } from "../types.ts";
import { fallback, genericMetadata, renderers } from "./shared.ts";
export function createBashRenderers(elapsed?: (ctx: RenderContext) => string | undefined) {
return renderers("bash", fallback, (result, ctx) => {
  const handling = elapsed?.(ctx);
  const attachTime = <T extends { stats: string; secondary?: string }>(meta: T): T => {
    if (handling) meta.stats = [meta.stats, handling].filter(Boolean).join(" · ");
    return meta;
  };
  if (!result || ctx.isError) return attachTime(genericMetadata(result, ctx));
  const identity = (result.details as { runtimeLaunch?: unknown } | undefined)?.runtimeLaunch;
  const full = text(result);
  const valid = isLaunchMetadata(identity) && "task_type" in identity && identity.task_type === "bash" && full.startsWith(launchText(identity) + "\n");
  const raw = valid ? full.slice(full.indexOf("\n") + 1) : full;
  const background = raw.match(/^Command (?:running in background|was manually backgrounded by user) with ID: ([^\s.]+)\. Output is being written to: [^\n]+$/);
  if (background && valid && "task_id" in identity && identity.mode === "background" && background[1] === identity.task_id) return attachTime({ stats: `background ID: ${background[1]}` });
  const meta = genericMetadata(valid ? { ...result, content: [{ type: "text", text: raw }] } : result, ctx);
  if (!handling && typeof ctx.durationMs === "number" && Number.isFinite(ctx.durationMs) && ctx.durationMs >= 0) meta.secondary = `${ctx.durationMs}ms call`;
  return attachTime(meta);
});
}
export const bashRenderers = createBashRenderers();
