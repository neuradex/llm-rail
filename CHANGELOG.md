# Changelog

## 1.0.0 — Declarative Orchestration

First stable release. Implements RFC 0001 (`docs/rfc/0001-declarative-orchestration.md`).

The legacy pre-1.0 workflow format is no longer executed. The runtime accepts only **v1** workflows (files with `format: v1`). A migration tool ships in this release; running it on an existing workflow once is the upgrade path.

### Highlights

- **Workflows are functions.** Every workflow declares an `input:` and `output:` schema. A v1 workflow is `(Input) → Output`.
- **Four step types, one purpose each.** `agentic` for judgment, `programmatic` for deterministic transforms, `router` for branching, `call` for sub-workflow composition.
- **Stateless execution.** No global store, no `lrail.set/get/goto`. All data flows through `context_in` references and step outputs. Recursive `call` carries accumulator state through inputs.
- **Schemas as the contract.** Named JSON Schema (2020-12 minimal subset) declarations in a `schemas:` block. Structural validation moves into the schema; only non-structural rules (`script`, `verify_source`) remain as `validation:` / `assertions:` on the step.
- **Static verification.** `lrail wf <name> compile` catches schema, reference, router-reachability, recursion-bound, and cross-workflow IO problems before a single step runs.
- **Structured export.** `lrail wf <name> graph --json` emits a stable JSON shape (nodes, control_edges, data_edges, input_refs) for visualizers and editors. Consumers no longer parse YAML.

### CLI

New:
- `lrail wf <name> compile [--path <file>] [--registry <dir>]`
- `lrail wf <name> graph --json [--path <file>]`
- `lrail wf <name> migrate [--path <file>] [--output <file>] [--dry-run]`

Updated:
- `lrail wf <name> create / start / next / status / query / log / reset / tool / bash` all run against v1 instances.
- `lrail wf <name> validate` now forwards to `compile` (a strict superset).
- `lrail wf <name> show / summary / promote / list` rewritten for v1.

Removed:
- `lrail wf <name> merge` is temporarily disabled. v1 variant semantics will land in a follow-up RFC; until then, the command surfaces a migration message.

### Removed concepts

These pre-1.0 features no longer exist:

- `lrail.set`, `lrail.get`, `lrail.goto` (use `context_in`, return values, and `router`)
- `tips:` (fold into the step's `instruction`)
- `accumulate:` (express as a recursive `call` with an input buffer — see `concepts/call`)
- workflow lifecycle hooks (12 events fired into shell scripts; use `audit.jsonl` instead)
- the `state.context` global store
- `validation:` rules whose op is structural (`type`, `min_length`, `min`, `enum`, ...) — these move into the schema; non-structural ops (`script`, `verify_source`, `matches`, `each_has`) remain
- the bundled `lrail-build` and `lrail-optimize` workflows + their `/llm-rail:build` and `/llm-rail:optimize` skills (will return as opt-in templates if there is demand)

### Engine

Implementation lives in `src/engine/*-v1.ts` and `src/types-v1.ts`. The legacy modules (`actions.ts`, `runner.ts`, `context.ts`, `validator.ts`, `output.ts`, `dependency.ts`, `hooks.ts`, `tip-pool.ts`, plus the legacy halves of `state.ts` / `workflow.ts`) are gone. AssertionRule operators were preserved on the v1 side as `engine/ops-v1.ts` for use by `router` and residual step `validation:` / `assertions:`.

### Migration

```bash
lrail wf <name> migrate --path workflows/<name>/workflow.yml
```

Produces `<name>.migrated.yml` with TODO markers wherever automatic conversion isn't safe (`lrail.set/get/goto` use, `accumulate:` blocks, `tools:` with implicit shapes). Review the file and rename it to `workflow.yml` once happy.

Pre-1.0 instances cannot be resumed. The CLI surfaces a clear message asking you to migrate the workflow and create a fresh instance.

### Tests

55 test suites, 125 tests. End-to-end CLI smoke runs `create → start → next → completion` on a v1 workflow with both programmatic and agentic steps and verifies schema rejection on bad agent submissions.

---

## 0.4.x and earlier

Pre-1.0 development releases. See git history for incremental change log.
