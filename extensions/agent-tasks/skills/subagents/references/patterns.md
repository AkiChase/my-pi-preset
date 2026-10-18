# Orchestration patterns

## Selection and scale

Apply only to explicitly authorized workflows; reading is not opt-in. Structure multiple perspectives for completeness, independent verification, or migrations/audits/sweeps beyond one context. Encode fan-out, verify and synthesize. A hybrid often works best: scout files/channels/diffs inline to discover a work-list, then orchestrate. You need not know the shape before the task, only before orchestration.

Chain workflows across turns: Understand (parallel subsystem readers → structured map); Design (N independent approaches → scored judge synthesis); Review (dimensions → find → adversarial verify); Research (multi-modal sweep → deep-read → synthesize); Migrate (discover sites → transform each with authorized worktree isolation → verify). For larger tasks, run several sequentially and read each result before choosing the next phase. Keep the main session involved and each fan-out bounded.

Scale to the request: "find any bugs" means a few finders/single-vote verification; "thoroughly audit" or "be comprehensive" means a larger pool, 3–5 vote adversarial pass and synthesis. When unsure, favor completeness for research/review/audit, brevity for quick checks. Suitability is still not authorization. Use deterministic loops/conditionals/fan-out rather than model-driven ad hoc control flow.

## Pipeline and barriers

Default to pipeline for multi-stage work. Use a barrier only when stage N needs cross-item context from ALL prior results: full-set dedup/merge before costly verification; early-exit on zero total findings; comparison prompts referencing "other findings".

Flatten/map/filter alone is not a reason: `pipeline(items, stageA, r => transform([r]).flat(), stageB)`. Conceptually separate stages are not synchronized stages. Cleaner code does not cancel barrier latency: if five finders' slowest takes 3× the fastest, fast finders waste 2/3 waiting.

```js
const a = await parallel(...)
const b = transform(a)        // flatten, map, filter — no cross-item dependency
const c = await parallel(b.map(...))
```

The middle transform needs no barrier; move it into a pipeline stage. When in doubt, pipeline. The following teaching examples retain schema/helper/ellipsis placeholders: define them and check the API before running. Check/filter null after each stage; success-path examples are not failure policies.

## Complete examples

### Verify each dimension as soon as its review finishes

```js
export const meta = {
  name: 'review-changes',
  description: 'Review changed files across dimensions, verify each finding',
  phases: [{ title: 'Review' }, { title: 'Verify' }],
}
const DIMENSIONS = [{key: 'bugs', prompt: '...'}, {key: 'perf', prompt: '...'}]
const results = await pipeline(
  DIMENSIONS,
  d => agent(d.prompt, {label: `review:${d.key}`, phase: 'Review', schema: FINDINGS_SCHEMA}),
  review => parallel(review.findings.map(f => () =>
    agent(`Adversarially verify: ${f.title}`, {label: `verify:${f.file}`, phase: 'Verify', schema: VERDICT_SCHEMA})
      .then(v => ({...f, verdict: v}))
  ))
)
const confirmed = results.flat().filter(Boolean).filter(f => f.verdict?.isReal)
return { confirmed }
// Dimension 'bugs' findings verify while dimension 'perf' is still reviewing. No wasted wall-clock.
```

### Full-set dedup genuinely needs a barrier

```js
const all = await parallel(DIMENSIONS.map(d => () => agent(d.prompt, {schema: FINDINGS_SCHEMA})))
const deduped = dedupeByFileAndLine(all.filter(Boolean).flatMap(r => r.findings))  // <-- genuinely needs ALL at once
const verified = await parallel(deduped.map(f => () => agent(verifyPrompt(f), {schema: VERDICT_SCHEMA})))
```

### Accumulate to a target count

```js
const bugs = []
while (bugs.length < 10) {
  const result = await agent("Find bugs in this codebase.", {schema: BUGS_SCHEMA})
  bugs.push(...result.bugs)
  log(`${bugs.length}/10 found`)
}
```

A schema stage may return null; check/filter it in a real script.

### Gate and context-preserving retry

```js
let fixed = await agent('Find and fix the failing test.', {label: 'fix', gate: 'npm test'})
if (fixed === null) {                        // a non-zero exit failed the agent
  // Resume keeps everything the child already learned. It cannot carry the
  // gate, so re-verification needs its own gated call, in the same tree.
  fixed = await agent('`npm test` is still failing. Fix the cause.', {label: 'fix', resume: 'fix'})
  const verified = await agent('Run `npm test` and report the result. Change nothing.',
    {label: 'verify', phase: 'Verify', gate: 'npm test', effort: 'low'})
  return { passed: verified !== null, summary: fixed }
}
return { passed: true, summary: fixed }
// An LLM judging whether a fix works is a weaker signal than the test suite.
```

### Dedup against seen, diverse judges and consecutive dry rounds

```js
const seen = new Set(), confirmed = []
let dry = 0
while (dry < 2) {                                              // loop-until-dry
  const found = (await parallel(FINDERS.map(f => () =>          // barrier: collect all finders this round
    agent(f.prompt, {phase: 'Find', schema: BUGS})))).filter(Boolean).flatMap(r => r.bugs)
  const fresh = found.filter(b => !seen.has(key(b)))           // dedup vs ALL seen — plain code, not an agent
  if (!fresh.length) { dry++; continue }
  dry = 0; fresh.forEach(b => seen.add(key(b)))
  const judged = await parallel(fresh.map(b => () =>           // every fresh bug judged concurrently...
    parallel(['correctness','security','repro'].map(lens => () =>   // ...each by 3 distinct lenses
      agent(`Judge "${b.desc}" via the ${lens} lens — real?`, {phase: 'Verify', schema: VERDICT})))
      .then(vs => ({ b, real: vs.filter(Boolean).filter(v => v.real).length >= 2 }))))
  confirmed.push(...judged.filter(v => v.real).map(v => v.b))
}
return confirmed
// dedup vs `seen`, NOT `confirmed` — else judge-rejected findings reappear every round and it never converges.
```

## Quality and completeness

- Adversarial verify: N independent skeptics per finding, each asked to REFUTE; discard when a majority refutes. This prevents plausible-but-wrong findings.

```js
const votes = await parallel(Array.from({length: 3}, () => () =>
  agent(`Try to refute: ${claim}. Default to refuted=true if uncertain.`, {schema: VERDICT})))
const survives = votes.filter(Boolean).filter(v => !v.refuted).length >= 2
```

- Verify by running, not asking: gate testable claims, instead of another model's approval.
- Perspective-diverse verification: correctness/security/perf/reproduction lenses, not N identical refuters. Diversity catches what redundancy misses.
- Judge panel: N independent attempts (MVP-first/risk-first/user-first), parallel scored judges, then synthesize from the winner and the best runners-up ideas. Prefer a broad solution space to repeated iteration of one attempt.
- Loop-until-dry: for unknown-size discovery, continue until K consecutive rounds have no new findings. A simple count < N misses the tail.
- Multi-modal sweep: independent by-container/by-content/by-entity/by-time searches, blind to each other's findings when one angle cannot cover everything.
- Completeness critic: final pass asks "modality not run, claim unverified, source unread?" and supplies the next work-list.
- No silent caps: log dropped coverage from top-N/no-retry/sampling; sampling is not comprehensive.

These are not exhaustive: combine tournament/self-repair/staged escalation within authorization. Filter failures/null at every stage and inspect actual evidence; another LLM's approval is not a passing test.
