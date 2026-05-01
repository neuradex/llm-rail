---
name: design-tips
description: Design principles and anti-patterns for v1 workflows
---

## Workflow Design Principles

### 1. One clear output per step

Each step produces a single, well-defined deliverable whose shape is named in `schemas:`. If a step does two unrelated things, split it — named units are the cost of v1 and also its value.

### 2. Pick the right step type

See `concepts/step-types` for full criteria.

- `programmatic` for deterministic work: filtering, sorting, arithmetic, API calls, reshaping.
- `agentic` only when LLM judgment is needed: analysis, review, synthesis.
- `router` only for real branches or bounded loops. Don't add one for linear flow.
- `call` only for reuse or recursion. Don't extract a one-action helper into its own workflow.

Prefer `programmatic` — it's faster, cheaper, and deterministic.

### 3. required_output = shape actually consumed

Don't ask for data nobody uses. Every field in a step's `required_output` schema should appear in a downstream `context_in`, in the final workflow `output`, or in an assertion. If the last step drops a field, the schema shouldn't require it.

### 4. Explicit data flow with context_in

The only data channel is `context_in`. Every cross-step reference declares exactly what it needs and from where:

```yaml
- id: step-b
  context_in:
    items: "{step-a.items}"
    threshold: "{{threshold}}"
```

There is no implicit merge of prior outputs, no global store.

### 5. validation vs assertions

See `concepts/validation` for operator reference.

- **Schema** (in `schemas:`): structural shape — type, length, range, enum, required fields.
- **`validation:`** (on the step): non-structural, pre-completion — `script`, `verify_source`, regex match, each-item checks.
- **`assertions:`** (on the step): post-completion, cross-step or cross-field invariants.

If a rule is expressible as a JSON Schema keyword, put it in the schema.

### 6. Actionable prompts

Agentic `instruction` must be directive, not suggestive. Encode domain knowledge inline:

```yaml
instruction: |
  Extract each company's PER (trailing twelve months, not forward).
  If a metric is unavailable, return null — never guess.
  Sentiment must be one of: positive, neutral, negative.
```

v1 has no separate `tips:` field. If the prompt is getting long, split the step.

See `concepts/step-types` "Agent selection" for step-runner vs general-purpose constraints — prompts that mention WebSearch/WebFetch require a general-purpose agent.

### 7. Schemas as the contract surface

When you change a shape, change its schema name or version. Consumers (downstream steps, `call` sites, Loom visualizers) read schemas as the contract. Drifting a schema without renaming is a silent breaking change.

### 8. Bound loops and recursion

- `router` backward goto → declare `max_iterations`. Compile enforces this.
- `call` that can reach itself → declare `max_depth`. Compile enforces this.

These aren't nannying — they prevent runaway cost.

### 9. Policy when agents run commands

See `concepts/policy`. Start with `trail` mode during development, then switch to `enforce` with a minimal allow-list.

## Anti-Patterns

### Deterministic work masquerading as agentic

LLMs will manipulate data to pass validation. If the transform is deterministic, the step type is `programmatic`.

Bad:
```yaml
- id: filter
  type: agentic
  instruction: "Return items where score > 80"
  required_output: FilteredItems
```

Good:
```yaml
- id: filter
  type: programmatic
  context_in:
    items: "{collect.items}"
  required_output: FilteredItems
  actions:
    - name: score-filter
      description: Keep items with score > 80
      js: |
        return { filtered: context.items.filter(x => x.score > 80) };
```

### Design for the weakest model

If Haiku will run this workflow, assume it will:
- Fabricate data when it can't find real data
- Round numbers and use suspiciously clean values
- Optimize for passing validation over being correct

Guard against this with `programmatic` steps, strict schemas, and `verify_source` assertions for data that must actually exist.

### Start coarse, refine later

It is easier to split a step than to merge two. Start with 3–5 steps and add granularity as gates in the larger schemas reveal real sub-structure.

### Cross-step validation (the "reject_to" temptation)

When a later step fails because an earlier step's output was wrong, it is tempting to reach for a "go back to step N" mechanism. v1 does not provide one — and you do not need one.

The root cause is always the same: the validation lives in a different step from the one that produces the gated value. The fix is to **move the gate into the step that produces the output**, so the step's own retry loop handles it.

Bad — validation separated from the producing step:
```yaml
- id: generate-variant
  type: agentic
  instruction: "Generate an optimized variant"
  required_output: Variant

- id: execute-variant
  type: programmatic
  context_in:
    code: "{generate-variant.code}"
  required_output: ExecutionResult
  actions:
    - name: run
      description: Execute candidate script
      shell: "node ./variant.js"
      extract:
        result: result

- id: compare
  type: programmatic
  context_in:
    baseline: "{{baseline_score}}"
    observed: "{execute-variant.result}"
  required_output: ComparisonResult
  # If improvement <= 0, we want to redo generate-variant — not supported
```

Good — gate lives in the same step that produces the candidate:
```yaml
- id: generate-and-evaluate
  type: agentic
  instruction: |
    Generate a variant, execute it (use the bash proxy), and return code +
    execution result + improvement over baseline.
  required_output: EvaluatedVariant
  assertions:
    - field: improvement
      op: gt
      value: 0
  # Rejection keeps the agent in this step; it retries with a different
  # approach until the assertion passes.
```

**Principle**: if a step's failure requires redoing a previous step, those steps should be merged. Wanting `reject_to` is a sign of bad decomposition.

### Accumulator via router loop

In the legacy format, `accumulate:` collected items across retries in a single agentic step. v1 removes it. The right pattern depends on what you're building:

- **"Validate an item at collection time, keep trying"** — use the agent's own retry on the step's schema / assertions. Its `required_output` schema enforces the whole batch, so it retries until correct.
- **"Grow a pool by iterating an external queue"** — model it as a recursive `call` whose `inputs` include the in-progress pool. Each recursion appends the next batch and decides whether to call again or return. See `concepts/call` for the full pattern.

Bad (mental model: "collect first, filter later"):
```yaml
- id: collect-companies
  type: agentic
  instruction: "Search for 100 companies"
  required_output: Companies

- id: find-forms
  type: agentic
  context_in:
    companies: "{collect-companies.items}"
  instruction: "Find a contact form URL for each company"
  required_output: CompaniesWithForms
  # Companies without forms are wasted collection effort
```

Good (mental model: "only collect what's already usable"):
```yaml
- id: collect-companies-with-forms
  type: agentic
  instruction: |
    Find 100 companies. For each, verify it has a public contact form and
    include form_url in the result. Skip companies that have no form.
  required_output: CompaniesWithForms
```

**Principle**: the collection step's schema is the quality gate. If a downstream step would skip or reject items, move that check into the collector's schema.

### Premature `call`

Extracting a one-action helper into its own `call`-able workflow doesn't buy you anything — it just adds a boundary. Reach for `call` when you have a **reusable subtask with its own input/output shape and tests**, or when you need recursion for accumulation.

### Premature `router`

Two linear steps don't need a router between them. Add `router` when there's a real branch (two destinations that depend on data) or a loop (a backward goto that will actually run more than once in practice).
