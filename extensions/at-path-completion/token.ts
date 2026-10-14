// Pi 1.2 exports these helpers only from a subpath that the host jiti alias cannot
// resolve. Keep its delimiter rule local (no SDK mutation or private extractor).
const cjk = /[\p{Script_Extensions=Han}\p{Script_Extensions=Hiragana}\p{Script_Extensions=Katakana}\p{Script_Extensions=Hangul}\p{Script_Extensions=Bopomofo}]/u;
const punctuation = new RegExp(`(?:(?=\\p{Punctuation})${cjk.source}|[，．：；！？（）［］｛｝“”‘’…—])`, 'u');
const autocompleteSeparatorRegex = new RegExp(`(?:\\s|${punctuation.source})`, 'u');

const delimiters = new Set([' ', '\t', '"', "'", '=']);
const wrappers: Readonly<Record<string, string>> = { '(': ')', '[': ']', '{': '}', '<': '>', '`': '`' };
function boundary(text: string, index: number): boolean {
  while (index > 0 && wrappers[text[index - 1]!]) index--;
  return index === 0 || delimiters.has(text[index - 1]!) || autocompleteSeparatorRegex.test(text[index - 1]!);
}
/** Mirrors Pi 1.2's public delimiter rules, without querying its private extractor. */
export function atPrefix(line: string, col: number): string | undefined {
  const text = line.slice(0, col);
  // Slash commands are not an attachment browsing gesture, even in their arguments.
  if (line.trimStart().startsWith('/')) return undefined;
  let quote: number | undefined;
  for (let i = 0; i < text.length; i++) if (text[i] === '"') quote = quote === undefined ? i : undefined;
  if (quote !== undefined && text[quote - 1] === '@' && boundary(text, quote - 1)) return text.slice(quote - 1);
  let start = 0;
  for (let i = 0; i < text.length; i++) if (delimiters.has(text[i]!) || autocompleteSeparatorRegex.test(text[i]!)) start = i + 1;
  let token = text.slice(start);
  while (wrappers[token[0]!] && !token.includes(wrappers[token[0]!]!, 1)) token = token.slice(1);
  return token.startsWith('@') ? token : undefined;
}
export function atDirectory(lines: string[], line: number, col: number): boolean {
  const prefix = atPrefix(lines[line] ?? '', col);
  return prefix !== undefined && prefix.endsWith('/') && prefix.length > 1;
}
