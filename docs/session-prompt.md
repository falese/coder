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

## Session: 2026-04-05

### Active issues (landing together)

**[#42](https://github.com/falese/coder/issues/42) — fix: adaptive training iter budget in SSD**
**[#43](https://github.com/falese/coder/issues/43) — fix: loss-spike early abort in SSD training**
**[#44](https://github.com/falese/coder/issues/44) — fix: lower learning rate for high-quality checkpoints**

All three are training stability fixes in the SSD loop. No new CLI commands, no new config keys.
Land in a single PR. Priority order: #44 first (2 lines), then #42 (formula + test), then #43 (most involved).

---

## Spec context

### #44 — Lower LR for high-quality checkpoints

In `runSelfImprove`, compute `learningRate` per-round from `currentScore` before building `TrainConfig`:

```typescript
const learningRate = currentScore >= 0.7 ? 5e-5 : 1e-4;
```

Pass into `config.lora.learning_rate`. Also log it in the `self_improve_round_start` event so it's
visible in the log.

**Files:** `src/adaptors/self-improve.ts` only.

**Tests:** assert `trainFn` receives `learning_rate = 5e-5` when `scoreBefore >= 0.7`, and `1e-4` when below.

---

### #42 — Adaptive iter budget

In `runSelfImprove`, compute `iters` from target epoch count after building `merged`:

```typescript
const TARGET_EPOCHS = 3;
const MAX_ITERS = 300;
const MIN_ITERS = 10;
const stepsPerEpoch = Math.ceil(merged.length / BATCH_SIZE); // BATCH_SIZE = 2
const iters = Math.max(MIN_ITERS, Math.min(TARGET_EPOCHS * stepsPerEpoch, MAX_ITERS));
```

`TARGET_EPOCHS`, `MAX_ITERS`, `MIN_ITERS`, `BATCH_SIZE` as module-level constants — not hardcoded inline.

**Files:** `src/adaptors/self-improve.ts` only.

**Tests:**
- Small merged dataset (e.g. 4 records) → iters = `max(MIN_ITERS, 3 * ceil(4/2))` = `max(10, 6)` = 10
- Large merged dataset (e.g. 300 records) → iters capped at MAX_ITERS (300)
- Mid-size dataset (e.g. 20 records) → iters = `3 * ceil(20/2)` = 30

---

### #43 — Loss-spike early abort

**Goal:** detect training divergence mid-run, abort before saving bad weights, skip post-eval.

**New error type** in `src/training/runner.ts`:

```typescript
export class TrainingDivergedError extends Error {
  constructor(public readonly lossAtAbort: number, public readonly iterAtAbort: number) {
    super(`Training diverged: loss ${String(lossAtAbort)} at iter ${String(iterAtAbort)}`);
    this.name = "TrainingDivergedError";
  }
}
```

**Detection logic** in `runMlxTrain` — after logging each `training_step`, check the rolling window:

```typescript
// Track last 3 losses for rolling mean
const recentLosses: number[] = [];
// ...in the per-line loop, after parsing:
recentLosses.push(parsed.loss);
if (recentLosses.length > 3) recentLosses.shift();

if (recentLosses.length === 3) {
  const rollingMean = recentLosses.slice(0, 2).reduce((a, b) => a + b, 0) / 2;
  const latest = recentLosses[2];
  if (latest > 1.5 * rollingMean && latest > 0.8) {
    proc.kill(); // terminate mlx_lm
    throw new TrainingDivergedError(latest, parsed.iter);
  }
}
```

Wait for loss to stabilise: only check after iter 20 (skip early training noise).

**Abort handling** in `runSelfImprove` — catch `TrainingDivergedError` after `await trainFn(...)`:

```typescript
try {
  await trainFn(config, opts.dryRun);
} catch (err) {
  if (err instanceof TrainingDivergedError) {
    // Restore backup immediately — skip post-eval
    if (existsSync(backupFile)) {
      copyFileSync(backupFile, checkpointFile);
      unlinkSync(backupFile);
    }
    logger.logEvent({
      event: "self_improve_round_end",
      ts: new Date().toISOString(),
      round,
      score_before: scoreBefore,
      score_after: scoreBefore, // unchanged — rolled back
      delta: 0,
      committed: false,
    });
    results.push({ round, generated: allSamples.length, filtered: filtered.length,
      scoreBefore, scoreAfter: scoreBefore, committed: false });
    currentScore = scoreBefore;
    continue;
  }
  throw err; // re-throw non-divergence errors
}
```

**Log event addition** — add `abort_reason` field to `self_improve_round_end` when aborting.
The existing `SelfImproveRoundEndEvent` interface needs an optional `abort_reason?: string` field.

**Files to change:**

| File | Change |
|---|---|
| `src/training/runner.ts` | Add `TrainingDivergedError`; detection logic in `runMlxTrain` |
| `src/adaptors/self-improve.ts` | Catch `TrainingDivergedError`; restore backup; log abort; continue loop |
| `src/observability/types.ts` | Add `abort_reason?: string` to `SelfImproveRoundEndEvent` |
| `tests/unit/training-runner.test.ts` | Test divergence detection: spike triggers error, stable does not |
| `tests/unit/self-improve.test.ts` | Test abort path: backup restored, loop continues, no post-eval |

---

## Current file tree

```
src/adaptors/self-improve.ts        ← MODIFY (#42, #43, #44)
src/training/runner.ts              ← MODIFY (#43 TrainingDivergedError + detection)
src/observability/types.ts          ← MODIFY (#43 abort_reason field)
tests/unit/self-improve.test.ts     ← MODIFY (#42, #43, #44 new tests)
tests/unit/training-runner.test.ts  ← MODIFY (#43 divergence detection tests)
```

---

## TDD order

Write failing tests first, then implementation.

**#44 tests (self-improve.test.ts):**
1. `scoreBefore >= 0.7` → `trainFn` called with `learning_rate = 5e-5`
2. `scoreBefore < 0.7` → `trainFn` called with `learning_rate = 1e-4`

**#42 tests (self-improve.test.ts):**
3. Small dataset (4 records) → iter count floored at MIN_ITERS (10)
4. Large dataset (300 records) → iter count capped at MAX_ITERS (300)
5. Mid dataset (20 records) → iter count = 30

**#43 tests:**
6. (training-runner.test.ts) Loss stable → no error thrown
7. (training-runner.test.ts) Loss spikes at iter 30+ → `TrainingDivergedError` thrown
8. (training-runner.test.ts) Loss spikes before iter 20 → no error (too early)
9. (self-improve.test.ts) `TrainingDivergedError` → backup restored, loop continues, `committed: false`
10. (self-improve.test.ts) Non-divergence error from `trainFn` → re-thrown (not swallowed)

---

## Existing tests (summary)

367 tests passing across 30 files. Do not duplicate existing coverage.

Key constraint: existing `training-runner.test.ts` tests mock the subprocess — the divergence
detection tests will need to mock the loss line stream similarly.
