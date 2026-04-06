# Self-Improve Testing Plan

Manual end-to-end validation for `coder adaptor self-improve`.

---

## Prerequisites

Everything below should already be satisfied on this machine.

| Requirement | Expected value |
|---|---|
| Model | `~/.coder/models/mlx-community/Qwen2.5-Coder-7B-Instruct-4bit` |
| Adaptor weights | `adaptors/react-ts/weights/adapters.safetensors` |
| Eval prompts | `adaptors/react-ts/data/eval.jsonl` (5 prompts) |
| Train data | `adaptors/react-ts/data/train.jsonl` (144 examples) |
| mlx_lm | `python3 -c "import mlx_lm; print('ok')"` |

---

## Phase 1 — Establish baseline

### 1a. Score without the adaptor

```bash
bun src/cli/index.ts adaptor eval react-ts --baseline
```

Writes `baseline_pass_rate` to `manifest.json`. Expected: ~0.46.

### 1b. Score with the adaptor

```bash
bun src/cli/index.ts adaptor eval react-ts
```

Writes `eval_pass_rate` to `manifest.json`. Expected: ~0.92. This is the score the self-improve loop must beat to commit each round.

### 1c. Snapshot current weights

```bash
cp adaptors/react-ts/weights/adapters.safetensors \
   adaptors/react-ts/weights/adapters.safetensors.orig
```

Lets you restore the starting point at any time:

```bash
cp adaptors/react-ts/weights/adapters.safetensors.orig \
   adaptors/react-ts/weights/adapters.safetensors
```

---

## Phase 2 — Dry-run smoke test

Validates the full loop runs end-to-end without errors. No real inference or training.

```bash
CODER_DRY_RUN=1 bun src/cli/index.ts adaptor self-improve react-ts \
  --rounds 1 \
  --samples 2
```

**Expected stderr:**
```
Round 1/1: generated 10  filtered (≥0.70): ...  eval: 0.500 → 0.500 (+0.000)  [committed]
```

**Expected stdout:**
```
Self-improvement complete. Final score: 0.500 (rounds committed: 1/1)
```

Dry-run returns stub composites (0.5) — scores are meaningless here. You're just verifying no crash.

---

## Phase 3 — Real 1-round run

**Estimated time: 5–15 min** (20 generations + 100-iter LoRA training on M3)

```bash
bun src/cli/index.ts adaptor self-improve react-ts \
  --rounds 1 \
  --samples 4 \
  --threshold 0.7 \
  --temperature adaptive
```

### What to watch

**Per-round progress (stderr):**
```
Round 1/1: generated 20  filtered (≥0.70): N  eval: 0.920 → X.XXX (+/-delta)  [committed/rolled back]
```

**Final summary (stdout):**
```
Self-improvement complete. Final score: X.XXX (rounds committed: 1/1)
```

**Manifest — confirm fields were written:**
```bash
cat adaptors/react-ts/manifest.json | jq '{
  version,
  eval_pass_rate,
  self_improve_rounds,
  self_improve_score_history,
  self_improve_last_run
}'
```

**Log events — confirm observability:**
```bash
tail -50 ~/.coder/logs/coder.log | jq 'select(.msg | startswith("self_improve"))'
```

**Adaptor info — confirm new fields display:**
```bash
bun src/cli/index.ts adaptor info react-ts
```

---

## Phase 4 — Multi-round run (full SSD)

Run only if Phase 3 committed at least once.

**Estimated time: 45–90 min** (3 rounds × ~15–30 min each)

```bash
bun src/cli/index.ts adaptor self-improve react-ts \
  --rounds 3 \
  --samples 8 \
  --threshold 0.7 \
  --temperature adaptive
```

After it completes, confirm the final score:

```bash
bun src/cli/index.ts adaptor eval react-ts
```

Should match the last committed score in `self_improve_score_history`.

---

## Interpreting results

| Signal | Healthy | Investigate |
|---|---|---|
| Filtered samples per round | ≥30% of generated | <10% → threshold too high or temp too low |
| Score delta per committed round | +0.01 to +0.03 | Negative delta every round → training overfitting |
| Rollback rate | ≤1 in 3 rounds | >2 rollbacks → try fewer iters or lower threshold |
| Final score | >0.94 | Still ~0.92 → try more samples (`--samples 12`) |

---

## Restore original weights

```bash
cp adaptors/react-ts/weights/adapters.safetensors.orig \
   adaptors/react-ts/weights/adapters.safetensors
```
