# Self-Improve Feature Review

> Written: 2026-04-05  
> Based on: two `self-improve` runs against `react-ts-v2` (3 rounds each)

---

## What the feature does

`coder adaptor self-improve` implements a Successive Self-Distillation (SSD) loop. Each round:

1. **Sample** — generate K completions per eval prompt using the current adaptor weights, score each through the composite eval harness (TSC 40% / ESLint 30% / test-pass 30%)
2. **Filter** — keep completions above a composite threshold (default 0.7)
3. **Merge** — combine filtered completions with the original `train.jsonl`, deduplicate
4. **Train** — retrain the LoRA adaptor from the merged dataset (fixed 100 iters, lr=1e-4, batch=2)
5. **Gate** — re-evaluate; commit new weights only if `score_after >= score_before`, otherwise restore backup

The adaptive temperature schedule assigns lower temperatures (0.3) to prompts the model already handles well (composite ≥0.9), medium (0.7) to middling prompts, and high (1.0) to weak prompts — targeting exploration where the model most needs it.

---

## Run results

### react-ts-v2 run (2026-04-05, 3 rounds, --samples 8, --threshold 0.7)

| Round | Score Before | Score After | Delta | Filter rate | Final loss | Result |
|-------|-------------|-------------|-------|-------------|------------|--------|
| 1 | 0.710 | 0.697 | -0.013 | 33% (79/239) | 0.407 | rolled back |
| 2 | 0.710 | 0.757 | **+0.047** | 35% (83/240) | 0.354 | **committed** |
| 3 | 0.757 | 0.570 | -0.187 | **58% (139/240)** | **1.346** | rolled back |

**Final score: 0.757** (1/3 rounds committed)  
**Net gain: +4.7pp** over starting eval_pass_rate of 0.710  
**Baseline (no adaptor): 0.493** — adaptor still provides +26.4pp lift over base model

Score history in manifest: `[0.710, 0.697, 0.757, 0.570]`  
Manifest version bumped correctly: 2.0.1 → 2.0.5 (4 patch bumps across both runs)

---

## Successes

### 1. The rollback gate works and is load-bearing

Round 3 ended at 0.570 — a -0.187 regression. Without rollback, the feature would have been destructive. The backup/restore logic (`adapters.safetensors.bak`) executed correctly in both rollback cases and left weights in a valid state. This is the most important correctness property of the feature and it held.

### 2. Net improvement is real

Starting from 0.710 and finishing at 0.757 represents a meaningful uplift for a single committed SSD round. The baseline is 0.493, so the adaptor continues to provide substantial lift over the base model. The loop found genuine signal in round 2.

### 3. Adaptive temperature is structurally correct

The per-prompt temperature assignment correctly differentiates between strong and weak prompts. With 29 eval prompts across three temperature buckets, grouping and sampling logic executed without errors and the groups were processed correctly.

### 4. Observability is complete

All four log events (`self_improve_round_start`, `self_improve_sample`, `self_improve_round_end`, `self_improve_complete`) fired correctly with accurate payloads. The `training_step` loss curve is logged at 10-iter intervals, giving full visibility into training dynamics. Manifest history fields (`self_improve_score_history`, `self_improve_last_run`, `self_improve_rounds`) were written correctly.

### 5. End-to-end pipeline integrity

The full pipeline — sample → score → filter → merge → deduplicate → train → gate → manifest update — ran without crashes across 6 total rounds (2 runs × 3 rounds), including graceful handling of checkpoint resumption via `--resume-adapter-file`.

---

## Challenges

### Challenge 1: Training instability on large filter batches (round 3)

**What happened:** Round 3 passed 139/240 samples (58% filter rate) vs ~33–35% in earlier rounds. Final training loss was 1.346 — roughly 3× the loss of round 2 (0.354). The eval score dropped from 0.757 to 0.570.

**Root cause hypothesis:** The fixed 100-iter budget interacts badly with batch size. When the filtered dataset is large, 100 iterations may not be enough to converge, and with mlx_lm's `--resume-adapter-file` the model is resuming from a checkpoint that already partially learned this domain — making the learning rate of 1e-4 potentially too aggressive for fine-tuning from a strong starting point. The loss spiking to 1.346 at iter 100 (vs steady descent in round 2) suggests gradient instability, not just insufficient convergence.

**Why the filter rate was high:** The adaptive temperature schedule assigns temp=1.0 to prompts with composite < 0.5. After round 2 committed, some prompts may have shifted into the "needs improvement" bucket, increasing the number of high-temperature samples — which, at temp=1.0, produce more varied and potentially noisier completions. A higher proportion of them clearing the 0.7 threshold means the training batch skewed toward borderline-quality or distribution-drift samples.

### Challenge 2: Binary composite score creates a cliff

**What happened:** Each scorer dimension (TSC, ESLint, tests) is binary (0 or 1). Composite = `tsc*0.4 + eslint*0.3 + tests*0.3`. This means only 4 possible composite values exist: 0.0, 0.3, 0.4, 0.7, 1.0. The filter threshold of 0.7 therefore passes only completions that pass TSC + ESLint + tests (1.0) or TSC + tests (0.7) — nothing in between.

This makes the filter a hard cliff: a completion that gets TSC right but has one unused-variable ESLint warning is scored identically to one that type-checks incorrectly. Samples near the threshold boundary have uncertain training value, and the threshold cannot be tuned finely because the score distribution is sparse.

### Challenge 3: Eval set is too small for stable gating

**What happened:** 29 eval prompts means each prompt contributes ~3.4% to the composite mean. The round 2 commit delta (+0.047) corresponds to roughly 1–2 prompts flipping from fail to pass. The round 1 rollback (-0.013) could be a single prompt regressing. This is a noisy signal for a commit/rollback decision.

The gate `score_after >= score_before` is a strict threshold — any regression, however small and regardless of noise, causes rollback. With a 29-prompt eval set, this gate is being asked to make binary decisions based on movements that could be within measurement noise.

### Challenge 4: Sampling from eval prompts creates distribution bias

**What happened:** The loop samples new training data by running the model against the same 29 prompts used for eval. This means the training and eval distributions are identical. The model is effectively being trained on its own outputs against the evaluation benchmark, which risks overfitting to the specific eval prompts rather than generalising to the domain.

Round 3 illustrates this: the model saw the same eval prompts for 2 previous rounds of sampling and training. By round 3, it had generated ~480 prior completions from those same 29 prompts; the training signal is now largely redundant with what it already knows, while genuine domain generalisation is not being tested.

### Challenge 5: Fixed training hyperparameters

All rounds use identical config: `iters=100, batch_size=2, lr=1e-4`. No adaptation to:
- Dataset size (round 3 trained on ~80 more samples than round 2, same iter budget)
- Training loss at convergence (no early stopping)
- Current model quality (same lr whether starting from 0.5 or 0.75)

---

## Hypotheses and proposed improvements

### H1: Adaptive iteration budget based on dataset size

**Hypothesis:** Training instability in round 3 is primarily caused by a dataset too large for the fixed iter budget relative to batch size. With batch=2 and 79 train pairs, 100 iters = ~2.5 epochs. With 139+original pairs, coverage drops to ~1.2 epochs — insufficient convergence before the checkpoint is saved.

**Proposed fix:** Compute `iters` dynamically:

```typescript
const targetEpochs = 3;
const stepsPerEpoch = Math.ceil(merged.length / config.lora.batch_size);
const iters = Math.min(targetEpochs * stepsPerEpoch, 300); // cap at 300
```

This keeps effective training epochs stable regardless of dataset size.

### H2: Loss-spike early abort

**Hypothesis:** A final loss above a threshold (e.g. 2× the round 1 loss, or an absolute >1.0) is a reliable signal that training diverged and the gate will roll back anyway. Aborting early saves 5–10 minutes and avoids overwriting the checkpoint with unstable weights.

**Proposed fix:** Track a rolling loss window in `runMlxTrain`. If loss at iter N is >1.5× the mean of the previous 3 checkpoints, abort training, restore backup immediately, and skip the post-eval.

### H3: Separate train and eval prompt pools

**Hypothesis:** Sampling from eval prompts collapses train/eval distributions. Using a dedicated held-out prompt pool for SSD sampling would produce training signal that generalises to the eval prompts without overfitting to them directly.

**Proposed fix:** Introduce an optional `data/sample-prompts.jsonl` — a separate pool of domain prompts used only for SSD sampling. If absent, fall back to current behaviour (sample from eval). This decouples the SSD training signal from the eval signal and allows the eval set to remain a clean measure of domain generalisation.

### H4: Softer composite scoring

**Hypothesis:** Binary dimension scores create a sparse score distribution that makes the 0.7 threshold a cliff. Partial credit for partial correctness would make the filter more informative and allow finer threshold tuning.

**Proposed fix for TSC:** Instead of binary pass/fail, count error lines vs total lines as a severity proxy: `tscScore = Math.max(0, 1 - errorCount / 10)`. Completions with 1–2 minor type errors would score ~0.8 rather than 0.

**Proposed fix for ESLint:** Similarly weight by error count vs warning count — errors penalise more than warnings: `eslintScore = errors === 0 ? (warnings === 0 ? 1 : 0.7) : 0`.

This is a larger change that affects the entire eval/scoring pipeline — worth a separate issue.

### H5: Larger eval set with stratified prompts

**Hypothesis:** 29 prompts is too few for a stable gate. Score movements of ±1–2 prompts are within noise. A 60–100 prompt eval set stratified by component complexity (hooks, forms, layout, data display) would make the gate signal more reliable and reduce false rollbacks.

**Proposed fix:** Expand `eval.jsonl` to ~75 prompts covering the full MUI component taxonomy. This directly increases gate reliability without any code changes.

### H6: Reduce learning rate for high-quality starting weights

**Hypothesis:** When resuming from a checkpoint with high eval score (>0.7), the default lr=1e-4 may be too aggressive and risks unlearning. A warm-start lr schedule that decays the rate proportionally to `currentScore` would stabilise fine-tuning from strong checkpoints.

**Proposed fix:**

```typescript
const learningRate = currentScore > 0.7
  ? 5e-5   // conservative — model is already strong
  : 1e-4;  // standard — room to improve
```

Simple two-tier, no new dependencies.

---

## Summary assessment

| Dimension | Status |
|---|---|
| Core loop correctness | Solid — sample/train/gate/rollback all work |
| Rollback safety | Proven — prevented -0.187 regression |
| Net improvement | Positive — +4.7pp on a strong starting point |
| Training stability | Fragile — fixed hyperparams break on large filter batches |
| Eval gate reliability | Moderate — 29 prompts is borderline for signal stability |
| Score signal quality | Limited — binary scorers create sparse distributions |
| Train/eval separation | Missing — same prompts used for both |

The feature is correct and safe. The next priority is training stability (H1 + H2), followed by eval set expansion (H5). The train/eval separation issue (H3) is architecturally the most important long-term fix but the least urgent given the rollback gate provides a safety net.
