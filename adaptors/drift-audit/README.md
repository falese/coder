# drift-audit adaptor

Reads **one architectural decision** (an ADR clause) and the code that is supposed
to carry it, and emits a **typed drift finding** — a `hardened` check (a source
matcher) or a `semantic` finding (real drift that no matcher can express). It is the
governance twin of the `intent-manifest` pack: a model reads wide, emits a typed
artifact, and a **deterministic floor** downstream executes it. Precision comes from
the floor (a compiled-regex `verify`), not from the model.

- **Contract & spec:** `coder-drift-audit-adaptor-spec.md` (PDR-010, ADR-090).
- **Sibling generative lane:** the `intent-manifest` pack.

## This adaptor does NOT train

`drift-audit` is **inference-only / weightless**: a served, capable base model + a
system prompt + a typed output contract + retrieval context. There is **no corpus,
no `train.jsonl`, no `adaptor.safetensors`, no `coder adaptor train`**. The reasons
are settled (ADR-090): `n` is tiny (dozens of implemented-by fixes, not thousands),
and the corpus must stay current (new ADRs land weekly), so retrieval + judgment
beats weights — and the precision that matters comes from the deterministic floor,
not the model. If a fine-tune ever feels necessary here, that is the wrong instinct.

This is expressed in `manifest.json` as `"mode": "inference-only"` — a weightless
adaptor shape coder supports directly (see "Weightless adaptor support" below). No
`lora_rank`, `mlx_quant`, `min_memory_gb` or `eval_pass_rate` is faked to satisfy a
LoRA-shaped schema.

## Pack contents

| Path | What it is |
|---|---|
| `manifest.json` | Weightless adaptor manifest — `mode: "inference-only"`, no LoRA fields. |
| `prompts/system.md` | **The product.** The output contract: bare JSON array of `hardened \| semantic` findings, the precision discipline, "never certify clean", and 2–3 load-bearing few-shots. |
| `evals/eval_suite.ts` | The coder-side **smoke** eval (spec §6a) — schema conformance across `fixtures/`. |
| `fixtures/` | A handful of `{bundle, expect}` audit units, each with a recorded representative completion. |

There is deliberately **no** `train-config.toml`, `data/`, or `weights/`.

## The output contract (the narrow waist)

The model emits **only a JSON array** — no prose, no code fences — of findings, each
one of two variants, discriminated on `kind`:

- **`hardened`** — a drift expressible as a source matcher. Carries a `pattern` (a
  **regex source string**, not a `/…/` literal and not a RegExp), a stable `id`, the
  `enforces` ADR id, a developer-facing `message` + `fix`, an optional `exempt`
  regex, and a `confidence`. Emitted **only if** a concrete regex can be written.
- **`semantic`** — real drift that no matcher can express (ordering, a missing call,
  a behavioural mismatch). Carries `enforces`, `message`, `where`, `evidence`,
  `confidence`.

Discipline: hardened if you can write the matcher; else semantic; else emit nothing.
`enforces` MUST be an ADR id present in the bundle — never invented. **"No drift" is
not an allowed output** — return ranked low-confidence suspects and let triage
discard them; an empty array is reserved for "the bundle had no auditable decision."

The model **proposes candidates only**. A `hardened` check becomes a live gate only
after a human accepts it and it lands as plain code — the Trusting-Trust guardrail
(PDR-010). coder plugs into the proposal step, never the floor.

## Invocation

```sh
coder generate "Audit decision ADR-017 for drift between its stated rule and the code that carries it." \
  --adaptor drift-audit \
  --system adaptors/drift-audit/prompts/system.md \
  --context /tmp/adr-017.clause.md \
  --context /tmp/adr-017.impl.ts \
  --context /tmp/adr-017.provenance.md
```

One `generate` call audits **one ADR** (one audit unit): the ADR clause, the
implementing code, and bounded ADR-keyed provenance. Per-ADR rankings are merged
platform-side.

## Eval — split ownership

coder's composite (`tsc*0.4 + eslint*0.3 + tests*0.3`) is meaningless for JSON
findings, so the real signal is split:

**coder-side (this pack) — schema-conformance smoke (§6a):**

```sh
bun test ./adaptors/drift-audit/evals/eval_suite.ts
```

For each fixture it asserts the output parses as a JSON array, every element matches
the `hardened` or `semantic` shape, every `hardened.pattern` compiles via
`new RegExp(...)`, and every `enforces` is an ADR id that appeared in that fixture's
bundle. This proves the narrow waist holds — it does **not** prove the findings are
correct.

By default the smoke validates each fixture's recorded `completion.json` (so it is
green with no served model). In a coder-enabled env, run it against the **live
model** — it shells out to `coder generate` per fixture (needs `coder` on PATH and a
`default_model`):

```sh
CODER_DRIFT_LIVE=1 bun test ./adaptors/drift-audit/evals/eval_suite.ts
```

**platform-side (Sentinel/SMT, ADR-090) — git-mined recall + precision (§6b):**
the real oracle. For a known `implemented_by` fix, check out the commit before it,
assemble the bundle at that SHA, run the audit, and assert it emits a `hardened`
finding whose compiled `pattern` `verify()`s to a non-empty hit. This runs against
git history with Sentinel's `HardenedCheckSchema` + `verify`, **not in coder**, and
is tracked separately from this pack.

## Fixtures

| Fixture | Exercises |
|---|---|
| `adr-017-typed-errors` | The rediscovery loop (DoD §8-3): impl captured *before* the typed-errors migration; a `hardened` finding whose `pattern` matches `throw new Error(`. |
| `adr-030-idempotent-webhooks` | A `semantic` finding — an ordering constraint no regex expresses. |
| `adr-042-restraint` | Restraint (DoD §8-4): no clear drift → ranked **low-confidence** suspects, never a fabricated high-confidence hit, never empty. |
| `no-auditable-decision` | The one case where `[]` is valid — the bundle carries no ADR clause. |

Each fixture directory holds `bundle/` (the context files), `completion.json` (the
recorded representative output), and `expect.json` (the per-fixture assertions).

## Weightless adaptor support

`manifest.json` declares `"mode": "inference-only"`. coder's `ManifestSchema`
(`src/adaptors/types.ts`) accepts this shape: the LoRA-only fields (`lora_rank`,
`mlx_quant`, `min_memory_gb`, `eval_pass_rate`) are required only for `mode: "lora"`
packs (the default when `mode` is omitted, so every existing pack is unaffected).
`coder adaptor info` prints the mode and skips the LoRA rows, and `coder generate`
only hands mlx an `--adapter-path` when a `weights/` dir actually exists — so
`--adaptor drift-audit` supplies the pack identity while the system prompt is passed
explicitly with `--system`.

## Model

The few-shots in `prompts/system.md` were written against a capable served
instruct/reasoning model (`Qwen2.5-Coder-7B-Instruct-4bit` as the reference pick).
The exact model is a coder-side choice; the bar is only "good enough to propose,"
because the deterministic floor (`verify`) supplies precision (spec §6, ADR-090).
Do not gate on the model's self-reported `confidence` — it is a ranking hint;
`precision@k` on the §6b eval is what matters.
