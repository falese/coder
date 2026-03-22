# coder

[![CI](https://github.com/falese/coder/actions/workflows/ci.yml/badge.svg)](https://github.com/falese/coder/actions/workflows/ci.yml)

Local AI code generation using MLX on Apple Silicon.

## Vision

`coder` is a CLI tool for running quantized 7B code models entirely on your Mac — no cloud, no usage costs, no data leaving your machine. The long-term goal is a community marketplace of LoRA adaptor packs: domain expert teams build and publish fine-tuned adaptors for React/TypeScript, GraphQL, or any codebase pattern, and any engineer can pull an adaptor and generate code that adheres to that domain's architecture and quality standards.

> **Status: ~70% of planned features**
> `coder generate`, `coder chat`, `coder config`, `coder models`, `coder adaptor`, and `coder logs` work today. Data pipeline, adaptor training/eval, and the marketplace are on the roadmap. See [STATUS.md](./STATUS.md) and [open issues](https://github.com/falese/coder/issues).

---

## Prerequisites

- macOS with Apple Silicon (M3–M5)
- [Bun](https://bun.sh) >= 1.3
- Python 3 with mlx-lm: `pip install mlx-lm`
- 18 GB unified memory recommended

---

## Installation

```bash
git clone https://github.com/falese/coder.git
cd coder
bun install

# Optional: link for a global `coder` command
bun link
```

Without `bun link`, use `bun src/cli/index.ts` in place of `coder` in all examples below.

`bun link` requires `~/.bun/bin` to be on your `PATH` (bun's installer adds this automatically to `.zshrc`/`.bashrc`). If `coder` isn't found after linking, run `source ~/.zshrc` or open a new terminal tab.

---

## Configuration

The config file lives at `~/.coder/config.toml` and is created automatically on first run with defaults.

```toml
default_model = ""                  # local path or HuggingFace repo id
adaptors_dir = "~/.coder/adaptors"
models_dir   = "~/.coder/models"
logs_dir     = "~/.coder/logs"
log_level    = "info"               # debug | info | warn | error
```

### Config commands

```bash
coder config set default_model /path/to/your/model
coder config get default_model
coder config show
```

### Environment variable overrides

| Variable | Overrides |
|---|---|
| `CODER_MODEL` | `default_model` |
| `CODER_LOG_LEVEL` | `log_level` |
| `CODER_MODELS_DIR` | `models_dir` |
| `CODER_CONFIG_PATH` | Config file path (useful for testing) |

---

## Commands

### `coder generate`

Generate code from a prompt using a local MLX model.

```bash
coder generate "<prompt>"                                    # uses default_model from config
coder generate "<prompt>" --model /path/to/model            # explicit model path
coder generate "<prompt>" --model /path --max-tokens 256
coder generate "<prompt>" --model /path --stream            # stream tokens as generated
coder generate "<prompt>" -o output.ts                      # write output to file
coder generate "<prompt>" --context src/foo.ts              # prepend file to prompt (repeatable)
coder generate "<prompt>" --adaptor react-ts                # apply a named LoRA adaptor
coder generate "<prompt>" --system prompts/system.md        # load system prompt from file
coder generate "<prompt>" --model /path | pbcopy            # pipe-friendly: code goes to stdout only
```

Token throughput (tok/s) is always printed to stderr. With `--stream`, tokens appear as they are generated; without it, output is buffered until generation completes.

### `coder config`

Read and write `~/.coder/config.toml`.

```bash
coder config set <key> <value>   # set a config value
coder config get <key>           # print a single value
coder config show                # print all current config
```

Valid keys: `default_model`, `adaptors_dir`, `models_dir`, `logs_dir`, `log_level`.

### `coder models`

Manage local MLX models.

```bash
coder models list                                          # list downloaded models
coder models pull mlx-community/Qwen2.5-Coder-7B-Instruct-4bit  # download from HuggingFace
coder models info mlx-community/Qwen2.5-Coder-7B-Instruct-4bit  # show metadata + memory estimate
coder models remove mlx-community/Qwen2.5-Coder-7B-Instruct-4bit  # delete a local model
```

Models are stored under `models_dir` (default `~/.coder/models`) in `<org>/<name>` subdirectories. The `pull` command downloads directly from HuggingFace via HTTP — no Python required beyond mlx-lm.

The CLI enforces a memory safety gate before spawning mlx_lm: if the estimated model + adaptor memory (disk size × 1.2) would exceed 18 GB, the command exits with an error. A warning is shown if headroom is under 2 GB. Bypass with `CODER_DRY_RUN=1`.

Memory estimates use the formula `params × bytes_per_weight × 1.2` (1.2× overhead factor), derived from the model's `.safetensors` file sizes and the quantization level in `config.json`.

### `coder chat`

Interactive multi-turn conversation REPL with a local MLX model.

```bash
coder chat                          # uses default_model from config
coder chat --model /path/to/model
coder chat --adaptor react-ts       # apply a named LoRA adaptor
```

Conversation history is maintained in-memory across turns (sliding window, 6,000 token limit). REPL commands:

| Command | Action |
|---|---|
| `/clear` | Reset conversation history |
| `/save <file>` | Dump conversation to JSON file |
| `/exit` | Quit (also Ctrl-D) |
| Ctrl-C | Cancel current generation, return to prompt |

### `coder adaptor`

Manage LoRA adaptor packs.

```bash
coder adaptor list                              # show installed adaptors
coder adaptor install <name> --from-git <url>  # clone + validate from git
coder adaptor info <name>                       # show manifest + eval scores
coder adaptor update <name>                     # git pull in adaptor directory
coder adaptor remove <name>                     # delete adaptor directory
```

Adaptors are stored under `adaptors_dir` (default `~/.coder/adaptors/<name>/`). Each adaptor pack contains weights, training data, an eval suite, a system prompt, and a `manifest.json` validated against the Zod schema on install.

### `coder logs`

View the structured generation log (`~/.coder/logs/coder.log`).

```bash
coder logs
```

Every `coder generate` and `coder chat` turn appends a JSON line recording the event, model, TTFT (ms), and token throughput. The log file is created automatically on first generation.

### `coder data`

Dataset curation pipeline for LoRA adaptor training. See [docs/data-pipeline.md](./docs/data-pipeline.md) for a complete guide on setting up your source repo and running the full pipeline.

```bash
coder data ingest "src/**/*.ts" --output raw.jsonl          # one record per file
coder data extract --adaptor react-ts --input raw.jsonl \
  --output extracted.jsonl                                  # apply extract.json rules
coder data deduplicate extracted.jsonl --output deduped.jsonl  # remove near-dupes (Jaccard 0.85)
coder data validate deduped.jsonl                           # gates: non-empty, ≤2048 tokens
coder data split deduped.jsonl \
  --output-dir ~/.coder/adaptors/react-ts/data/             # 90/10 → train.jsonl + eval.jsonl
coder data stats deduped.jsonl                              # count, token percentiles, dup rate
```

The output of `coder data split` lands directly in the adaptor's `data/` directory, ready for `coder adaptor train`.

---

## Manual testing — without a real model (dry-run)

Anyone can verify the CLI works immediately after cloning, with no Python or MLX required.

```bash
# 1. Verify the CLI starts
bun src/cli/index.ts --help

# 2. Verify generate subcommand help
bun src/cli/index.ts generate --help

# 3. Dry-run a generation (no Python/MLX needed)
CODER_DRY_RUN=1 bun src/cli/index.ts generate "write a bubble sort in Python" --model /any/path
# Expected output: # dry-run: write a bubble sort in Python

# 4. Inspect and set config
bun src/cli/index.ts config show
bun src/cli/index.ts config set default_model /models/test
bun src/cli/index.ts config get default_model
# Expected: /models/test

# 5. Generate using the config default (no --model flag)
CODER_DRY_RUN=1 bun src/cli/index.ts generate "write a fizzbuzz"
# Expected output: # dry-run: write a fizzbuzz

# 6. Verify the missing-model error
bun src/cli/index.ts config set default_model ""
bun src/cli/index.ts generate "test"
# Expected: exit 1, error message about no model specified

# 7. List models (empty — none downloaded yet)
bun src/cli/index.ts models list
# Expected: header row (NAME  QUANT  DISK  MEMORY), no model rows

# 8. Dry-run a model pull
CODER_DRY_RUN=1 bun src/cli/index.ts models pull mlx-community/Qwen2.5-Coder-7B-Instruct-4bit
# Expected: [dry-run] would pull mlx-community/Qwen2.5-Coder-7B-Instruct-4bit into ...

# 9. Dry-run streaming
CODER_DRY_RUN=1 bun src/cli/index.ts generate "write a fizzbuzz" --stream
# Expected: # dry-run: write a fizzbuzz  (same output, streaming path bypassed in dry-run)

# 10. View logs (empty until a real generation runs)
bun src/cli/index.ts logs
# Expected: either empty log or "No log file found yet"

# 11. Run the full test suite
bun test
# Expected: 143 pass, 0 fail
```

---

## Manual testing — with a real MLX model

```bash
# Download Qwen2.5-Coder-7B-Instruct-4bit (~4 GB, fits in 18 GB with headroom for a LoRA adaptor)
bun src/cli/index.ts models pull mlx-community/Qwen2.5-Coder-7B-Instruct-4bit

# Set as the default model
bun src/cli/index.ts config set default_model ~/.coder/models/mlx-community/Qwen2.5-Coder-7B-Instruct-4bit

# Inspect the downloaded model
bun src/cli/index.ts models info mlx-community/Qwen2.5-Coder-7B-Instruct-4bit

# Run a generation
bun src/cli/index.ts generate "write a TypeScript function that debounces a callback"
```

Without `--stream`, output is buffered until generation finishes. Add `--stream` to see tokens as they arrive. Token throughput (tok/s) is always printed to stderr. Each run appends a JSON event to `~/.coder/logs/coder.log` — view with `coder logs`.

---

## Error reference

| Error | Cause | Fix |
|---|---|---|
| `mlx_lm not installed. Run: pip install mlx-lm` | Python mlx-lm package missing | `pip install mlx-lm` |
| `Model not found at path: ...` | Path doesn't exist or isn't an MLX model directory | Check the path; use `coder models list` to see what's downloaded |
| `Error: no model specified` | No `--model` flag and no `default_model` in config | `coder config set default_model <path>` |
| `unknown config key "..."` | Typo in key name | Valid keys: `default_model`, `adaptors_dir`, `models_dir`, `logs_dir`, `log_level` |
| `Warning: could not parse config.toml` | Malformed TOML | Check or delete `~/.coder/config.toml` |
| `Error: model "<name>" not found` | Model name not in models_dir | Run `coder models list` to see available models |

---

## Development

```bash
bun test                    # all 143 tests
bun test tests/unit         # unit tests only
bun test tests/integration  # integration tests only
bun run build               # tsc --noEmit
bun run lint                # eslint .
```

### Project layout

```
src/
  cli/index.ts          # entry point, command registration
  commands/             # one file per command group
  config/               # config loader + types (smol-toml)
  inference/            # mlx-runner subprocess wrapper, memory gate, output parser
  models/               # model inspector, pull (HuggingFace HTTP), types
  adaptors/             # adaptor manager, manifest validation (Zod), types
  chat/                 # conversation history, ChatML formatting, sliding window
  observability/        # structured JSON logger, log event types
tests/
  unit/                 # pure function + mocked spawn tests
  integration/          # full CLI subprocess tests (CODER_DRY_RUN=1)
docs/
  spec.md               # full product spec
  session-prompt.md     # per-session agent context template
```

All code is written test-first. No implementation without a failing test first.

---

## Roadmap

See [STATUS.md](./STATUS.md) for progress against the spec and [open issues](https://github.com/falese/coder/issues) for the full backlog.

**Completed:** config (#5), model management (#3), generate streaming + TTFT (#2), observability (#10), memory safety gate (#15), preflight check (#17), adaptor install/list/update/info/remove (#6), chat REPL (#4), CI workflow (#13), data pipeline (#7).

**Next up:** adaptor train (#8) → adaptor eval (#9).
