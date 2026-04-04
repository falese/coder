# Plan: Better React/MUI Training Dataset

## Context

The react-ts adaptor trains on ~144 records extracted from the MUI and module-federation repos.
The eval set has only 5 records. Component coverage is narrow (Button, TextField, List, useTheme).
Extraction anchors require JSDoc comments, which not all good React/MUI code has.

Target outcome: 500–1 000 deduplicated training records with broad component coverage, driving a
meaningfully higher eval composite after retraining.

---

## What's wrong with the current dataset

| Problem | Detail |
|---|---|
| Volume | 144 records is too few for generalisation |
| Component breadth | Grid, Stack, Card, Dialog, Select, Checkbox, Table absent from eval |
| Anchor coverage | JSDoc-only misses well-written components that use `//` comments or none |
| Eval set size | 5 records → statistically meaningless composite score |

---

## Step 1 — New source repositories

Target repos with dense, well-typed React+MUI TypeScript code:

| Repo | Why |
|---|---|
| `mui/toolpad` | MUI's own low-code builder; highest-quality internal MUI usage |
| `marmelab/react-admin` | Most-used MUI admin framework; thousands of typed, well-structured components |
| `mui/material-ui` → `docs/data/material/components/` | Official demo files; one component per file, idiomatic usage |

Clone each locally, then run the existing pipeline against them:

```bash
coder data ingest "<repo>/packages/**/*.tsx"
coder data extract --adaptor react-ts
```

---

## Step 2 — New extraction anchor: `react_component`

Add a fourth prompt anchor to `src/data/extract.ts` that captures React components without
requiring a JSDoc block.

**Pattern to match (any of):**
```
export function [A-Z]\w+          ← named exported component
export default function [A-Z]\w+
export const [A-Z]\w+: React.FC   ← React.FC typed constant
export const [A-Z]\w+ = (         ← capital-name arrow component
```

**Completion anchor:** `next_function` (reuse existing brace-depth extractor)

**Rationale:** MUI docs demos and react-admin use this pattern universally. JSDoc coverage in
those repos is sparse; component exports are universal.

### Files to change

| File | Change |
|---|---|
| `src/data/extract.ts` | Add `react_component` case to anchor matching |
| `src/data/types.ts` | Add `"react_component"` to `PromptAnchor` union |
| `adaptors/react-ts/extract.json` | Add `{ "prompt": "react_component", "completion": "next_function" }` |
| `src/data/extract.test.ts` | Tests for new anchor (TDD — write test first) |

---

## Step 3 — Expand the eval set

Move from 5 → ~30 hand-written records in `adaptors/react-ts/data/eval.jsonl`.

| Category | Count |
|---|---|
| Layout — Grid, Stack, Box | 5 |
| Form controls — Select, Checkbox, Radio, Autocomplete | 6 |
| Containers — Card, Dialog, Drawer, Modal | 6 |
| Data display — Table, Chip, Badge, Tooltip | 5 |
| Navigation — Tabs, Breadcrumbs, Stepper | 4 |
| Existing (Button, TextField, List, useTheme) | 4 |

Each record: `{ "prompt": "<jsdoc or line_comment>", "completion": "<correct impl>" }`

These are committed to the repo (unlike train.jsonl which is gitignored). A larger eval set
makes the composite score a meaningful signal rather than noise over 5 samples.

---

## Step 4 — Run pipeline end-to-end

```bash
# Ingest + extract from each new repo, append to a combined file
coder data ingest "mui-toolpad/packages/**/*.tsx"    >> raw.jsonl
coder data ingest "react-admin/packages/**/*.tsx"    >> raw.jsonl
coder data ingest "mui/docs/data/**/*.tsx"           >> raw.jsonl

# Extract prompt/completion pairs using updated extract.json
coder data extract --adaptor react-ts                # reads raw.jsonl, writes extracted.jsonl

# Clean up
coder data deduplicate extracted.jsonl               # exact + Jaccard 85%
coder data validate deduped.jsonl
coder data split deduped.jsonl                       # 90/10 → train.jsonl + valid.jsonl

# Verify
coder data stats train.jsonl                         # target: count > 500, p95 completion < 512 tokens
```

---

## Verification

1. `bun test src/data/extract.test.ts` — new anchor tests pass
2. `tsc --noEmit` — clean
3. `eslint .` — clean
4. `coder data stats train.jsonl` — confirm count > 500, reasonable token distribution
5. Retrain: `coder adaptor train --config adaptors/react-ts/train-config.toml`
6. `coder adaptor eval react-ts` — composite should exceed 0.920; expanded eval set may
   expose genuine gaps, which is useful signal even if the number looks lower initially

---

## What this does NOT include

- No changes to the eval harness scoring logic
- No new CLI commands
- No synthetic data generation (future option if OSS extraction underperforms)
- No changes to LoRA hyperparameters (separate concern)
- No change to training infrastructure
