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

Walking skeleton complete (~5%). What exists:

- `coder generate "<prompt>" --model <path>` — buffered, no streaming
- `parseMlxOutput`, `runMlx` — core subprocess layer
- 10 tests passing, tsc clean, eslint clean

What does NOT exist yet: streaming, `--adaptor` flag, config, `chat/models/adaptor/data` commands, observability.

## Resolved decisions — do not reopen

- **Chat template:** Option C — delegate to mlx_lm built-in, no Jinja2 in TS
- **Context overflow:** sliding window at 6,000 tokens, WARN log on truncation
- **Model download:** native HuggingFace HTTP API, no Python subprocess
- **Embedding scorer:** dropped from v1 — composite score is tsc/eslint/test-pass-rate only
- **Streaming + TTFT:** implement together in one PR (#2 + #10)
- **Checkpoint resumption:** automatic when `weights/adaptor.safetensors` exists

## Backlog priority order

1. #5 Config (`~/.coder/config.toml`) ← start here
2. #3 Models (list, pull, info, memory check)
3. #2 + #10 Generate streaming + Observability (implement together)
4. #4 Chat REPL
5. #6 Adaptor install/list/update
6. #7 Data JSONL pipeline (design spike first)
7. #8 Adaptor train
8. #9 Adaptor eval
9. #11 React/TS adaptor pack
10. #12 GraphQL adaptor pack

For the current session's issue and full context: @docs/session-prompt.md
