# intent-manifest adaptor

Compiles a **natural-language business intent** into a schema-valid
**`mfe-manifest.yaml`** for the seans-mfe platform DSL. This is the
intent→manifest lane of the generative software system (seans-mfe-tool
PDR-009 / ADR-084 / ADR-085); the model authors the *manifest*, and the
platform's deterministic, drift-gated codegen carries it the rest of the way.

- **Contract & spec:** `seans-mfe-tool/docs/coder-intent-manifest-adaptor-spec.md`
- **Tracking issue:** falese/seans-mfe-tool#364

## Pack contents

| Path | What it is |
|---|---|
| `manifest.json` | Adaptor manifest (`ManifestSchema`). `eval_pass_rate` / `baseline_pass_rate` are filled in by `coder adaptor eval`. |
| `train-config.toml` | LoRA training config (`TrainConfigSchema`). Portable relative paths; `[model].path` points at the quantized base under `~/.coder/models`. |
| `extract.json` | Present for the pack layout only — a no-op. `coder data extract` is code-anchor and cannot turn prose into YAML, so the corpus is generated directly (see below). |
| `prompts/system.md` | The DSL grammar as a system prompt: required fields, enums, the capability array-of-single-key-map shape, the lifecycle shape, "emit only YAML". |
| `evals/eval_suite.ts` | The eval oracle — the DSL validator, not tsc/eslint. See "Eval oracle". |
| `data/eval.jsonl` | Held-out intents for `coder adaptor eval` (committed). |
| `data/train.jsonl`, `data/valid.jsonl` | Training splits (git-ignored; copied from the canonical corpus — see below). |
| `weights/` | LoRA `adapters.safetensors` — training output (git-ignored). |

## Data — the corpus

The canonical corpus is committed in the platform repo at
**`seans-mfe-tool/docs/corpus/intent-manifest/`**: a 660-pair, 100%
validator-gated dataset (`pairs.jsonl` + `train`/`valid`/`eval` splits,
produced by `generate.mjs`). Every synthetic completion passed the DSL
validator before admission (self-labeling oracle), so the training set is
100% schema-valid.

`data/` here holds a copy of those splits. `data/eval.jsonl` is committed;
`data/train.jsonl` / `data/valid.jsonl` are git-ignored (mirroring the
`react-ts` pack) — refresh them from the corpus when it changes:

```sh
CORPUS=../seans-mfe-tool/docs/corpus/intent-manifest
cp "$CORPUS"/{train,valid,eval}.jsonl adaptors/intent-manifest/data/
```

Corpus stats (`coder data stats`): 660 pairs, prompt mean ≈ 33 tok,
completion mean ≈ 209 tok, duplicate rate 0% — comfortably inside coder's
data bar (≥500 pairs, dup < 5%, prompt mean < 200, completion mean < 400).

## Eval oracle

coder's composite is `tsc*0.4 + eslint*0.3 + tests*0.3`; tsc/eslint are noise
for YAML, so the real signal routes through the **Tests** dimension. Under
ADR-088 the oracle lives in the first-party in-repo `@seans-mfe/plugin-coder`
(`validateManifestText`), which strips a stray fence, parses the YAML, and runs
`validateFull` from `@seans-mfe/dsl`.

`evals/eval_suite.ts` imports `@seans-mfe/plugin-coder`, so that package (and
its `@seans-mfe/dsl` dependency) must be **resolvable from the eval sandbox** —
a workspace link or a published package. `adaptors/**` is excluded from coder's
own tsc/eslint, so this import never affects the coder repo's gates.

```sh
# make the oracle resolvable (workspace link; adjust the path to your checkout)
bun add file:../seans-mfe-tool/packages/plugin-coder   # or: npm/bun link
```

## Status and next steps

Done here (no MLX required): the pack scaffold, the corpus install + `coder
data validate`/`stats` verification, and the DSL-grammar system prompt.

Remaining — each needs a coder runtime (Bun + `mlx_lm`, ~18 GB, Apple
Silicon):

1. **Baseline** — `coder adaptor eval intent-manifest --baseline` → records
   `baseline_pass_rate`.
2. **Train** — `CODER_DRY_RUN=1 coder adaptor train --config
   adaptors/intent-manifest/train-config.toml` to prove the wiring, then a real
   run. Writes `weights/adapters.safetensors`.
3. **Eval + lift gate** — `coder adaptor eval intent-manifest`; target
   `eval_pass_rate − baseline_pass_rate ≥ +0.15`.
4. **End-to-end** — `coder generate "<intent>" --adaptor intent-manifest
   --system adaptors/intent-manifest/prompts/system.md` → write YAML →
   `parseAndValidateDirectory` (seans-mfe-tool) → `remote:generate` → the fleet
   drift/compose gates. Correct result: a schema-valid manifest that generates a
   drift-clean MFE with no hand edit to the DSL.
