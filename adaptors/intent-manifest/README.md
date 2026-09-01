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
| `evals/eval.config.json` | Pack eval configuration: tests-only weighting, a `.yaml` artifact with no prompt prepended, the grammar system prompt, and a 900-token generation cap. See "Eval oracle". |
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

coder's default composite is `tsc*0.4 + eslint*0.3 + tests*0.3`; tsc and eslint
are noise for YAML, so this pack declares its own weighting in
`evals/eval.config.json`:

```json
{
  "weights": { "tsc": 0, "eslint": 0, "tests": 1 },
  "artifact": { "extension": ".yaml", "includePrompt": false },
  "systemPrompt": "prompts/system.md",
  "maxTokens": 900
}
```

That makes the composite **the validator pass-rate itself** (unweighted
dimensions are skipped, not scored 0, and print as `n/a`), writes the generated
text to a `.yaml` file with the prose intent *not* prepended — the oracle must
see bare YAML — and loads the DSL-grammar system prompt for generation,
including the baseline run, so the measured lift is the LoRA rather than the
prompt.

Under ADR-088 the oracle itself lives in the first-party in-repo
`@seans-mfe/plugin-coder` (`validateManifestText`), which strips a stray fence,
parses the YAML, and runs `validateFull` from `@seans-mfe/dsl`.

`evals/eval_suite.ts` loads that package, so it must be **resolvable from the
eval sandbox**. `adaptors/**` is excluded from coder's own tsc/eslint, so this
never affects the coder repo's gates. The package is CommonJS and its `exports`
map declares only the `require` condition, so the suite loads it through
`createRequire` rather than a bare ESM `import`.

```sh
# 1. build the oracle in the platform repo
(cd ../seans-mfe-tool && npx tsc -b packages/plugin-coder)

# 2. link it into coder's node_modules (no package.json change — coder's own
#    install must not depend on a local checkout)
mkdir -p node_modules/@seans-mfe
ln -sfn ../../../seans-mfe-tool/packages/plugin-coder node_modules/@seans-mfe/plugin-coder
```

## Results (run of 2026-09-01)

Trained and evaluated on one Apple Silicon machine: `Qwen2.5-Coder-7B-Instruct-4bit`
(MLX, 4.0 GB) + LoRA r=8 on `q_proj`/`v_proj`, 200 iters, batch 2, lr 1e-4.
39 minutes, 7.18 GB peak, 89,401 trained tokens. Validation loss **2.112 → 0.047**,
no divergence. Adapter is 44 MB.

Validator pass-rate over the 33 held-out intents:

| Run | Weights | System prompt | Pass-rate |
|---|---|---|---|
| Baseline, original prompt | — | buggy `providesSlots` grammar | 0.848 (28/33) |
| Baseline, corrected prompt | — | corrected | **1.000** (33/33) |
| Tuned | LoRA | corrected | **1.000** (33/33) |
| Ablation, base | — | none | **0.000** (0/33) |
| Ablation, tuned | LoRA | none | **0.939** (31/33) |

**Read these carefully.** The first baseline was measuring a defect in this pack's
own `prompts/system.md`, not a model gap: it documented `providesSlots` as an array
of slot-id strings when the DSL requires `[{ id, description? }]`. All five failures
were that one line. With the grammar corrected the base model clears the set from
the prompt alone, so the ceiling is 1.000 and the issue's `≥ +0.15` lift gate is
arithmetically unreachable — the held-out intents share a generator with the
training pairs and are in-distribution.

The measurable axis is the ablation: strip the 1,172-token grammar prompt entirely
and the base model scores **0/33** (it writes prose advice, not a manifest) while
the tuned model scores **31/33**. That is what the LoRA bought — the grammar moved
out of the prompt and into the weights — and it is what M5 should be gated on.

**M6, end to end.** A held-out intent produced a manifest that passed
`parseAndValidateDirectory` (`valid: true, errors: 0`), drove `remote:generate`
(23 files, 0 skipped) and passed every `mfe:validate` gate — `react-pinned`,
`manifest-package-sync`, `shared-declared`, `shared-version-sync`,
`runtime-declared`, `slots-implemented`, `platform-migrations` — with no hand edit
to the DSL.

## Operationalizing as a platform plugin

The platform side already exists: `@seans-mfe/plugin-coder` (ADR-088) ships
`coder:compile`, which shells out to this adaptor, validates the YAML with the DSL
oracle, fails closed on an invalid manifest, and writes `mfe-manifest.yaml`. Nothing
in it imports MLX, Python or weights — the boundary is a process call to a
replaceable binary (ADR-085 §1).

```
seans-mfe-tool               coder (this repo)
  coder:compile  ──execFile──▶  coder generate "<intent>" --adaptor intent-manifest
       │                                    │
       │◀────────── bare YAML on stdout ────┘
       ▼
  stripFences → validateManifestText   (fails closed on invalid)
       ▼
  write mfe-manifest.yaml → remote:generate → mfe:validate
```

To operationalize:

1. **Put `coder` on PATH.** The subprocess transport resolves the bare name
   `coder` (`DEFAULT_CODER_BIN`). From this repo:
   `bun link` (or `ln -s "$PWD/src/cli/index.ts" /usr/local/bin/coder`).
2. **Install the adaptor pack** where coder's `adaptors_dir` points —
   `coder adaptor install intent-manifest --from-git <url>` — and put trained
   weights at `<pack>/weights/adapters.safetensors`. Weights are git-ignored, so
   distribute them separately or train locally
   (`coder adaptor train --config adaptors/intent-manifest/train-config.toml`).
3. **Set a default model** so the seam needs no `--model`:
   `coder config set default_model mlx-community/Qwen2.5-Coder-7B-Instruct-4bit`.
4. **Register the plugin** in seans-mfe-tool: build it
   (`npx tsc -b packages/plugin-coder`) and list it under `oclif.plugins` so the
   `coder:*` topic is discovered.
5. **Compile:**
   `seans-mfe-tool coder:compile "<business intent>" --out mfe-manifest.yaml`
   then `remote:generate` in that directory. Add `--endpoint http://localhost:3991`
   to route through a warm `coder serve --adaptor intent-manifest` instead of
   paying model load per call.

Two notes for whoever wires this up:

- **No `--system` needed.** The trained adaptor scores 0.939 with no system prompt,
  so `systemPromptPath` can be left unset — that is 1,172 fewer prompt tokens per
  request. Pass it only when running against the untuned base model, which scores
  0.000 without it.
- **The subprocess transport is the one that is verified.** `coder generate` now
  truncates at the chat end token (`stripChatEndToken`, at the mlx boundary), so
  stdout is bare YAML and `compileIntent`'s `stripFences` is enough. The streaming
  `serve` transport emits raw chunks, so an end token can still reach an SSE
  consumer — verify that path before relying on `--endpoint`.

## Refreshing or retraining

```sh
# refresh the splits from the canonical corpus
CORPUS=../seans-mfe-tool/docs/corpus/intent-manifest
cp "$CORPUS"/{train,valid,eval}.jsonl adaptors/intent-manifest/data/

# prove the wiring, then train for real (resumes from existing weights)
CODER_DRY_RUN=1 coder adaptor train --config adaptors/intent-manifest/train-config.toml
coder adaptor train --config adaptors/intent-manifest/train-config.toml

# score it — baseline first, then with weights
coder adaptor eval intent-manifest --baseline --report baseline.md
coder adaptor eval intent-manifest --report tuned.md
```

`coder adaptor train` bumps the manifest's patch version on success and aborts the
round on a loss spike (`TrainingDivergedError`). `coder adaptor eval` writes
`baseline_pass_rate` / `eval_pass_rate` back into `manifest.json`.

To reproduce the ablation, copy the pack, drop `systemPrompt` from
`evals/eval.config.json`, and point `weights/` at the trained pack.
