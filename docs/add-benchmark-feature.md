# Plan: Manifest-driven benchmark via `coder adaptor eval --livecode`

## Context

The existing `coder adaptor eval` scores domain-specific quality (TSC 40% + ESLint 30% + custom test suite 30%) — preserved unchanged. What's missing is a separate, execution-based measure of general coding ability per adaptor. This PR adds:

1. An optional `benchmark` field in the adaptor manifest (Zod-validated) that specifies which HuggingFace dataset + language config to use
2. A `--livecode` flag on `coder adaptor eval <name>` that reads the manifest benchmark config and runs execution-based pass@1 scoring
3. The `react-ts` manifest gets `"config": "humaneval-ts"` (MultiPL-E TypeScript)

A Python adaptor would set `"config": "humaneval-py"`, a Go adaptor `"humaneval-go"` — the CLI is generic. No Python dependency required — MultiPL-E test harnesses are TypeScript and run directly under Bun.

---

## Architecture

```
coder adaptor eval react-ts --livecode
│
├── Existing flow (unchanged): runEval() → composite (TSC/ESLint/tests)
│
└── --livecode branch:
    1. readManifest(adaptorDir)           ← src/adaptors/manager.ts (existing)
       → manifest.benchmark = { dataset, config, limit }
       → error if benchmark field absent
    2. fetchBenchmarkProblems(dataset, config, limit)
       → HF datasets-server API, generic per dataset/config
    3. For each problem:
       a. runMlxBuffered() → raw completion
       b. cleanGeneratedOutput() → clean function body
       c. Write temp .ts: completion + "\n" + problem.tests
       d. Bun.spawn(["bun", tempPath]) → exit 0 = pass
    4. Compute pass@1 = passes / total
    5. Print table + log eval_complete_livecode event
```

---

## Files to create / modify

### MODIFY: `src/adaptors/types.ts`

Current schema (lines 3–15) gains an optional `benchmark` field:

```typescript
const BenchmarkConfigSchema = z.object({
  dataset: z.string().min(1),   // e.g. "nuprl/MultiPL-E"
  config: z.string().min(1),    // e.g. "humaneval-ts"
  limit: z.number().int().positive().default(20),
});

// Add inside ManifestSchema:
benchmark: BenchmarkConfigSchema.optional(),
```

Export `BenchmarkConfig = z.infer<typeof BenchmarkConfigSchema>` from the same file.

---

### MODIFY: `adaptors/react-ts/manifest.json`

Add `benchmark` field:
```json
"benchmark": {
  "dataset": "nuprl/MultiPL-E",
  "config": "humaneval-ts",
  "limit": 20
}
```

---

### NEW: `src/eval/multipl-runner.ts`

```typescript
export interface BenchmarkProblem {
  name: string;
  prompt: string;
  tests: string;
  stop_tokens: string[];
}

export interface MultiPLEvalOptions {
  modelPath: string;
  adaptorPath?: string;
  dryRun: boolean;
  dataset: string;      // from manifest.benchmark.dataset
  config: string;       // from manifest.benchmark.config
  limit: number;        // from manifest.benchmark.limit
  temperature?: number; // default 0.0 (greedy = deterministic pass@1)
}

export interface MultiPLRecord {
  name: string;
  passed: boolean;
}

export interface MultiPLEvalSummary {
  records: MultiPLRecord[];
  passAt1: number;
}
```

Exported functions:

- **`fetchBenchmarkProblems(dataset: string, config: string, limit: number): Promise<BenchmarkProblem[]>`**  
  URL: `https://datasets-server.huggingface.co/rows?dataset={dataset}&config={config}&split=test&offset=0&length={limit}`  
  Maps HF rows to `BenchmarkProblem`. Throws on HTTP error.

- **`runMultiPLEval(adaptorDir: string, opts: MultiPLEvalOptions): Promise<MultiPLEvalSummary>`**  
  Dry-run: return `{ records: [], passAt1: 0.5 }` without spawning.  
  Per problem: generate → clean → write `os.tmpdir()/coder-bench-{ts}.ts` → `bun <path>` → parse exit code → delete temp.  
  Calls `checkPreflight()` before first spawn.

- **`formatMultiPLTable(summary: MultiPLEvalSummary, config: string): string`**  
  Header: `MultiPL-E [humaneval-ts]`. Columns: PROBLEM (42 chars), PASS. Mean row = pass@1.

Reuses: `runMlxBuffered`, `cleanGeneratedOutput`, `checkPreflight`, `logger.logEvent`.

---

### MODIFY: `src/commands/adaptor.ts`

Add two options to `eval <name>` (after line 151):
```typescript
.option("--livecode", "Run manifest benchmark (pass@1) alongside domain eval")
.option("--limit <int>", "Override manifest benchmark.limit")
```

Update options type to add `livecode?: boolean; limit?: string;`.

After the existing `runEval()` block, inside the same try/catch, add:
```typescript
if (options.livecode === true) {
  const manifest = readManifest(adaptorDir);
  if (!manifest.benchmark) {
    process.stderr.write(
      `Error: adaptor "${name}" manifest.json has no "benchmark" field\n`
    );
    process.exit(1);
  }
  const mplSummary = await runMultiPLEval(adaptorDir, {
    modelPath: modelPath ?? "",
    adaptorPath,
    dryRun,
    dataset: manifest.benchmark.dataset,
    config: manifest.benchmark.config,
    limit: options.limit ? parseInt(options.limit, 10) : manifest.benchmark.limit,
  });
  process.stdout.write("\n" + formatMultiPLTable(mplSummary, manifest.benchmark.config) + "\n");
  process.stdout.write(`MultiPL-E pass@1: ${mplSummary.passAt1.toFixed(3)}\n`);
  logger.logEvent({
    event: "eval_complete_livecode",
    ts: new Date().toISOString(),
    adaptor: name,
    dataset: manifest.benchmark.dataset,
    config: manifest.benchmark.config,
    pass_at_1: mplSummary.passAt1,
    problem_count: mplSummary.records.length,
  });
}
```

Add imports: `runMultiPLEval`, `formatMultiPLTable` from `../eval/multipl-runner.js`.

---

### NEW: `tests/unit/multipl-runner.test.ts`

Six tests (TDD — write first, confirm red, then implement):

| # | Test | Setup |
|---|------|--------|
| 1 | `fetchBenchmarkProblems("nuprl/MultiPL-E", "humaneval-ts", 5)` returns 5 records | Mock `globalThis.fetch` returning HF API shape |
| 2 | `fetchBenchmarkProblems` constructs correct URL with dataset + config params | Capture fetch URL in mock |
| 3 | `runMultiPLEval` dry-run returns `passAt1: 0.5`, no `Bun.spawn` call | `dryRun: true`; assert spawn not called |
| 4 | `runMultiPLEval` spawns `bun <tempPath>` and counts 3 pass + 2 fail = 0.6 | Mock spawn alternating exit codes |
| 5 | `runMultiPLEval` with manifest missing `benchmark` throws before spawning | Pass opts with empty dataset string |
| 6 | `formatMultiPLTable` output contains config name in header and pass@1 mean | Pure string assertion |

---

### MODIFY: `tests/unit/adaptor-manager.test.ts`

Three new tests for the manifest `benchmark` schema field:

- Manifest with valid `benchmark` object parses successfully
- Manifest without `benchmark` parses successfully (field is optional)
- Manifest with invalid `benchmark` (missing `dataset`) throws `ZodError`

---

## Existing functions reused (do NOT re-implement)

| Function | File |
|---|---|
| `runMlxBuffered` | `src/inference/mlx-runner.ts` |
| `cleanGeneratedOutput` | `src/eval/runner.ts` |
| `checkPreflight` | `src/inference/mlx-runner.ts` |
| `readManifest` | `src/adaptors/manager.ts` |
| `loadConfig` / `getAdaptorsDir` | `src/config/loader.ts` |
| `logger.logEvent` | `src/observability/logger.ts` |

---

## Verification

```bash
# 1. TDD — write tests, confirm red
bun test tests/unit/multipl-runner.test.ts
bun test tests/unit/adaptor-manager.test.ts

# 2. Implement; confirm green
bun test tests/unit/multipl-runner.test.ts

# 3. Type check + lint
bun run build && bun run lint

# 4. Full suite — no regressions
bun test

# 5. Dry-run smoke test
CODER_DRY_RUN=1 bun run generate -- adaptor eval react-ts --livecode --limit 5

# 6. Live test (requires mlx + model)
coder adaptor eval react-ts --livecode --limit 10
```

Expected output after existing composite table:
```
MultiPL-E [humaneval-ts]
PROBLEM                                    PASS
──────────────────────────────────────────────
two_sum                                    ✓
fibonacci                                  ✗
...
PASS@1                                     0.600

MultiPL-E pass@1: 0.600
```

---

## Commit message

```
feat: manifest-driven benchmark via coder adaptor eval --livecode

Adds optional benchmark field to adaptor manifest (Zod-validated).
coder adaptor eval <name> --livecode reads dataset/config/limit from the
manifest and runs execution-based pass@1 scoring via the HuggingFace
datasets-server API + Bun subprocess. react-ts manifest updated with
nuprl/MultiPL-E / humaneval-ts. Existing domain eval unchanged.
```
