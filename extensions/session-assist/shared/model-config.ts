import { getSupportedThinkingLevels, type ModelThinkingLevel } from "@earendil-works/pi-ai";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { DialogScope } from "../../shared/interaction/dialog.ts";
import { cleanText } from "./text.ts";

export const THINKING_LEVELS: readonly ModelThinkingLevel[] = ["off", "minimal", "low", "medium", "high", "xhigh", "max"];
export interface ModelConfig { modelMode: "follow" | "custom"; model?: string; thinking?: ModelThinkingLevel }
export interface ModelConfigState { config: ModelConfig; issues: string[] }
const MODEL_CONTROLS = /[\x00-\x1f\x7f-\x9f\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069]/u;
export function validModelName(value: unknown): value is string {
    return typeof value === "string" && !MODEL_CONTROLS.test(value) && /^[^/\s]+\/\S+$/.test(value);
}
export function parseModelConfig(value: Record<string, unknown>): ModelConfigState {
    // Existing explicit (even incomplete) settings must never silently become inherited settings.
    const inferred = value.model !== undefined || value.thinking !== undefined ? "custom" : "follow";
    const mode = value.modelMode ?? inferred;
    const config: ModelConfig = { modelMode: mode === "follow" ? "follow" : "custom" };
    const issues: string[] = [];
    if (value.modelMode !== undefined && value.modelMode !== "follow" && value.modelMode !== "custom") issues.push("modelMode must be follow or custom");
    if (validModelName(value.model)) config.model = value.model;
    else if (config.modelMode === "custom") issues.push("model must be explicitly set to provider/model-id");
    if (typeof value.thinking === "string" && THINKING_LEVELS.includes(value.thinking as ModelThinkingLevel)) config.thinking = value.thinking as ModelThinkingLevel;
    else if (config.modelMode === "custom") issues.push("thinking must be explicitly set to off, minimal, low, medium, high, xhigh or max");
    return { config, issues };
}
export function resolveModelConfig(state: ModelConfigState, registry: ExtensionContext["modelRegistry"], main: Pick<ExtensionContext, "model">,
    thinking: ModelThinkingLevel, label: string): { model: NonNullable<ExtensionContext["model"]>; thinking: ModelThinkingLevel } {
    if (state.issues.length) throw new Error(state.issues.join("; "));
    if (state.config.modelMode === "follow") {
        if (!main.model) throw new Error("No model selected in the main session");
        return { model: main.model, thinking };
    }
    const { model: name, thinking: customThinking } = state.config;
    if (!name || customThinking === undefined) throw new Error("Explicit model and thinking are required in custom mode");
    const split = name.indexOf("/");
    const model = registry.find(name.slice(0, split), name.slice(split + 1));
    if (!model) throw new Error(`${label} model ${name} is unavailable`);
    if (!model.input.includes("text")) throw new Error(`${label} model ${name} does not support text input`);
    if (!getSupportedThinkingLevels(model).includes(customThinking)) throw new Error(`${label} model ${name} does not support thinking ${customThinking}`);
    if (!registry.hasConfiguredAuth(model)) throw new Error(`${label} model ${name} has no configured authentication`);
    return { model, thinking: customThinking };
}
export function displayModelValue(value: unknown, limit = 160): string {
    const points = Array.from(cleanText(String(value)).replace(/\u061c/g, ""));
    return points.length > limit ? `${points.slice(0, limit - 1).join("")}…` : points.join("");
}
export function modelConfigSummary(config: ModelConfig, ctx: Pick<ExtensionContext, "model">, thinking: ModelThinkingLevel): string {
    const follow = config.modelMode === "follow";
    const model = follow ? ctx.model && `${ctx.model.provider}/${ctx.model.id}` : config.model;
    return `mode ${follow ? "follow main session" : "custom"}, model ${displayModelValue(model ?? "missing")}, thinking ${displayModelValue(follow ? thinking : config.thinking ?? "missing")}`;
}
/** The caller owns cancellation, notification and the fresh patch save for this complete flow. */
export async function chooseModelConfig(flow: DialogScope, choice: "Set model" | "Set thinking", config: ModelConfig,
    ctx: ExtensionContext, label: string, notify: (message: string) => void): Promise<Partial<ModelConfig> | undefined> {
    const models = ctx.modelRegistry.getAvailable().filter(model => model.input.includes("text") &&
        ctx.modelRegistry.hasConfiguredAuth(model) && validModelName(`${model.provider}/${model.id}`))
        .sort((a, b) => `${a.provider}/${a.id}`.localeCompare(`${b.provider}/${b.id}`));
    let selected = models.find(model => `${model.provider}/${model.id}` === config.model);
    const patch: Partial<ModelConfig> = { modelMode: "custom" };
    if (choice === "Set model") {
        if (!models.length) {
            flow.checkpoint();
            notify(`No authenticated text models available for ${label}; configure a provider first. File unchanged.`);
            return undefined;
        }
        const labels = models.map((model, index) => `${index + 1}. ${displayModelValue(`${model.provider}/${model.id}`, 760)}`);
        const raw = await flow.select(`${label} model (authenticated text models)`, labels);
        const index = labels.indexOf(raw);
        if (index < 0) throw new Error(`Unknown ${label} model selection`);
        selected = models[index];
        patch.model = `${selected.provider}/${selected.id}`;
    }
    if (!selected) {
        flow.checkpoint();
        notify(`Select an available ${label} model with Set model before choosing thinking. File unchanged.`);
        return undefined;
    }
    const levels = getSupportedThinkingLevels(selected);
    if (choice === "Set thinking" || config.thinking === undefined || !levels.includes(config.thinking)) {
        const raw = await flow.select(displayModelValue(`${label} thinking for ${selected.provider}/${selected.id}`, 800), levels);
        const level = levels.find(level => level === raw);
        if (level === undefined) throw new Error(`Unsupported ${label} thinking selection`);
        patch.thinking = level;
    }
    if (patch.model === undefined) patch.model = `${selected.provider}/${selected.id}`;
    if (patch.thinking === undefined) patch.thinking = config.thinking;
    // Registry/auth/capabilities can change during either dialog. Revalidate before the caller saves.
    flow.checkpoint();
    resolveModelConfig(parseModelConfig({ ...config, ...patch }), ctx.modelRegistry, ctx, "off", label);
    flow.checkpoint();
    return patch;
}
