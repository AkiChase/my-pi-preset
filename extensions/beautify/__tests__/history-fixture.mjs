import { CustomEditor, SessionManager } from "@earendil-works/pi-coding-agent";
import { Input, matchesKey } from "@earendil-works/pi-tui";

// Independently written contract fixture, not a copy of pi-input-history.
// Models 1.1.3's factory chaining, oldest-to-newest public addToHistory,
// cwd-scoped SessionManager discovery and independent newest-first search cache.
function prompts(entries) {
  return entries.flatMap((entry) => {
    if (entry.type !== "message" || entry.message.role !== "user") return [];
    const content = entry.message.content;
    const text = typeof content === "string" ? content : content.find((part) => part.type === "text")?.text;
    return text?.trim() ? [text.trim()] : [];
  }).reverse();
}
function unique(items) { return [...new Set(items)].slice(0, 100); }

export default function inputHistory(pi) {
  let cache = [];
  pi.on("session_start", async (_event, ctx) => {
    const sessions = (await SessionManager.list(ctx.cwd)).sort((a, b) => b.modified - a.modified);
    cache = unique(sessions.flatMap((session) => prompts(SessionManager.open(session.path).getEntries())));
    if (!cache.length) return;
    const previous = ctx.ui.getEditorComponent();
    ctx.ui.setEditorComponent((...args) => {
      const editor = previous?.(...args) ?? new CustomEditor(...args, { embedWorkingStatus: true });
      for (const text of [...cache].reverse()) editor.addToHistory?.(text);
      return editor;
    });
  });
  pi.registerShortcut("alt+r", {
    description: "Isolated reverse-search fixture",
    async handler(ctx) {
      const items = unique([...prompts(ctx.sessionManager.getBranch()), ...cache]);
      let overlayTui;
      const selected = await ctx.ui.custom((tui, _theme, _kb, done) => {
        overlayTui = tui;
        const input = new Input();
        let index = 0;
        const matches = () => items.filter((item) => {
          let rest = item.toLowerCase();
          return [...input.getValue().toLowerCase()].every((char) => {
            const offset = rest.indexOf(char);
            if (offset < 0) return false;
            rest = rest.slice(offset + 1);
            return true;
          });
        });
        return {
          render(width) { return [`reverse-search: ${input.getValue()}`, ...input.render(width), matches()[index] ?? ""]; },
          handleInput(data) {
            if (matchesKey(data, "enter")) { done(matches()[index] ?? null); return; }
            if (matchesKey(data, "escape")) { done(null); return; }
            if (matchesKey(data, "up") || matchesKey(data, "alt+r")) index = Math.min(index + 1, matches().length - 1);
            else if (matchesKey(data, "down")) index = Math.max(0, index - 1);
            else { input.handleInput(data); index = 0; }
          },
        };
      }, { overlay: true });
      if (selected == null) return;
      ctx.ui.setEditorText(selected);
      overlayTui?.requestRender();
    },
  });
}
