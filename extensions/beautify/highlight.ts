import { codeToANSI } from "@shikijs/cli";
import { bundledLanguages, type BundledLanguage } from "shiki";
import { extname } from "node:path";
const aliases: Record<string, string> = { ts: "typescript", tsx: "tsx", js: "javascript", jsx: "jsx", mjs: "javascript", cjs: "javascript", py: "python", rb: "ruby", rs: "rust", go: "go", sh: "bash", bash: "bash", zsh: "bash", yml: "yaml", yaml: "yaml", json: "json", jsonc: "jsonc", md: "markdown", mdx: "mdx", html: "html", css: "css", scss: "scss", less: "css", sql: "sql", java: "java", kt: "kotlin", swift: "swift", c: "c", h: "c", cpp: "cpp", hpp: "cpp", cs: "csharp", php: "php", vue: "vue", svelte: "svelte", toml: "toml", xml: "xml", dockerfile: "dockerfile", makefile: "make", graphql: "graphql", lua: "lua", dart: "dart", zig: "zig", nim: "nim", elixir: "elixir" };
export function language(path: string): string | undefined {
  const name = path.split(/[\\/]/).at(-1)?.toLowerCase() ?? "";
  if (name === "dockerfile") return "dockerfile";
  if (name === "makefile" || name === "gnumakefile") return "make";
  const lang = aliases[extname(name).slice(1)];
  return lang && Object.hasOwn(bundledLanguages, lang) ? lang : undefined;
}
export type Colorize = (text: string, language: string) => Promise<string>;
export class Highlighter {
  active = true;
  private cache = new Map<string, string>();
  private characters = 0;
  private warned = false;
  private colorize: Colorize;
  private diagnose: () => void;
  constructor(colorize: Colorize = (code, lang) => codeToANSI(code, lang as BundledLanguage, "one-dark-pro"), diagnose: () => void = () => console.error("[beautify] Syntax highlighting failed; using plain text.")) { this.colorize = colorize; this.diagnose = diagnose; }
  async highlight(text: string, lang: string | undefined): Promise<string | undefined> {
    if (!this.active || !lang || text.length > 80_000) return undefined;
    const key = JSON.stringify(["one-dark-pro", lang, text]);
    const cached = this.cache.get(key);
    if (cached !== undefined) { this.cache.delete(key); this.cache.set(key, cached); return cached; }
    try {
      const ansi = await this.colorize(text, lang);
      if (!this.active) return undefined;
      // Colorizers may finish concurrently; replace rather than double-count the same key.
      const previous = this.cache.get(key);
      if (previous !== undefined) this.characters -= key.length + previous.length;
      this.cache.set(key, ansi); this.characters += key.length + ansi.length;
      while (this.cache.size > 128 || this.characters > 2 * 1024 * 1024) {
        const oldest = this.cache.keys().next().value!;
        this.characters -= oldest.length + this.cache.get(oldest)!.length; this.cache.delete(oldest);
      }
      return ansi;
    } catch {
      if (this.active && !this.warned) { this.warned = true; try { this.diagnose(); } catch { /* Optional diagnostics cannot block plain rendering. */ } }
      return undefined;
    }
  }
  dispose(): void { this.active = false; this.cache.clear(); this.characters = 0; }
  get size(): number { return this.cache.size; }
}
