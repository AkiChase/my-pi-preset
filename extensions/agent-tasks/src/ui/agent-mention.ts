import type { AutocompleteItem, AutocompleteProvider, AutocompleteSuggestions } from "@earendil-works/pi-tui";
import type { AgentManager } from "../agent-manager.ts";
import { MENTION_TRIGGER, resumeKey } from "../mention.ts";

export type TypeInfo = { name: string; description: string };

/** Suggestions are explicit commands: full IDs are visible while insertion stays concise. */
export function createMentionProvider(current: AutocompleteProvider, roster: () => { manager: AgentManager; types: readonly TypeInfo[] } | undefined, isEnabled: () => boolean): AutocompleteProvider {
  return {
    triggerCharacters: ["@"],
    async getSuggestions(lines, line, column, options): Promise<AutocompleteSuggestions | null> {
      let theirs: AutocompleteSuggestions | null = null;
      try { theirs = await current.getSuggestions(lines, line, column, options); } catch { /* Pi file completion remains optional */ }
      const state = isEnabled() ? roster() : undefined;
      const text = lines[line] ?? "";
      const match = MENTION_TRIGGER.exec(text.slice(0, column));
      if (!state || !match) return theirs;
      const prefix = match[2];
      const typed = match[2].toLowerCase();
      const items: AutocompleteItem[] = [];
      for (const type of state.types) {
        const value = `@agent:create:${type.name} `;
        if (value.toLowerCase().startsWith(prefix.toLowerCase())) items.push({ value, label: value.trimEnd(), description: `create · ${type.description}` });
      }
      for (const record of state.manager.listAgents().filter(record => record.parentAgentId === undefined)) {
        const value = `@agent:resume:${resumeKey(record.type, record.registryIndex ?? -1)} `;
        if (value.toLowerCase().startsWith(prefix.toLowerCase())) items.push({ value, label: record.id, description: `resume · ${record.status}` });
      }
      if (!items.length) return theirs;
      return theirs ? { items: [...items, ...theirs.items], prefix } : { items, prefix };
    },
    applyCompletion(lines, line, column, item, prefix) { return current.applyCompletion(lines, line, column, item, prefix); },
    shouldTriggerFileCompletion(lines, line, column) { return current.shouldTriggerFileCompletion?.(lines, line, column) ?? true; },
  };
}
