# Proposal: Recursive Self-Improvement via Self-Distillation

> Based on: [Embarrassingly Simple Self-Distillation Improves Code Generation](https://arxiv.org/abs/2604.01193)
> (Zhang, Bai, Zheng, Jaitly, Collobert, Zhang — April 2026)

---

## Overview

The paper introduces **Simple Self-Distillation (SSD)**: sample N solutions from the model itself
at elevated temperature, fine-tune on the raw output with standard SFT — no teacher model, no reward
model, no RL, no execution verifier. Applied to Qwen3-30B-Instruct it raises pass@1 on
LiveCodeBench v6 from 42.4 % → 55.3 %, with gains concentrated on harder problems, at 4B / 8B / 30B
scale.

`coder` is a near-perfect host for this technique. Every component the paper had to omit already
exists here:

| SSD requirement (paper) | `coder` equivalent |
|---|---|
| Problem prompts | `data/eval.jsonl` per adaptor |
| Sample generator | `runMlxBuffered` / `runMlxStream` |
| Verifier (absent in paper) | `runEval` — TSC + ESLint + test suite composite |
| Fine-tuning loop | `runMlxTrain` (LoRA via `mlx_lm.lora`) |
| Data pipeline | `coder data deduplicate / validate / split` |
| Quality metric | `computeComposite` (0–1 score already tracked) |

Because `coder` **does** have a verifier, we can apply a supervised filter before retraining —
strictly stronger signal than the paper's unverified SSD, while remaining simpler than RL.

---

## Core Idea: The SSD Loop

The algorithm is a fixed-point iteration. Each round:

1. **Sample** — For every prompt in `data/eval.jsonl`, generate K completions using the current
   model + adaptor at temperature T > 0 (exploration mode).
2. **Score** — Run each completion through the existing eval harness (`runTscCheck`,
   `runEslintCheck`, `runTestsCheck`), compute `computeComposite`.
3. **Filter** — Keep completions whose composite score ≥ threshold θ. Discard the rest.
4. **Package** — Write passing `{ prompt, completion }` pairs as JSONL. Merge with the original
   `data/train.jsonl`, deduplicate, validate.
5. **Retrain** — Call `runMlxTrain` on the merged dataset (LoRA, resume from current checkpoint).
6. **Gate** — Re-run `coder adaptor eval` on the standard eval set. If mean composite ≥ previous
   round score, commit the new weights. If not, roll back to the previous checkpoint.
7. **Repeat** for N rounds or until the eval score plateaus.

### Why it works — locks vs forks

The paper traces the gains to a *precision-exploration conflict* in token generation. Some tokens
demand precision (**locks**: TypeScript type annotations, API method names, import paths, JSX tag
names). Others reward exploration (**forks**: algorithm choice, component structure, variable naming).
Standard decoding uses a single temperature for everything — a compromise that hurts both modes.

Training on temperature-shifted samples reshapes the model's output distribution in a
context-dependent way: it suppresses distractor tails aggressively at locks while preserving useful
diversity at forks. The LoRA fine-tuning then internalises this sharpened distribution.

In the TypeScript / React domain, this maps clearly:
- **Locks** → `React.FC<Props>`, `.map(`, `useState<`, `interface Foo {`
- **Forks** → whether to use `useCallback`, the shape of a reducer, how to handle a loading state

---

## `coder`-specific enhancement: adaptive per-prompt temperature

The paper uses a single global temperature. `coder` can do better. Because the eval harness scores
every prompt individually, we know which prompts the model has already mastered (composite ≈ 1.0)
and which it consistently fails (composite ≈ 0).

Proposed per-prompt temperature schedule:

| Current composite | Strategy | Temperature |
|---|---|---|
| ≥ 0.9 (mastered) | lock — reinforce existing knowledge | 0.3 |
| 0.5 – 0.9 (partial) | balanced exploration | 0.7 |
| < 0.5 (failing) | high exploration, need diverse paths | 1.0 |

This mirrors the paper's theoretical insight at prompt granularity rather than token granularity,
without requiring per-token temperature control (which `mlx_lm` does not expose).

---

## New command

```
coder adaptor self-improve <name> [options]

Options:
  --rounds <n>         SSD iterations to run (default: 3)
  --samples <k>        Completions to generate per prompt per round (default: 8)
  --temperature <t>    Global sampling temperature; overrides adaptive schedule (default: adaptive)
  --threshold <score>  Min composite score to include a sample in training data (default: 0.7)
  --model <path>       Base model path (falls back to config default_model)
  --dry-run            Honour CODER_DRY_RUN=1; skip actual inference and training
```

Example:
```
coder adaptor self-improve react-ts --rounds 3 --samples 8 --threshold 0.7
```

Expected output (per round):
```
Round 1/3: sampling 8×N prompts...
  generated: 144  filtered (≥0.70): 87  kept: 87
  training on 231 examples (87 new + 144 original)...
  eval: 0.920 → 0.941  (+0.021)  [committed]

Round 2/3: sampling 8×N prompts...
  generated: 144  filtered (≥0.70): 102  kept: 102
  training on 246 examples (102 new + 144 original)...
  eval: 0.941 → 0.947  (+0.006)  [committed]

Round 3/3: sampling 8×N prompts...
  ...
  eval: 0.947 → 0.944  (-0.003)  [rolled back]

Self-improvement complete. Final score: 0.947 (rounds committed: 2/3)
```

---

## Implementation plan

### Phase 1 — Prerequisites (unblocked, small surface)

**1a. Add temperature / top-p to `GenerateOptions`**

`src/inference/types.ts` — extend the interface:
```typescript
export interface GenerateOptions {
  // ... existing fields ...
  temperature?: number;   // default undefined → mlx_lm default (0.0 greedy)
  topP?: number;          // default undefined → mlx_lm default
}
```

`src/inference/mlx-runner.ts` — pass through to `mlx_lm.generate` args:
```
if (opts.temperature !== undefined) args.push("--temp", String(opts.temperature));
if (opts.topP !== undefined)        args.push("--top-p", String(opts.topP));
```

**1b. Extract a reusable `sampleCompletions` function**

`src/inference/sampler.ts` — new file:
```typescript
export interface SampleResult {
  prompt: string;
  completion: string;
  composite: number;
}

export async function sampleCompletions(
  prompts: string[],
  k: number,
  temperature: number,
  opts: Pick<GenerateOptions, "model" | "adaptor">,
  evalOpts: { adaptorDir: string },
): Promise<SampleResult[]>
```

Generates K completions per prompt, scores each with `runTscCheck` / `runEslintCheck` /
`runTestsCheck`, returns scored pairs. This is purely additive — no changes to existing callers.

---

### Phase 2 — Self-improvement orchestrator

**New file: `src/adaptors/self-improve.ts`**

```typescript
export interface SelfImproveOptions {
  adaptorDir: string;
  modelPath: string;
  rounds: number;
  samplesPerPrompt: number;
  threshold: number;
  temperature: number | "adaptive";
  dryRun: boolean;
}

export interface RoundResult {
  round: number;
  generated: number;
  filtered: number;
  scoreBefore: number;
  scoreAfter: number;
  committed: boolean;
}

export async function runSelfImprove(opts: SelfImproveOptions): Promise<RoundResult[]>
```

The orchestrator:
1. Loads `data/eval.jsonl` and `data/train.jsonl` from `adaptorDir`
2. Per round:
   a. Computes adaptive temperature per prompt (based on last round's per-prompt scores)
   b. Calls `sampleCompletions` for each prompt
   c. Filters by `opts.threshold`
   d. Writes filtered pairs to a temp JSONL, deduplicates against `train.jsonl`
   e. Calls `runMlxTrain` with the merged dataset
   f. Calls `runEval` to measure new composite score
   g. If improved: copies new adaptor weights over previous; bumps manifest version
   h. If regressed: restores previous weights (checkpoint already exists via `--resume-adapter-file`)
3. Returns `RoundResult[]` for the CLI to render

**Checkpoint strategy**: Before each round, copy `adapters.safetensors` to `adapters.safetensors.bak`.
Rollback = restore from `.bak`. This is safe because `mlx_lm.lora` already supports
`--resume-adapter-file`, so the round's training always continues from the current round's start
state.

---

### Phase 3 — CLI integration

**`src/commands/adaptor.ts`** — add `self-improve` subcommand alongside the existing
`install / update / remove / train / eval` tree.

```typescript
.command("self-improve <name>")
.description("recursively fine-tune an adaptor on its own high-scoring outputs")
.option("--rounds <n>", "SSD iterations", "3")
.option("--samples <k>", "completions per prompt per round", "8")
.option("--temperature <t>", "sampling temperature (number or 'adaptive')", "adaptive")
.option("--threshold <score>", "minimum composite score to keep a sample", "0.7")
.option("--model <path>", "base model path")
.action(async (name, opts) => { ... })
```

---

### Phase 4 — Observability

New log events to emit (extending the existing structured logger):

```json
{ "event": "self_improve_round_start",  "round": 1, "total_rounds": 3, "adaptor": "react-ts" }
{ "event": "self_improve_sample",       "round": 1, "prompt_idx": 0, "temperature": 0.7,
                                         "generated": 8, "passed": 5, "top_composite": 0.87 }
{ "event": "self_improve_round_end",    "round": 1, "score_before": 0.920, "score_after": 0.941,
                                         "delta": 0.021, "committed": true }
{ "event": "self_improve_complete",     "rounds_committed": 2, "rounds_total": 3,
                                         "final_score": 0.947 }
```

New field in `manifest.json`:
```json
{
  "self_improve_rounds": 2,
  "self_improve_score_history": [0.920, 0.941, 0.947, 0.944],
  "self_improve_last_run": "2026-04-04T14:00:00.000Z"
}
```

---

## What this does NOT require

- No changes to `runMlx` / `runMlxBuffered` / `runMlxStream` (only `GenerateOptions` interface
  grows by two optional fields)
- No changes to the eval harness — it already returns `EvalRecord.generatedCode` and per-prompt
  composite scores
- No changes to the data pipeline — `deduplicate` and `validate` are used as-is
- No new Python dependencies
- No hosted infrastructure
- No multi-adaptor support — one adaptor improves itself, consistent with the one-adaptor-per-session
  constraint

---

## Risks and mitigations

| Risk | Mitigation |
|---|---|
| Training on bad samples degrades the adaptor | Composite threshold gate + per-round checkpoint rollback |
| Distributional collapse (model converges to one pattern) | Adaptive temperature increases for failing prompts; `deduplicate` prevents identical samples dominating |
| Memory pressure on M3 during 8× sampling | Generate samples sequentially; no concurrency increase vs current `runEval` |
| Eval prompts leak into training data | Use separate `eval.jsonl` for gating and `train.jsonl` for training; never merge eval set into training data |
| Overfitting to eval set if threshold is too low | Default θ=0.7 requires genuine multi-dimension pass; recommend keeping eval.jsonl ≥ 20 prompts |

---

## Proposed backlog issues

| # | Title | Depends on | Priority |
|---|---|---|---|
| #21 | `feat: temperature/top-p passthrough in GenerateOptions` | — | P0 (unlocks everything) |
| #22 | `feat: sampleCompletions — scored multi-sample generator` | #21 | P0 |
| #23 | `feat: coder adaptor self-improve — SSD orchestrator` | #22 | P1 |
| #24 | `feat: adaptive per-prompt temperature schedule` | #23 | P2 |
| #25 | `feat: self_improve_* log events + manifest history fields` | #23 | P2 |

#21 and #22 are small, test-driven, and unblock all downstream work. They can land in a single PR.
#23 is the main feature. #24 and #25 are enhancements that improve quality and observability.

---

## Relationship to existing backlog

This proposal sits between items #9 (adaptor eval) and #11 (React/TS adaptor pack) in the current
priority order. It depends on the eval harness (already done) and training runner (already done).
The react-ts adaptor at eval_pass_rate=0.920 is the immediate beneficiary and provides a concrete
benchmark: if self-improvement raises the composite above 0.960 in three rounds, that validates the
approach before applying it to the GraphQL adaptor pack (#12).

Suggested insertion in backlog:

```
5.  #4  Chat REPL
6.  #6  Adaptor install/list/update
7.  #7  Data JSONL pipeline (design spike first)
8.  #8  Adaptor train
9.  #9  Adaptor eval
10. #21 temperature/top-p passthrough          ← new
11. #22 sampleCompletions                      ← new
12. #23 coder adaptor self-improve             ← new
13. #24 adaptive temperature schedule          ← new (P2)
14. #11 React/TS adaptor pack
15. #12 GraphQL adaptor pack
```
