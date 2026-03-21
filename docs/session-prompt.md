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

### Active issue

**#[5] — [Issue title]**

| [#5](https://github.com/falese/coder/issues/5) | Config management (`~/.coder/config.toml`) | Well scoped. Blocks making `--model`

refer to the above issue link from github.

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

> Paste the relevant sections from @docs/spec.md here.
> Only include what the agent needs for this issue — not the whole spec.

[e.g. for #5 Config, paste: Config file schema, CLI command surface for `coder config`, relevant parts of Architecture constraints]

---

## Current file tree

> Run `find . -type f | grep -v node_modules | grep -v .git | sort` and paste output here before starting.

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
./src/commands/generate.ts
./src/inference/mlx-runner.ts
./src/inference/types.ts
./tests/integration/generate.test.ts
./tests/unit/mlx-runner.test.ts
./tsconfig.json
```

---

## Existing tests (summary)

> Brief list of what the current test suite covers, so the agent doesn't duplicate.

- `parseMlxOutput` — parses mlx_lm stdout format, extracts token/s
- `runMlx` — subprocess error handling (missing mlx_lm, bad path, dry-run mode)
- CLI integration — `coder generate` end-to-end with `CODER_DRY_RUN=1`

---

## Open questions for this session

> List any decisions the agent may hit during implementation that aren't resolved in the spec.
> If you can resolve them now, do so. If not, note how the agent should handle ambiguity (e.g. "make it configurable", "stub it and note the TODO").

- TOML parser library: use `smol-toml` (pure TS, no native deps) — add to package.json
- Config file missing on first run: create with defaults silently, no error
- Unknown config keys: log WARN, ignore, do not error

---
