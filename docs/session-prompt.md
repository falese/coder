# Coder — Session Prompt

> Update this file before each coding session. Hand it to the agent alongside CLAUDE.md.
> Keep CLAUDE.md open in every session. Reference @docs/spec.md only for the sections relevant to the active issue.

---

## How to use this template

1. Fill in **Active issue** and **Scope** below
2. Copy the relevant spec sections from `@docs/spec.md` into **Spec context**
3. Update **Current file tree** to reflect actual state
4. Hand `CLAUDE.md` + this file to the coding agent
5. After the session, update **Current state** in `CLAUDE.md` and any resolved decisions in `docs/spec.md`

---

## Session: 2026-04-04

### Active issues (landing together)

**[#32](https://github.com/falese/coder/issues/32) — feat: adaptive per-prompt temperature schedule**
**[#33](https://github.com/falese/coder/issues/33) — feat: self_improve_* log events + manifest history fields**

These two P2 enhancements to the existing SSD orchestrator land in a single PR. The orchestrator
(`src/adaptors/self-improve.ts`) and CLI wiring (`src/commands/adaptor.ts`) already exist from #31.
No new files needed — this session only extends existing code.

Full context: `@docs/recursive-self-improvement-proposal.md`

Deliverables:
1. **#32** — Replace the stub `temp = 0.7` in `runSelfImprove` with a per-prompt temperature map derived from `EvalRecord[]` composites
2. **#33** — Emit the 4 `self_improve_*` log events; write `self_improve_rounds`, `self_improve_score_history`, `self_improve_last_run` to `manifest.json` after the run; update `coder adaptor info` to display new fields when present
3. Tests covering both enhancements (new cases in `tests/unit/self-improve.test.ts`)
4. Zod schema update in `src/adaptors/types.ts` for the 3 new manifest fields

---

### Context: what already exists

- `src/adaptors/self-improve.ts` — `runSelfImprove(opts, deps)` — fully implemented with dep injection
  - Line 117: `const temp = opts.temperature === "adaptive" ? 0.7 : opts.temperature;` ← **replace for #32**
  - Already imports `runEval`, `EvalSummary`, `SampleResult`
  - Already has `logger` import? **No** — need to add: `import { logger } from "../observability/logger.js";`
- `src/adaptors/types.ts` — `ManifestSchema` (Zod) + `AdaptorManifest` type — 3 new optional fields needed for #33
- `src/commands/adaptor.ts` — `info` subcommand at line 81 — needs to display new fields when present
- `src/eval/runner.ts` — `EvalRecord { prompt, scores, composite, generatedCode, diagnostics }` — `composite` is the per-prompt score needed for the temp schedule
- `src/observability/logger.ts` — `logger.logEvent({ event, ts, ...fields })` — existing structured logger

---

### Open questions for this session

- Does `sampleCompletions` accept per-prompt temperatures or a single scalar? **Current signature:** `sampleCompletions(prompts, k, temperature: number, ...)` — single scalar. For #32 the approach is to **group prompts by resolved temperature** and call `sampleFn` once per group (or just call it per-prompt if k is the binding variable). Simplest: build a `Map<number, string[]>` (temp → prompts), call `sampleFn` once per group, concat results.
- Where to write manifest history after run? After the round loop, read `manifest.json`, update the three fields, write back. Use the existing manifest path: `join(opts.adaptorDir, "manifest.json")`.
- Does `logger.logEvent` accept any shape? Yes — it takes a record of unknown fields; the structured logger just serialises whatever it receives. Use `ts: new Date().toISOString()` for all events.

---

## Spec context

### #32 — Adaptive per-prompt temperature schedule

Per-prompt schedule (from proposal):

| Current composite | Temperature |
|---|---|
| ≥ 0.9 (mastered) | 0.3 |
| 0.5 – 0.9 (partial) | 0.7 |
| < 0.5 (failing) | 1.0 |

**Round 1 fallback**: no per-prompt scores yet. Use the value of `opts.temperature`:
- If `opts.temperature === "adaptive"` → fall back to `0.7` for all prompts in round 1
- If `opts.temperature` is a number → use that number for all prompts (disables adaptive for all rounds)

**Algorithm change in `runSelfImprove`**:

1. After the initial `evalFn` call that establishes `currentScore`, store the per-prompt composites:
   ```typescript
   let perPromptComposites: Map<string, number> | null = null;
   // After baseline eval:
   const baselineSummary = await evalFn(...);
   perPromptComposites = new Map(baselineSummary.records.map(r => [r.prompt, r.composite]));
   ```

2. Inside the round loop, replace `const temp = opts.temperature === "adaptive" ? 0.7 : opts.temperature;` with:
   ```typescript
   function resolveTemp(promptStr: string): number {
     if (opts.temperature !== "adaptive") return opts.temperature;
     const c = perPromptComposites?.get(promptStr) ?? 0.7; // round-1 fallback
     if (c >= 0.9) return 0.3;
     if (c >= 0.5) return 0.7;
     return 1.0;
   }
   ```

3. Group prompts by resolved temperature, call `sampleFn` once per group:
   ```typescript
   // Build temp → prompts groups
   const groups = new Map<number, string[]>();
   for (const p of prompts) {
     const t = resolveTemp(p);
     const g = groups.get(t) ?? [];
     g.push(p);
     groups.set(t, g);
   }
   // Sample each group and concat
   const allSamples: SampleResult[] = [];
   for (const [groupTemp, groupPrompts] of groups) {
     const s = await sampleFn(groupPrompts, opts.samplesPerPrompt, groupTemp, ...);
     allSamples.push(...s);
   }
   ```

4. After the post-training `evalFn` call (scoreAfter), update per-prompt composites for next round:
   ```typescript
   if (committed) {
     perPromptComposites = new Map(postSummary.records.map(r => [r.prompt, r.composite]));
   }
   // (on rollback, keep the previous perPromptComposites)
   ```

**Note**: the `evalFn` return needs to be captured as `EvalSummary` (not just `.meanComposite`) in both baseline and post-training calls to get `records[]`.

### #33 — Log events + manifest history

**4 log events** to emit via `logger.logEvent(...)`:

```typescript
// At top of each round:
logger.logEvent({ event: "self_improve_round_start", ts: new Date().toISOString(),
  round, total_rounds: opts.rounds, adaptor: opts.adaptorDir });

// After sampleFn (once per temp group or once total — once total is fine):
logger.logEvent({ event: "self_improve_sample", ts: new Date().toISOString(),
  round, generated: allSamples.length, passed: filtered.length,
  top_composite: Math.max(...allSamples.map(s => s.composite), 0) });

// After gate decision:
logger.logEvent({ event: "self_improve_round_end", ts: new Date().toISOString(),
  round, score_before: scoreBefore, score_after: scoreAfter,
  delta: scoreAfter - scoreBefore, committed });

// After round loop ends:
logger.logEvent({ event: "self_improve_complete", ts: new Date().toISOString(),
  rounds_committed: results.filter(r => r.committed).length,
  rounds_total: opts.rounds, final_score: results.at(-1)?.scoreAfter ?? 0 });
```

**3 new manifest fields** — write after the round loop:
```typescript
// Read, update, write manifest
const manifestPath = join(opts.adaptorDir, "manifest.json");
if (existsSync(manifestPath)) {
  const manifest = JSON.parse(readFileSync(manifestPath, "utf-8")) as Record<string, unknown>;
  const scoreHistory = [
    currentScoreBeforeRound1,   // baseline
    ...results.map(r => r.scoreAfter),
  ];
  manifest.self_improve_rounds = results.filter(r => r.committed).length;
  manifest.self_improve_score_history = scoreHistory;
  manifest.self_improve_last_run = new Date().toISOString();
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + "\n");
}
```

**Zod schema update** (`src/adaptors/types.ts`):
```typescript
export const ManifestSchema = z.object({
  // ... existing fields ...
  self_improve_rounds: z.number().int().nonnegative().optional(),
  self_improve_score_history: z.array(z.number()).optional(),
  self_improve_last_run: z.string().optional(),
});
```

**`coder adaptor info` update** (`src/commands/adaptor.ts`, `info` subcommand):
```typescript
// After existing fields, display if present:
if (manifest.self_improve_rounds !== undefined) {
  process.stdout.write(`SSD rounds:  ${String(manifest.self_improve_rounds)}\n`);
}
if (manifest.self_improve_last_run !== undefined) {
  process.stdout.write(`SSD last run: ${manifest.self_improve_last_run}\n`);
}
if (manifest.self_improve_score_history !== undefined) {
  process.stdout.write(`SSD history: ${manifest.self_improve_score_history.map(s => s.toFixed(3)).join(" → ")}\n`);
}
```

### New tests to write

Add to `tests/unit/self-improve.test.ts`:

1. **Adaptive temp — mastered prompt (composite ≥ 0.9) → 0.3**: mock `evalFn` to return a summary with a prompt at composite=0.95 in baseline; assert `sampleFn` is called with temperature 0.3 for that prompt's group in round 1.
2. **Adaptive temp — failing prompt (composite < 0.5) → 1.0**: similar setup with composite=0.3; assert sampleFn called with 1.0.
3. **Fixed temperature disables adaptive**: pass `temperature: 0.5` (number); assert all `sampleFn` calls use 0.5 regardless of per-prompt composites.
4. **Manifest history written after run**: verify `manifest.json` in the temp adaptor dir contains `self_improve_rounds`, `self_improve_score_history`, `self_improve_last_run` after a successful run.
5. **Log event emitted**: assert `logger.logEvent` was called with `event: "self_improve_complete"` after the loop.

**Note on mocking logger**: spy on `logger.logEvent` via `spyOn(logger, "logEvent")` — same pattern as other tests that verify log output.

---

## Current file tree

```
./src/adaptors/manager.ts
./src/adaptors/self-improve.ts      ← MODIFY (adaptive temp + log events + manifest write)
./src/adaptors/types.ts             ← MODIFY (3 new optional Zod fields)
./src/commands/adaptor.ts           ← MODIFY (info subcommand: display new fields)
./src/eval/runner.ts                (read-only — EvalRecord shape needed)
./src/observability/logger.ts       (read-only — logEvent signature needed)
./tests/unit/self-improve.test.ts   ← MODIFY (5 new test cases)
```

---

## Existing tests (summary)

313 tests passing across 28 files. Do not duplicate existing coverage.

New tests to write this session (additions to `tests/unit/self-improve.test.ts`):
- Adaptive temp: mastered prompt → 0.3
- Adaptive temp: failing prompt → 1.0
- Fixed temperature → disables adaptive
- Manifest fields written after run
- `self_improve_complete` log event emitted
