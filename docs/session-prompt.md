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

## Session: 2026-04-05

### Active issue

**[#41](https://github.com/falese/coder/issues/41) — feat: coder data prompts — manage the SSD prompt log**

Add a `coder data prompts` subcommand for inspecting and managing `prompt-log.jsonl`.
Depends on #40 (already merged). The prompt-log lives at `adaptors/<name>/data/prompt-log.jsonl`.

---

## Spec context

### Prompt-log.jsonl schema (from #40)

```jsonl
{"prompt": "add a confirm dialog with cancel and submit", "ts": "2026-04-05T19:23:12.935Z", "adaptor_version": "2.0.5"}
```

`adaptor_version` is optional — may be absent for older entries.

### Subcommand surface

```
coder data prompts list --adaptor <name>                       # print all prompts with timestamps
coder data prompts stats --adaptor <name>                      # count + token distribution
coder data prompts deduplicate --adaptor <name>                # deduplicate in-place, report removed count
coder data prompts purge --adaptor <name> --before <ISO-date>  # remove entries older than date
coder data prompts purge --adaptor <name> --below-tokens <n>   # remove entries below token threshold
```

### Implementation notes

All subcommands:
- Resolve adaptor dir: `join(config.adaptors_dir, adaptorName)`
- Prompt-log path: `join(adaptorDir, "data", "prompt-log.jsonl")`
- Hard error if `--adaptor` not given or adaptor dir does not exist
- Hard error if `prompt-log.jsonl` does not exist (for all subcommands except `purge`, which is a no-op)

**`list`** — print one entry per line: `[<ts>] <prompt>` (truncate prompt to 80 chars for display)

**`stats`** — print:
```
Total prompts:   N
Unique prompts:  N
Token estimate:  min=X  p50=X  p95=X  max=X
```
Token estimate = `(prompt.length / 4)`, same heuristic used throughout.

**`deduplicate`** — exact dedup only (preserve first occurrence of each prompt string).
Write back in-place. Print: `Removed N duplicate entries. N remaining.`

**`purge --before <date>`** — parse ISO date string; remove entries where `entry.ts < date`.
Requires `--confirm` flag — without it, prints dry-run summary and exits 0 without modifying.
Print: `Would remove N entries older than <date>. Run with --confirm to apply.` / `Removed N entries.`

**`purge --below-tokens <n>`** — remove entries where `prompt.length / 4 < n`.
Same `--confirm` requirement. Both `--before` and `--below-tokens` may be combined.

### Adding to `createDataCommand`

`src/commands/data.ts` already exports `createDataCommand()`. Add a `prompts` subcommand:

```typescript
const promptsCmd = new Command("prompts").description("Manage the SSD prompt log");
promptsCmd.addCommand(/* list, stats, deduplicate, purge */);
cmd.addCommand(promptsCmd);
```

---

## Files to change

| File | Change |
|---|---|
| `src/commands/data.ts` | Add `prompts` subcommand with `list`, `stats`, `deduplicate`, `purge` |
| `tests/unit/data-prompts.test.ts` | New test file — all subcommand logic |

No changes needed to `src/adaptors/prompt-log.ts` — existing exports cover what's needed.

---

## TDD order

Write failing tests first, then implementation. All tests use a temp adaptor dir with seeded `prompt-log.jsonl`.

1. `list` prints entries with timestamps and truncated prompts
2. `list` errors if prompt-log absent
3. `stats` reports correct count, unique count, token min/p50/p95/max
4. `deduplicate` removes exact duplicates in-place, reports removed count
5. `deduplicate` with no duplicates reports 0 removed
6. `purge --before <date>` without `--confirm` prints summary, does not modify file
7. `purge --before <date> --confirm` removes correct entries
8. `purge --below-tokens <n> --confirm` removes short entries
9. `purge --before --below-tokens --confirm` applies both filters

---

## Existing tests (summary)

355 tests passing across 29 files. Do not duplicate existing coverage.
