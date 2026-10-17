import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export const OPTIONAL_TOOL_PARAMETERS_GUIDELINE =
  "Omit unused optional tool parameters rather than filling them with empty strings or null. " +
  "Use empty or null values only when the field explicitly supports them or the actual schema requires a nullable value. " +
  "Preserve intentional valid values such as false and 0.";

export default function toolGuidance(pi: ExtensionAPI): void {
  pi.on("before_agent_start", event => {
    const guidelines = event.systemPromptOptions.promptGuidelines;
    if (!guidelines.includes(OPTIONAL_TOOL_PARAMETERS_GUIDELINE)) {
      guidelines.push(OPTIONAL_TOOL_PARAMETERS_GUIDELINE);
    }
  });
}
