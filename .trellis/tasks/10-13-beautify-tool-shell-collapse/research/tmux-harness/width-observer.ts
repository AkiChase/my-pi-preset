// Test-only public renderer observer; delegates without changing layout or styling.
import { appendFileSync } from "node:fs";
export default function (pi: any) {
  pi.registerToolRenderer((name: string, next: any) => {
    const original = next();
    if (!original || !["read", "bash"].includes(name)) return original;
    const wrap = (fn: any, slot: string) => fn && ((...args: any[]) => {
      const component = fn(...args);
      return { invalidate: () => component.invalidate?.(), render(width: number) {
        const lines = component.render(width);
        appendFileSync(process.env.BEAUTIFY_SMOKE_ROOT + "/widths.jsonl", JSON.stringify({name, slot, width, lines}) + "\n");
        return lines;
      }, handleMouse: component.handleMouse?.bind(component) };
    });
    return { ...original, renderCall: wrap(original.renderCall, "call"), renderResult: wrap(original.renderResult, "result") };
  });
}
