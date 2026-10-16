import { Theme } from "@earendil-works/pi-coding-agent";
import type { ThemeColor, ThemeBg } from "@earendil-works/pi-coding-agent";
import { ScrollView, truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import type { Component } from "@earendil-works/pi-tui";
import type { NativeBox, NativeFrame, NativeLayout } from "../../shared/scroll-panel/native-layout.ts";

// Actual public Theme, not SDK-private theme loaders or global theme/watchers.
export function testTheme(appearance: "dark" | "light" = "dark"): Theme {
  const fg = Object.fromEntries(["muted", "text", "thinkingXhigh", "accent", "dim", "warning", "error", "mdHeading", "mdLink", "mdLinkUrl", "mdCode", "mdCodeBlock", "mdCodeBlockBorder", "mdQuote", "mdQuoteBorder", "mdHr", "mdListBullet"].map(key => [key, appearance === "dark" ? "#abcdef" : "#123456"])) as Record<ThemeColor, string>;
  return new Theme(fg, { selectedBg: appearance === "dark" ? "#222222" : "#eeeeee" } as Record<ThemeBg, string>, "truecolor", { appearance });
}

export const SCROLLBAR = "┃";
type Entry = { component: Component; basis?: number; grow?: number };
/**
 * Test double for the shared native-layout boundary. It never loads host internals, so tests
 * cannot depend on the installed layout succeeding. It allocates fixed VStack rows by basis and
 * gives the growing ScrollView the remainder via its public updateLayout, then crops the
 * viewport and marks the scrollbar column, mirroring the observable frame contract.
 */
export function fakeLayout(): NativeLayout & { renders: number; fail?: Error } {
  const layout = {
    renders: 0,
    fail: undefined as Error | undefined,
    render(root: Component, width: number, height: number, requestRender: () => void): NativeFrame {
      if (layout.fail) throw layout.fail;
      layout.renders++;
      // Test-only structural read of the public VStack's entries; production never does this.
      const entries = Reflect.get(root, "entries") as Entry[];
      const fixed = entries.filter(entry => !entry.grow).reduce((sum, entry) => sum + (entry.basis ?? 0), 0);
      const lines: string[] = [];
      const children: NativeBox[] = [];
      let y = 0;
      for (const entry of entries) {
        const size = entry.grow ? Math.max(0, height - fixed) : Math.min(entry.basis ?? 0, height - y);
        const rect = { x: 0, y, width, height: size };
        if (entry.component instanceof ScrollView) {
          const scroll = entry.component;
          const content = scroll.render(width);
          scroll.updateLayout(content.length, size, requestRender);
          const contentWidth = scroll.getContentWidth(width);
          for (const line of content.slice(scroll.scrollTop, scroll.scrollTop + size)) {
            const clipped = truncateToWidth(line, contentWidth, "");
            lines.push(clipped + " ".repeat(Math.max(0, contentWidth - visibleWidth(clipped))) + (contentWidth < width ? SCROLLBAR : ""));
          }
          for (let pad = Math.min(size, Math.max(0, content.length - scroll.scrollTop)); pad < size; pad++) lines.push(contentWidth < width ? " ".repeat(contentWidth) + SCROLLBAR : "");
          children.push({ component: scroll, rect, clip: rect, scrollView: scroll,
            children: [{ component: scroll, rect: { x: 0, y: y - scroll.scrollTop, width: contentWidth, height: content.length }, clip: rect, children: [] }] });
        } else {
          lines.push(...entry.component.render(width).slice(0, size).map(line => truncateToWidth(line, width, "")));
          while (lines.length < y + size) lines.push("");
          children.push({ component: entry.component, rect, clip: rect, children: [] });
        }
        y += size;
      }
      while (lines.length < height) lines.push("");
      const rect = { x: 0, y: 0, width, height };
      return { root: { component: root, rect, clip: rect, children }, width, height, lines: lines.slice(0, height) };
    },
    scrollBox(frame: NativeFrame, scroll: ScrollView): NativeBox {
      const box = frame.root.children.find(child => child.scrollView === scroll);
      if (!box) throw new Error("Missing native ScrollView geometry");
      return box;
    },
  };
  return layout;
}

export function fakeTui(rows = 24, columns = 80) {
  const tui = { renders: 0, terminal: { rows, columns }, requestRender() { tui.renders++; } };
  return tui;
}
