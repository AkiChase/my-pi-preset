import type { Theme, ToolRenderers } from "@earendil-works/pi-coding-agent";
import { Highlighter, language } from "../highlight.ts";
import { clean, readNotice, splitView, wrap } from "../layout.ts";
import { text, type RenderContext, type Result } from "../types.ts";
import { fallback, genericMetadata, numbered, renderers } from "./shared.ts";

function applyHighlight(weak: WeakRef<ReadDrawing>, revision: number, ansi: string | undefined): void {
  const drawing = weak.deref();
  drawing?.acceptHighlight(revision, ansi);
}

class ReadDrawing {
  private revision = 0;
  private signature = "";
  private ansi?: string;
  private pending = false;
  private highlighter: Highlighter;
  private result: Result;
  private theme: Theme;
  private ctx: RenderContext;
  constructor(highlighter: Highlighter, result: Result, theme: Theme, ctx: RenderContext) { this.highlighter = highlighter; this.result = result; this.theme = theme; this.ctx = ctx; }
  update(result: Result, theme: Theme, ctx: RenderContext) {
    if (text(this.result) !== text(result) || this.ctx.expanded !== ctx.expanded || this.ctx.isError !== ctx.isError ||
        JSON.stringify(this.ctx.args) !== JSON.stringify(ctx.args) || this.theme !== theme) {
      this.revision++; this.signature = ""; this.ansi = undefined; this.pending = false;
    }
    this.result = result; this.theme = theme; this.ctx = ctx;
    // render(width) compares semantic inputs. Host invalidation creates a fresh context
    // even for unchanged output; do not erase completed ANSI on that redraw.
  }
  acceptHighlight(revision: number, ansi: string | undefined): void {
    if (!this.highlighter.active || this.revision !== revision || ansi === undefined) return;
    this.ansi = ansi;
    try { this.ctx.invalidate(); } catch { console.error("[beautify] Highlight redraw failed; retaining readable output."); }
  }
  invalidate() {}
  render(width: number): string[] {
    const { result, theme, ctx } = this;
    const room = width;
    const raw = text(result), view = splitView(raw, readNotice);
    const path = clean(String(ctx.args.path ?? "read"));
    const start = typeof ctx.args.offset === "number" ? Math.max(1, ctx.args.offset) : 1;
    const image = result.content.some(block => block.type === "image") || /^Read image file \[image\//.test(raw);
    const signature = JSON.stringify([view.body, path, width, ctx.expanded, theme.name, ctx.isError, image]);
    if (signature !== this.signature) {
      this.signature = signature; this.revision++; this.ansi = undefined; this.pending = false;
    }
    if (ctx.expanded && !image && !ctx.isError && view.body && !this.ansi && !this.pending && this.highlighter.active) {
      this.pending = true;
      const revision = this.revision;
      // Callback retains only a WeakRef to the drawing; no old ctx or result closes over the await.
      const weak = new WeakRef(this);
      void this.highlighter.highlight(view.body, language(path)).then(applyHighlight.bind(undefined, weak, revision));
    }
    if (!ctx.expanded) return [];
    let lines: string[];
    if (ctx.isError || image) lines = fallback(result, theme, ctx, room);
    else {
      const code = this.ansi?.split("\n") ?? view.lines;
      const digits = String(start + Math.max(0, view.lines.length - 1)).length;
      lines = [];
      lines.push(...view.lines.map((_line, index) => numbered(code[index] ?? view.lines[index]!, start + index, digits, room, theme)));
      if (!view.lines.length && !view.notice.length) lines.push(...wrap("(empty file)", room));
      lines.push(...view.notice.flatMap(line => wrap(line, room).map(row => theme.fg("muted", row))));
    }
    return lines;
  }
}
export function readRenderers(highlighter: Highlighter): ToolRenderers {
  const base = renderers("read", fallback, (result, ctx) => {
    if (!result || ctx.isError) return genericMetadata(result, ctx);
    const raw = text(result), view = splitView(raw, readNotice);
    if (result.content.some(block => block.type === "image") || /^Read image file \[image\//.test(raw)) return { stats: "image" };
    return { stats: `${view.lines.length} lines${view.notice.length ? " · limited" : ""}` };
  });
  return { ...base,
    renderResult(result, options, theme, context) {
      base.renderResult!(result, options, theme, context);
      const ctx = context as RenderContext;
      const existing = ctx.lastComponent;
      const drawing = existing instanceof ReadDrawing ? existing : new ReadDrawing(highlighter, result, theme, ctx);
      drawing.update(result, theme, ctx);
      // Keep the highlighting revision current even when its body is hidden.
      return drawing;
    },
  };
}
