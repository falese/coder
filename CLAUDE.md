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
