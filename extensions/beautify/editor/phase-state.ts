import type { MessageEndEvent, MessageUpdateEvent } from "@earendil-works/pi-coding-agent";

export type Phase = "Loading" | "Brewing" | "Tooling" | "Asking" | "Compacting";
export interface PhaseSnapshot { phase: Phase; startedAt?: number }

/** Main-loop facts only. Provider hooks and background task counts are deliberately absent. */
export class PhaseState {
  private base?: "Loading" | "Brewing" | "Tooling";
  private baseStartedAt = 0;
  private running = false;
  private expected = new Set<string>();
  private active = new Set<string>();
  private compactStartedAt?: number;
  private standardPrompt = false;
  private questions = new Set<string>();
  private anonymousQuestions = 0;

  private turnOpen = false;
  private turnIdentity?: string;
  private readonly now: () => number;
  constructor(now: () => number = () => performance.now()) { this.now = now; }

  private setBase(phase?: "Loading" | "Brewing" | "Tooling"): void {
    if (phase !== this.base) { this.base = phase; this.baseStartedAt = this.now(); }
  }
  turn(identity?: string): void {
    if (this.turnOpen && identity !== undefined && identity === this.turnIdentity) return;
    this.turnOpen = true; this.turnIdentity = identity;
    this.running = true;
    this.expected.clear(); this.active.clear();
    this.setBase(undefined); this.setBase("Loading");
  }
  update(event: MessageUpdateEvent): void {
    if (!this.running || this.compactStartedAt !== undefined || event.message.role !== "assistant" || this.base !== "Loading") return;
    const stream = event.assistantMessageEvent;
    // Empty block-start/delta/end events are not evidence of generated content.
    const delta = "delta" in stream && typeof stream.delta === "string" && stream.delta.length > 0;
    const content = event.message.content.some(block => block.type === "text" ? block.text.length > 0
      : block.type === "thinking" ? block.thinking.length > 0
      : block.type === "toolCall" && Object.keys(block.arguments).length > 0);
    if (delta || content) this.setBase("Brewing");
  }
  messageEnd(event: MessageEndEvent): void {
    if (!this.running || event.message.role !== "assistant" || this.compactStartedAt !== undefined) return;
    this.expected = new Set(event.message.content.filter(block => block.type === "toolCall").map(block => block.id));
    // A completed stream is not yet tool execution, nor continued generation.
    this.setBase(undefined);
  }
  toolStart(id: string, parent?: string): void {
    if (!this.running || parent || this.compactStartedAt !== undefined) return;
    this.active.add(id); this.expected.add(id); this.setBase("Tooling");
  }
  toolEnd(id: string, parent?: string): void {
    if (parent || !this.active.delete(id)) return;
    this.expected.delete(id);
    if (this.active.size === 0 && this.expected.size === 0) this.setBase(undefined);
  }
  turnEnd(): void { this.turnOpen = false; this.expected.clear(); this.active.clear(); this.setBase(undefined); }
  end(): void { this.running = false; this.turnEnd(); }
  compact(): void {
    if (this.compactStartedAt === undefined) this.compactStartedAt = this.now();
    this.setBase(undefined);
  }
  compactEnd(): void { this.compactStartedAt = undefined; this.setBase(undefined); }
  prompt(kind: string, active: boolean): void { this.standardPrompt = active && kind !== "custom"; }
  question(payload: unknown): void {
    if (!payload || typeof payload !== "object") return;
    const { active, toolCallId } = payload as { active?: unknown; toolCallId?: unknown };
    if (typeof active !== "boolean") return;
    if (typeof toolCallId === "string" && toolCallId.length > 0) {
      if (active) this.questions.add(toolCallId); else this.questions.delete(toolCallId);
    } else this.anonymousQuestions = Math.max(0, Math.min(256, this.anonymousQuestions + (active ? 1 : -1)));
  }
  snapshot(): PhaseSnapshot | undefined {
    const compact = this.compactStartedAt !== undefined;
    if ((this.running || compact) && (this.standardPrompt || this.questions.size > 0 || this.anonymousQuestions > 0)) return { phase: "Asking" };
    if (compact) return { phase: "Compacting", startedAt: this.compactStartedAt };
    return this.base ? { phase: this.base, startedAt: this.baseStartedAt } : undefined;
  }
  reset(): void {
    this.end(); this.compactStartedAt = undefined; this.standardPrompt = false;
    this.questions.clear(); this.anonymousQuestions = 0;
  }
}

export function elapsedSeconds(snapshot: PhaseSnapshot, now: number): number {
  return snapshot.startedAt === undefined ? 0 : Math.max(0, Math.floor((now - snapshot.startedAt) / 1000));
}
/** A bounded visual enhancement, never a warning/error or faster animation. */
export function phaseEnhancement(seconds: number): number { return Math.max(0, Math.min(1, (seconds - 10) / 20)); }
