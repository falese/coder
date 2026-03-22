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
- One adaptor active per session — no hot-swapping
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
