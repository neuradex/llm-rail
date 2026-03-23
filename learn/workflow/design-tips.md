---
name: design-tips
description: Design principles and tips for writing good LLM Rail workflows
---

## Workflow Design Principles

### 1. One clear output per step

Each step should produce a single, well-defined deliverable. If a step does two unrelated things, split it.

### 2. Choose the right step type

See `lrail docs concepts/step-types` for decision criteria.

- Use `programmatic` for deterministic work: filtering, sorting, arithmetic, API calls
- Use `agentic` only when LLM judgment is needed: analysis, review, summarization
- Prefer programmatic — it's faster, cheaper, and deterministic

### 3. required_output = what the next step actually consumes

Don't ask for data nobody uses. Every required_output field should appear in a downstream context_in or be the final deliverable.

### 4. Explicit data flow with context_in

Never rely on implicit flat-merge of all prior outputs. Always use `context_in` to declare exactly which data a step needs and from where:

```yaml
- id: step-b
  context_in:
    items: "{step-a.items}"
```

### 5. validation vs assertions

See `lrail docs concepts/validation` for operator reference.

- `validation`: structural checks — "Is the output an array with at least 5 items?"
- `assertions`: business logic checks — "Do the allocation weights sum to 100?"

### 6. Actionable tips

Tips are instructions, not suggestions. Agents follow them. Use them to encode domain knowledge:

```yaml
tips:
  - Use PER trailing twelve months, not forward
  - If a metric is unavailable, set to null — never guess
  - Sentiment must be one of: positive, neutral, negative
```

See `lrail docs concepts/step-types` for agent capability constraints (step-runner vs general-purpose) — tips that mention WebSearch require a general-purpose agent.

### 7. Minimal depends_on

Only declare actual data dependencies. If step C needs data from A but not B, don't make C depend on B just because B runs between them.

### 8. Policy when agents run commands

See `lrail docs concepts/policy`. Start with trail mode during development, then switch to enforce with a minimal allow-list.

## Anti-Patterns

### Deterministic operations as agentic steps

LLMs can and will manipulate data to pass validation.

Bad:
```yaml
- id: filter
  description: "Filter items where score > 80"
  required_output: [filtered]
```

Good:
```yaml
- id: filter
  type: programmatic
  actions:
    - js: |
        const filtered = context.items.filter(x => x.score > 80);
        return { filtered };
```

### Design for the weakest model

If Haiku will run this workflow, assume it will:
- Fabricate data when it can't find real data
- Round numbers and use suspiciously clean values
- Optimize for passing validation over being correct

Guard against this with programmatic steps, strong validation, and `verify_source`.

### Start with fewer, broader steps

It's easier to split a step later than to merge steps. Start with 3-5 steps and add granularity as needed.

### Cross-step validation (the `reject_to` temptation)

When a later step's gate fails because of an earlier step's output, it is tempting to add a "go back to step N" mechanism (`reject_to`, `on_reject: step-N`, etc.). **Do not do this.** LLM Rail intentionally has no backward-jump primitive, and you should not need one.

The root cause is that the validation lives in a different step from the one that produces the gated output. The fix is to **move the gate into the step that generates the output**, so the built-in reject→retry loop handles it automatically.

Bad — validation separated from the producing step:
```yaml
- id: generate-variant
  description: "Generate an optimized variant"
  required_output: [variant_code]

- id: execute-variant
  type: programmatic
  actions:
    - shell: "node variant_code.js"
      extract:
        variant_result: result

- id: compare
  type: programmatic
  description: "Compare baseline vs variant"
  validation:
    - field: improvement
      op: gt
      value: 0
  # If this fails, we need to redo generate-variant — not supported
```

Good — gate lives in the same step that produces the output:
```yaml
- id: generate-and-evaluate-variant
  description: "Generate variant, execute it, return comparison metrics"
  required_output: [variant_code, variant_result, improvement]
  validation:
    - field: improvement
      op: gt
      value: 0
  # If rejected, agent retries this step with a different approach
```

**Principle:** if a step's failure requires redoing a previous step, those steps should be merged. Wanting `reject_to` / `on_reject` is a code smell — it means the steps are poorly decomposed.

### Deferred quality validation in accumulate pipelines

When a pipeline collects items in one step and filters by quality in a later step, the filter renders earlier collection effort wasted. **Pull the quality gate into the accumulate step** so only qualified items enter the pool.

Bad — collect first, validate quality later:
```yaml
- id: collect-companies
  instruction: "Search for 100 companies"
  accumulate:
    companies: { key: name }
  validation:
    - field: companies
      op: min_length
      value: 100

- id: find-forms
  depends_on: collect-companies
  instruction: "Find contact form URLs for each company"
  # Companies without forms are wasted — we can't go back

- id: extract-structure
  depends_on: find-forms
  instruction: "Extract form HTML structure"
  # If 40% have no forms, we only get 60 usable results from 100 collected
```

Good — validate quality at collection time:
```yaml
- id: collect-companies-with-forms
  instruction: "Find 100 companies AND verify each has a contact form before adding"
  accumulate:
    companies: { key: name }
  validation:
    - field: companies
      op: min_length
      value: 100
    - field: companies
      op: each_has
      value: form_url
  # Only companies with verified forms enter the pool

- id: extract-structure
  depends_on: collect-companies-with-forms
  instruction: "Extract form HTML structure for each company's form_url"
```

**Principle:** accumulate validation is the quality gate. If a downstream step would reject or skip items from the pool, move that check into the accumulate step's validation. The pool should only contain items that are fully usable by all downstream steps.
