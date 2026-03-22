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

## Session: [DATE]

### Active issues

This session closes out the model integration foundation. Three issues must land together — **#2** and **#10** are tightly coupled (streaming refactor enables TTFT measurement); **#15** depends on the logger from #10.

Implement in this order:

1. **[#10](https://github.com/falese/coder/issues/10) — Observability: structured logging and metrics**
   Build the `Logger` module first. Everything else writes to it.

2. **[#2](https://github.com/falese/coder/issues/2) — Generate: streaming output, `--adaptor` flag, file output, context injection**
   Refactor `runMlx` to `ReadableStream`. Wire TTFT measurement through the logger from #10.

3. **[#15](https://github.com/falese/coder/issues/15) — Safety: memory gate**
   Add refuse/warn logic before subprocess spawn. Emit WARN via the logger from #10.

### TDD instructions

Work strictly test-first:

1. Write one failing test that captures the next behaviour
2. Write the minimum code to make it pass
3. Refactor if needed
4. Repeat

Do not write implementation code without a failing test first.
Do not move to the next behaviour until the current test passes.

---

## Spec context

### Observability (#10)

Log format — structured JSON lines to `~/.coder/logs/coder.log` (path follows XDG / config):

```json
{"ts": "2026-03-21T15:00:00Z", "level": "info", "event": "generation_complete", "ttft_ms": 812, "tok_s": 34.2, "tokens": 256, "adaptor": "react-ts", "model": "Qwen2.5-Coder-7B"}
```

Required events:

| Event | Fields |
|---|---|
| `generation_start` | `model`, `adaptor` (optional) |
| `first_token` | `ttft_ms` |
| `generation_complete` | `ttft_ms`, `tok_s`, `tokens`, `model`, `adaptor` |

- Log level controlled by `log_level` in `~/.coder/config.toml` and `CODER_LOG_LEVEL` env var
- `info` level → stderr (human-readable); all levels → log file (JSON)
- `--debug` flag on any command streams log output to stderr in human-readable form
- `coder logs` command tails the log file

### Generate streaming (#2)

- `--stream` flag: read `mlx_lm.generate --stream` stdout line-by-line, print each token as it arrives
- TTFT = `Date.now()` at spawn → first non-empty stdout chunk
- `--adaptor <name>`: maps to installed adaptor path, passes `--adapter <path>` to mlx_lm
- `-o / --output <file>`: write final output to file instead of stdout
- `--context <file>` (repeatable): prepend file contents to prompt with a separator
- `--system <file>`: load system prompt from file (used by adaptor packs via `prompts/system.md`)

Streaming requires refactoring `runMlx` from buffered (`new Response(proc.stdout).text()`) to a `ReadableStream` that yields chunks. The buffered path must remain available for non-streaming callers and dry-run mode.

### Memory safety gate (#15)

Before spawning any mlx_lm subprocess (`generate`, `chat`, `adaptor train`, `adaptor eval`):

1. Estimate memory: model disk size × 1.2 (rough MLX overhead) + adaptor size if `--adaptor` set
2. Query unified memory: `sysctl hw.memsize` (returns bytes)
3. **Refuse** (exit 1) if estimated > 18 GB — print actionable error with both figures
4. **Warn** (WARN log via Logger) if headroom < 2 GB

Memory estimates are already computed in `src/models/inspector.ts` — reuse that logic.

### Architecture constraints (from CLAUDE.md)

- `runMlx` is the single subprocess boundary — all mlx_lm calls go through it
- All file I/O paths resolve through config (`~/.coder/config.toml`) — no hardcoded paths
- `CODER_DRY_RUN=1` must remain functional — dry-run bypasses subprocess spawn and memory gate
- No `console.log` in production code — use the structured logger

---

## Current file tree

```
./.claude/settings.local.json
./CLAUDE.md
./README.md
./STATUS.md
./bun.lock
./bunfig.toml
./docs/session-prompt.md
./docs/spec.md
./eslint.config.mjs
./package.json
./src/cli/index.ts
./src/commands/config.ts
./src/commands/generate.ts
./src/commands/models.ts
./src/config/loader.ts
./src/config/types.ts
./src/inference/mlx-runner.ts
./src/inference/types.ts
./src/models/inspector.ts
./src/models/pull.ts
./src/models/types.ts
./tests/integration/config.test.ts
./tests/integration/generate.test.ts
./tests/integration/models.test.ts
./tests/unit/config-loader.test.ts
./tests/unit/mlx-runner.test.ts
./tests/unit/models-inspector.test.ts
./tsconfig.json
```

---

## Existing tests (summary)

57 tests passing across 6 files. Do not duplicate:

- `parseMlxOutput` — parses mlx_lm stdout format, extracts tok/s
- `runMlx` — subprocess error handling (missing mlx_lm, bad model path, dry-run mode)
- `loadConfig` / `setConfigValue` / `getConfigValue` — config reads/writes, env overrides, `~` expansion
- `coder generate` integration — end-to-end with `CODER_DRY_RUN=1`
- `coder config set/get/show` integration
- `coder models list/pull/info/remove` integration + `ModelInspector` unit tests

---

## Open questions for this session

All design decisions below are resolved — do not reopen.

- **Streaming implementation:** Bun `ReadableStream` from `proc.stdout`. Refactor `runMlx` to support both streaming and buffered modes. Buffered path stays for dry-run and existing callers.
- **TTFT measurement:** `Date.now()` at spawn, captured again on first non-empty chunk. Difference = `ttft_ms`.
- **Logger placement:** `src/observability/logger.ts`. Singleton exported as `logger`. Writes JSON lines to log file; human-readable to stderr at `info`+.
- **Memory estimate formula:** `modelDiskBytes * 1.2 + adaptorBytes`. Conservative — errs toward refusing rather than crashing mlx.
- **Dry-run bypass:** `CODER_DRY_RUN=1` skips both subprocess spawn and memory gate. Tests use this path.
- **`coder logs` command:** `tail -f` equivalent — read log file and stream to stdout. Simple wrapper, no pagination needed in v1.
