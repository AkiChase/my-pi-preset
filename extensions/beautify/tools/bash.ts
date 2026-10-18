import { isLaunchMetadata, launchText } from "../../runtime-tasks/launch.ts";
import { text } from "../types.ts";
import { clean, wrap } from "../layout.ts";
import { fallback, genericMetadata, renderers } from "./shared.ts";
export const bashRenderers = renderers("bash", (result, theme, ctx, width) => [
  ...(typeof ctx.args.description === "string" && ctx.args.description.trim()
    ? wrap(`Command: ${clean(String(ctx.args.command ?? ""))}`, width).map(row => theme.fg("muted", row)) : []),
  ...fallback(result, theme, ctx, width),
], (result, ctx) => {
  if (!result || ctx.isError) return genericMetadata(result, ctx);
  const identity = (result.details as { runtimeLaunch?: unknown } | undefined)?.runtimeLaunch;
  const full = text(result);
  const valid = isLaunchMetadata(identity) && "task_type" in identity && identity.task_type === "bash" && full.startsWith(launchText(identity) + "\n");
  const raw = valid ? full.slice(full.indexOf("\n") + 1) : full;
  const background = raw.match(/^Command (?:running in background|was manually backgrounded by user) with ID: ([^\s.]+)\. Output is being written to: [^\n]+$/);
  if (background && valid && "task_id" in identity && identity.mode === "background" && background[1] === identity.task_id) return { stats: `background ID: ${background[1]}` };
  const meta = genericMetadata(valid ? { ...result, content: [{ type: "text", text: raw }] } : result, ctx);
  if (typeof ctx.durationMs === "number" && Number.isFinite(ctx.durationMs) && ctx.durationMs >= 0) meta.secondary = `${ctx.durationMs}ms call`;
  return meta;
});
