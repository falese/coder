# Coder — Project Status

> Last updated: 2026-03-21

---

## Progress against base prompt

The base prompt defines seven objectives. Status tracked below.

| # | Objective | Status | Notes |
|---|---|---|---|
| 1 | CLI framework | 🟡 Skeleton | `generate` command end-to-end; no streaming, no `--adaptor`, no config |
| 2 | Model management | 🔴 Not started | No `models list/pull/info`; model path is a raw CLI flag |
| 3 | LoRA adaptor framework | 🔴 Not started | `--adaptor` flag wired to mlx_lm not yet built |
| 4 | Dataset curation tooling | 🔴 Not started | No JSONL pipeline |
| 5 | Adaptor training pipeline | 🔴 Not started | No `mlx_lm.lora` wrapper |
| 6 | Quality scoring and eval harness | 🔴 Not started | No scorer, no eval suite runner |
| 7 | Observability | 🔴 Not started | No structured logging, no metrics emission |

### What the walking skeleton delivered

- `coder generate "<prompt>" --model <path>` — spawns `mlx_lm.generate`, parses stdout, prints to stdout
- `parseMlxOutput` — pure parser for mlx_lm output format with token/s extraction
- `runMlx` — subprocess runner with actionable error handling (missing mlx_lm, bad model path)
- Dry-run mode via `CODER_DRY_RUN=1` for integration testing without a real model
- 10 tests (6 unit, 4 integration), `tsc --noEmit` clean, ESLint clean

### What the skeleton does not cover

- Streaming (buffered only — adequate for skeleton, not for production UX)
- LoRA adaptor loading (`--adaptor` flag not wired)
- Config file (model path required on every invocation)
- `chat`, `models`, `adaptor`, `data` commands
- Observability (no timing, no structured logs)
- File output (`-o` flag)
- Context injection (`--context` flag)

**Rough completion: ~5% of the full platform.**

---

## Backlog overview

11 open issues across four phases.

### Phase 1 — Foundation (unblock everything else)

| Issue | Title | Assessment |
|---|---|---|
| [#5](https://github.com/falese/coder/issues/5) | Config management (`~/.coder/config.toml`) | Well scoped. Blocks making `--model` optional. Start here. |
| [#3](https://github.com/falese/coder/issues/3) | Models: list, pull, info, memory reporting | Mostly clear. One open question (see below). |

### Phase 2 — Core UX

| Issue | Title | Assessment |
|---|---|---|
| [#2](https://github.com/falese/coder/issues/2) | Generate: streaming, `--adaptor`, file output, context | Mostly clear. Streaming implementation detail needs decision (see below). |
| [#4](https://github.com/falese/coder/issues/4) | Chat: interactive multi-turn REPL | Significant hidden complexity (see below). |

### Phase 3 — Adaptor platform

| Issue | Title | Assessment |
|---|---|---|
| [#6](https://github.com/falese/coder/issues/6) | Adaptor: install, list, update, info + manifest validation | Well scoped. New dependency (Zod) needs adding to package.json. |
| [#7](https://github.com/falese/coder/issues/7) | Data: JSONL curation pipeline | The `data extract` command is underdefined (see below). |

### Phase 4 — Training loop and quality

| Issue | Title | Assessment |
|---|---|---|
| [#8](https://github.com/falese/coder/issues/8) | Adaptor train: LoRA training pipeline | Well scoped. Checkpoint resumption needs mlx_lm.lora flag investigation. |
| [#9](https://github.com/falese/coder/issues/9) | Adaptor eval: quality scoring harness | Most complex issue in the backlog. Significantly underdefined (see below). |
| [#10](https://github.com/falese/coder/issues/10) | Observability: structured logging and metrics | Well scoped. TTFT measurement approach needs decision (see below). |

### Phase 5 — Domain adaptor packs

| Issue | Title | Assessment |
|---|---|---|
| [#11](https://github.com/falese/coder/issues/11) | React/TS adaptor pack | Platform must be complete first. Data sourcing is vague (see below). |
| [#12](https://github.com/falese/coder/issues/12) | GraphQL adaptor pack | Blocked by #11. Same data sourcing concerns apply. |

---

## Items needing further definition

### 🔴 High priority — blocks implementation

#### #4 Chat: chat template handling
The issue says "detect chat template from `tokenizer_config.json`". In practice, chat templates are Jinja2 strings embedded in the tokenizer config and vary significantly across model families. The implementation needs a decision:
- **Option A:** Shell out to Python: `python -c "from mlx_lm import load; ..."` to apply the template server-side before passing to `mlx_lm.generate` — avoids re-implementing Jinja2 in TypeScript
- **Option B:** Hard-code templates for the two supported models (Qwen2.5-Coder, DeepSeek-Coder) and refuse others
- **Option C:** Accept a raw `--system` prompt and delegate formatting to mlx_lm's built-in chat template handling

**Recommendation:** Option C for v1. Needs a decision before #4 can be estimated.

#### #4 Chat: context window overflow
The issue is silent on what happens when conversation history exceeds the model's context window (typically 8k–32k tokens for 7B models). Without a truncation strategy, the chat command will silently degrade or error mid-session. Needs a defined behaviour (e.g. sliding window, summarisation, hard stop with warning).

#### #7 Data: `data extract` heuristics
The issue says "applies heuristics to split files into prompt/completion pairs (e.g. comment → code block)". This is a non-trivial NLP problem. The heuristic is completely unspecified:
- What constitutes a "prompt"? A JSDoc comment? A `// TODO` line? A function signature?
- What constitutes a "completion"? The function body? The whole file?
- How are boundaries detected?

This needs concrete extraction rules defined before implementation. Suggested approach: define a small DSL in the adaptor's `prompts/system.md` that specifies extraction patterns, rather than one-size-fits-all heuristics. **Needs a design spike before #7 can proceed.**

#### #9 Adaptor eval: embedding similarity scorer
The issue proposes TF-IDF cosine similarity as a v1 "fallback". In practice, TF-IDF similarity of code is a weak signal — two functionally identical React components written differently will score poorly. This scoring dimension (0.15 weight) may not be worth implementing in v1 given the implementation cost vs. signal quality. The issue needs a decision:
- **Option A:** Drop embedding similarity from v1; composite score is tsc + eslint + test pass rate only (renormalise weights)
- **Option B:** Use a lightweight local embedding model (e.g. `all-MiniLM-L6-v2` via Python subprocess)
- **Option C:** Keep TF-IDF but mark the score as `experimental` in output

**Recommendation:** Option A for v1. Reduces scope significantly without compromising the three high-signal dimensions.

#### #9 Adaptor eval: eval suite format
The issue says `evals/eval_suite.ts` is "run with `bun test`" but doesn't specify how generated code is injected into the test. How does the test file reference generated output? Options:
- Generated file written to a known temp path; test imports from that path
- Test receives generated code as a string via env var
- Each eval record generates a file, runs the test, then deletes it

This needs a concrete format spec with an example before adaptor authors can write eval suites. **Needs a design decision before #9 and #11/#12 can proceed.**

---

### 🟡 Medium priority — needs clarification before sprint

#### #3 Models: download mechanism
The issue says "fetches via `huggingface_hub` (Python subprocess)". This is a valid approach but adds a Python dependency that may not be installed. An alternative is direct HTTP download of model files via the HuggingFace API (no Python required beyond mlx_lm itself). Needs a decision: Python subprocess vs. native HTTP.

#### #2 Generate: streaming implementation
`mlx_lm.generate --stream` prints tokens to stdout as they are generated. Buffered reading (`new Response(proc.stdout).text()`) will not work for streaming — the process doesn't close stdout until generation ends. The issue notes this but doesn't specify the implementation. In Bun, streaming stdout requires reading from the `ReadableStream` in chunks. The approach needs to be defined and a prototype written before streaming can be tested properly.

#### #10 Observability: TTFT measurement
The issue defines TTFT as "time from process start of mlx_lm subprocess to first non-empty stdout byte". In Bun's spawn API, with `stdout: "pipe"`, you can read the stream incrementally. The implementation needs to record `Date.now()` at spawn time and capture it again on the first chunk. This is straightforward but the current `runMlx` architecture (buffered) needs to be refactored to support it alongside streaming (#2). These two issues should be implemented together.

#### #8 Adaptor train: checkpoint resumption
`mlx_lm.lora` supports `--resume-adapter-file` to continue training from an existing adaptor file. The issue says "training can be resumed if `weights/adaptor.safetensors` already exists" but doesn't specify whether this is automatic or requires a `--resume` flag. Needs a decision.

---

### 🟢 Low priority — gaps to address eventually

#### Missing issue: CI/CD pipeline
No issue exists for GitHub Actions. A basic workflow (install deps, `bun test`, `tsc --noEmit`, `eslint .`) on every push is a gap. Should be added to the backlog.

#### Missing issue: performance benchmarking
The base prompt specifies hard performance targets (first token < 2s, sustained > 20 tok/s on M3). No issue tracks measuring or validating these targets against a real model. The observability issue (#10) captures the metric emission, but there is no issue for a benchmark harness or pass/fail gate.

#### Missing issue: README and documentation
The README currently reads "lets try this". No issue tracks writing usage documentation, installation instructions, or adaptor author guides.

#### Missing issue: memory safety check
The base prompt specifies a 18GB memory constraint and requires the CLI to expose memory usage. No issue tracks enforcing this — e.g. refusing to load a model + adaptor combination that would exceed available unified memory, or warning when headroom is low.

#### #6 Adaptor install: registry protocol undefined
The issue notes "future: hosted registry with `coder adaptor install <name>` resolution" but gives no detail on the registry API, discovery mechanism, or namespace. This is intentionally deferred but should be stubbed as a separate issue so it doesn't get designed ad-hoc when someone tries to implement it.

---

## Dependency map

```
#5 config
  └── unblocks: all other commands (--model becomes optional)

#3 models
  └── unblocks: #11, #12 (need a real model downloaded)

#2 generate (streaming + adaptor flag)
  └── depends on: #5 config, #6 adaptor commands
  └── should be co-implemented with: #10 observability (TTFT needs streaming)

#4 chat
  └── depends on: #5 config, #2 generate (shares streaming + adaptor infrastructure)
  └── needs: chat template decision (see above)

#6 adaptor (install/list/info)
  └── depends on: #5 config (adaptors_dir path)
  └── unblocks: #2 (--adaptor flag), #8 train, #9 eval, #11, #12

#7 data pipeline
  └── independent — can start anytime
  └── needs: `data extract` heuristics defined (see above)
  └── unblocks: #11, #12

#8 adaptor train
  └── depends on: #6 adaptor, #7 data pipeline

#9 adaptor eval
  └── depends on: #6 adaptor, #8 train
  └── needs: eval suite format defined, embedding scorer decision (see above)

#10 observability
  └── should be co-implemented with: #2 generate (streaming refactor)

#11 react-ts adaptor
  └── depends on: #2, #6, #7, #8, #9 (full platform)

#12 graphql adaptor
  └── depends on: #11
```

---

## Recommended next actions

1. **Resolve the three blocking design questions** before writing any code: chat template strategy (#4), `data extract` format (#7), eval suite injection format (#9). These decisions affect multiple issues downstream.
2. **Start with #5 (config)** — it's the smallest self-contained issue and immediately improves UX by making `--model` optional.
3. **Implement #2 and #10 together** — streaming and TTFT measurement are tightly coupled; doing them separately will require re-opening one of them.
4. **Create three missing issues** — CI/CD pipeline, performance benchmarking, README — before the backlog is considered complete.
