# Coder — Project Memory

## What this project is

CLI tool for local code generation using MLX-quantized 7B models on Apple Silicon.
Long-term goal: a community marketplace of LoRA adaptor packs for domain-specific code generation.
Full spec: @docs/spec.md

## Stack

- **Runtime:** Bun
- **Language:** TypeScript (strict, no `any`)
- **Inference:** MLX via `mlx_lm.generate` subprocess
- **Fine-tuning:** LoRA via `mlx_lm.lora`
- **Test runner:** `bun test`
- **Validation:** Zod (for manifest schema)

## Commands

```
bun test              # run all tests
bun run build         # tsc --noEmit + compile
bun run lint          # eslint .
bun run generate      # coder generate (dev)
```

## Development rules

- **TDD always** — write a failing test first, then the code to pass it
- Never write code without a corresponding test
- `tsc --noEmit` must be clean before any commit
- ESLint must be clean before any commit
- No `any` types — use `unknown` and narrow properly
- No `console.log` in production code — use the structured logger

## Architecture constraints

- Base model + LoRA adaptor must fit within 18GB unified memory
- `runMlx` is the single subprocess boundary — all mlx_lm calls go through it
- One adaptor active per session — no hot-swapping (so runtime adapter-blending is out; persona traits are a prompt-layer dial, not live LoRA swaps)
- All file I/O paths resolve through config (`~/.coder/config.toml`) — no hardcoded paths
- Dry-run mode via `CODER_DRY_RUN=1` must remain functional at all times

## Current state (2026-03-21)

Foundation + core UX (~40%). What exists:

- `coder generate "<prompt>" [--model <path>]` — buffered and streaming (`--stream`); `--model` optional when `default_model` set in config
  - `--stream` — streams via Bun `ReadableStream`; TTFT measured from spawn to first chunk
  - `--adaptor <name>` — resolves to `adaptors_dir/<name>`, passes path to mlx_lm
  - `-o <file>` — writes output to file
  - `--context <file>` — prepends file to prompt (repeatable)
  - `--system <file>` — passes system prompt to mlx_lm
- `coder config set/get/show` — reads/writes `~/.coder/config.toml`
- `coder models list/pull/info/remove` — model management, HuggingFace HTTP download
- `coder logs` — streams `~/.coder/logs/coder.log` to stdout
- `parseMlxOutput`, `runMlx`/`runMlxBuffered`, `runMlxStream` — core subprocess layer
- `loadConfig`, `setConfigValue`, `getConfigValue` — config with env overrides, `~` expansion
- Memory safety gate — `checkMemory` enforces 18 GB limit before every generation
- Structured JSON logger — `generation_start`/`generation_complete` events with TTFT + tok/s
- 93 tests passing, tsc clean, eslint clean

What does NOT exist yet: `chat`, `adaptor install/train/eval`, `data` commands.

## Resolved decisions — do not reopen

- **Chat template:** Option C — delegate to mlx_lm built-in, no Jinja2 in TS
- **Context overflow:** sliding window at 6,000 tokens, WARN log on truncation
- **Model download:** native HuggingFace HTTP API, no Python subprocess
- **Embedding scorer:** dropped from v1 — composite score is tsc/eslint/test-pass-rate only
- **Streaming + TTFT:** implement together in one PR (#2 + #10)
- **Checkpoint resumption:** automatic when `weights/adaptor.safetensors` exists
- **Unknown config keys:** silently ignored on load, rejected with error on `config set`
- **Config missing on first run:** create with defaults silently, no error
- **TOML parser:** `smol-toml` (pure TS, no native deps)
- **Prompt capture (SSD memory):** opt-in via `capture_prompts`; `generate`/`chat`/`serve` append the user prompt to `<adaptor>/data/prompt-log.jsonl` (prompts only — completions are self-distilled at train time). Manage via `coder data prompts list/stats/deduplicate/purge`.
- **Self-distillation loop:** `coder adaptor self-improve <name>` samples k completions per captured prompt, eval-scores them (tsc/eslint/tests), retrains on the high-scorers, and **commits only if eval improves** — otherwise rolls back; loss-spike divergence aborts the round (`TrainingDivergedError`).
- **Persona/voice split:** the *what* (knowledge) stays modular from the *how* (voice). Voice = LoRA (future); knowledge = data/graph (future).
- **Trait control = prompt-layer (v1):** dialable traits (`formality`/`sarcasm`/`verbosity`, 1–7) are folded into the system prompt at request time (`/generate` `traits` field; `parseTraitCommand`/`applyTraits` in `src/persona/traits.ts`). Adapter-layer traits deferred — no live LoRA blending (one adaptor per session).
- **Cross-turn memory:** `/generate` accepts `messages[]` (+ `sessionId`); prior turns are windowed + ChatML-formatted server-side via `buildPromptFromBody` (reuses `formatPrompt`/`applyWindow`). Single-`prompt` requests unchanged.
- **Episodes:** a `sessionId` thinking session is accumulated server-side (`src/episodes/recorder.ts`) into an Episode (turns w/ thought+final + concept threads), persisted under `episodes_dir`. Boundary = explicit `POST /episodes/save` + idle-timeout fallback. `episodeToJsonl` bakes episodes into the `coder data`/`adaptor train` pipeline. Manage via `coder episodes list/show/export`.
- **Knowledge graph:** `coder graph build/show/query` builds from episode threads (threads → nodes, within-episode co-occurrence → weighted edges) at `graph_dir/knowledge-graph.json`. **Consumption = bake into training data**; inference-time RAG/graph-retrieval stays **out of scope (v1)** (`docs/spec.md`).
- **Persona/voice LoRA = SSD engine + pluggable verifier.** One engine (`sampleCompletions`/`runSelfImprove`), two verifiers: code composite (knowledge) vs **thread-recall F1** (voice, `src/eval/persona.ts`). `coder adaptor scaffold <name> --from-episodes` builds the persona pack from episodes (voice-only `train.jsonl` + `persona-pool.jsonl`/`persona-eval.jsonl` thread refs); `coder adaptor self-improve --persona` trains; `coder adaptor eval --persona` scores (`persona_f1`). Voice→LoRA, knowledge→graph (modular). Closes the loop: think → episode → graph → scaffold → train → eval → `serve --adaptor` → think.
- **Non-TypeScript adaptor targets = per-pack `evals/eval.config.json`** (`src/eval/pack-config.ts`): dimension `weights` (renormalised; a zero-weight dimension is skipped, not scored 0, and prints `n/a`), `artifact.extension`/`artifact.includePrompt`, `systemPrompt` (pack-relative, applied to `--baseline` runs too), `maxTokens`. Absent file = the historic `.tsx` / prompt-prepended / 0.4-0.3-0.3 behaviour, so `react-ts` is untouched. The `intent-manifest` pack emits YAML and weights `tests` alone, so its composite **is** the DSL validator pass-rate.
- **System prompt at the mlx boundary:** `systemFile` is a *path* whose contents `runMlx` reads; `systemPrompt` is literal text and wins. mlx_lm's `--system-prompt` takes the text, never a path.
- **Chat end tokens are framing, not content:** `stripChatEndToken` truncates generated text at the first `<|im_end|>`/`<|endoftext|>`/`<|eot_id|>`/`</s>` inside `parseMlxOutput`. A model that does not halt on EOS otherwise fills the token cap with filler that reaches every buffered consumer. Streaming (`runMlxStream`) still emits raw chunks.

## Current state — intent-manifest adaptor (2026-09-01)

Second shipped adaptor pack (`adaptors/intent-manifest`), for seans-mfe-tool#364: compiles a business intent into a schema-valid `mfe-manifest.yaml`. Qwen2.5-Coder-7B-Instruct-4bit + LoRA r=8, 200 iters, 39 min, 7.18 GB peak, val loss 2.112 → 0.047, adapter 44 MB.

- Prompted eval is **saturated**: base and tuned both 1.000 over the 33 held-out intents, so the issue's `≥ +0.15` lift gate is unreachable. The held-out set shares a generator with the training pairs.
- The real signal is the **no-system-prompt ablation**: base 0.000, tuned 0.939. Gate future runs there.
- The first 0.848 baseline was a bug in the pack's own `prompts/system.md` (`providesSlots` documented as strings; the DSL wants `[{id, description?}]`) — not a model gap. Keep the grammar prompt and `packages/dsl/src/schema.ts` in step.
- End-to-end verified: intent → `coder generate` → `parseAndValidateDirectory` → `remote:generate` (23 files) → `mfe:validate` 7/7 gates, no hand edit.
- Platform seam is `@seans-mfe/plugin-coder`'s `coder:compile` (ADR-088); it needs `coder` on PATH and works with no `--system`. See the pack README.

## Current state — weightless adaptors + drift-audit (2026-09-04)

`ManifestSchema` now carries a `mode` field (`"lora"` | `"inference-only"`, default `"lora"`). LoRA-only fields (`mlx_quant`/`lora_rank`/`min_memory_gb`/`eval_pass_rate`) are required only for `lora` packs (via `superRefine`), so every existing manifest is unaffected. A weightless `inference-only` pack is a served base model + system prompt, no corpus/weights/train-eval gate. `adaptor info` prints the mode and skips absent LoRA rows; `generate` only passes mlx `--adapter-path` when a `weights/` dir exists.

`adaptors/drift-audit` — first weightless pack (governance twin of intent-manifest, per the drift-audit spec / PDR-010 / ADR-090). Reads one ADR clause + its implementing code, emits a **bare JSON array** of typed drift findings: `hardened` (a regex source-matcher) or `semantic` (real but not mechanizable). Precision comes from a deterministic floor **platform-side** (Sentinel `HardenedCheckSchema` + `verify`), not the model — the model proposes candidates only (Trusting-Trust guardrail). **Never trains, never certifies "clean"**, never invents an `enforces` ADR id. `prompts/system.md` is the product (contract + few-shots). `evals/eval_suite.ts` is the coder-side **smoke** only (schema-valid JSON, patterns compile, enforces grounded) over `fixtures/`; the real recall/precision eval is git-mined platform-side (spec §6b), not in coder. Smoke: `bun test ./adaptors/drift-audit/evals/eval_suite.ts` (add `CODER_DRIFT_LIVE=1` in a coder env to validate live model output).

## Backlog priority order

1. ~~#5 Config~~ ✅ done
2. ~~#3 Models~~ ✅ done
3. ~~#2 + #10 Generate streaming + Observability~~ ✅ done
4. ~~#15 Memory safety gate~~ ✅ done
5. #4 Chat REPL
6. #6 Adaptor install/list/update
7. #7 Data JSONL pipeline (design spike first)
8. #8 Adaptor train
9. #9 Adaptor eval
10. #11 React/TS adaptor pack
11. #12 GraphQL adaptor pack

For the current session's issue and full context: @docs/session-prompt.md
