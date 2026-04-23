---
name: call
description: Invoking one workflow from another as a function
---

## call — workflows as functions

A `call` step invokes another workflow. The caller passes `inputs` matching the child's `input:` schema; the child runs to completion and produces an output matching its `output:` schema, which the caller observes as this step's output.

```yaml
- id: clean
  type: call
  workflow: clean-records       # target workflow name
  inputs:
    raw: "{fetch.raw_data}"
    rules: "{{cleaning_rules}}"
# clean.<field> is now accessible downstream
```

Think of a v1 workflow as a function `(Input) -> Output`. `call` is how you invoke it.

## Fields

- **`workflow`** — target workflow name. Resolution depends on the runner (CLI uses the workflow directory; an in-memory registry is used for programmatic embedding / tests).
- **`inputs`** — a `Record<string, string>` of **simple reference templates only**. Each value is either `"{stepId.field}"` or `"{{inputName}}"`. No expressions, no templates with embedded strings.

If you need computed inputs, put a `programmatic` step before the call to build them, then reference its output:

```yaml
- id: build-next
  type: programmatic
  context_in:
    items: "{collect.items}"
    seen: "{{seen}}"
  required_output: CleanArgs
  actions:
    - name: prepare
      description: Merge local state into the caller input shape
      js: |
        return {
          pool: [...context.seen, ...context.items],
          remaining: context.items.length,
        };

- id: recurse
  type: call
  workflow: collect-until
  inputs:
    pool: "{build-next.pool}"
    remaining: "{build-next.remaining}"
```

This keeps complex logic in one named, described place (the `programmatic` step's action) and `call` as a pure reference mapping.

## Execution model

When the runner reaches a `call` step:

1. Resolve the child workflow via the registry. If missing → error.
2. Check `max_depth` against the current depth (root is 0; each call increments).
3. Map inputs from the parent state. Validate against the child's `input:` schema.
4. Spawn a **new sub-instance** for the child, linked to the parent via `state.parent`.
5. Drive the child forward until it terminates, pauses, or errors:
   - **Terminates**: collect the last completed step's output, validate against the child's `output:` schema, record it on the call step, advance the parent.
   - **Pauses** (child hit an `agentic` step): the parent pauses too. The agent interacts with the top-level instance; the runner routes the submission down to the currently-paused child automatically.
   - **Errors**: the error propagates up; the parent's call step fails.

The child's internal state is **not** visible to the parent. There is no shared store; the only channel is `inputs` going down and the final output coming back up.

## Recursion

A workflow can call itself. This is the idiomatic v1 way to express "accumulate" patterns that previously used the legacy `accumulate:` block.

```yaml
name: collect-until
max_depth: 200        # required for self-calling workflows

schemas:
  Input:
    type: object
    properties:
      pool: { type: array, items: Item, default: [] }
      queue: { type: array, items: Item }
      target_size: { type: integer }
    required: [queue, target_size]
  Output: { ... }
  Item: { ... }

input: Input
output: Output

steps:
  - id: done-check
    type: router
    cases:
      - when:
          any:
            - { field: "{{pool}}", op: min_length, value: "{{target_size}}" }
            - { field: "{{queue}}", op: length, value: 0 }
        goto: return
    default: process-one

  - id: process-one
    type: agentic
    ...

  - id: build-next
    type: programmatic
    ...
    # builds next call's inputs: pool += [processed], queue -= [queue[0]]

  - id: recurse
    type: call
    workflow: collect-until
    inputs:
      pool: "{build-next.pool}"
      queue: "{build-next.queue}"
      target_size: "{build-next.target_size}"

  - id: return
    type: programmatic
    context_in:
      local: "{{pool}}"
      recursed: { from: "{recurse.pool}", default: null }
    required_output: Output
    actions:
      - name: pick
        description: If recursion happened, return its pool; else return what we built locally
        js: |
          return { pool: context.recursed ?? context.local };
```

Key points:

- **`max_depth:` is required** for any workflow that can reach itself (directly or transitively through other workflows). `lrail wf compile` enforces this.
- The base case is reached via the router's `done-check` short-circuit — it jumps straight to `return`, skipping `process-one`, `build-next`, `recurse`. Those steps stay `pending`.
- `return` has to handle **both** cases: recursion-ran (`recurse.pool` is populated) and base-case (`recurse` was skipped). The `{ from: "{recurse.pool}", default: null }` form in `context_in` makes the skip case read `null` instead of erroring.

## Why sub-instance, not inline?

An alternative is "inline the child's steps into the parent's step array at call time". We chose sub-instance spawn for four reasons:

1. **Isolation.** Child `context_in` references can never reach parent state accidentally; there is no name collision risk.
2. **Audit clarity.** Each call produces a distinct `audit.jsonl`; drill-down is natural. A mega-workflow would produce an interleaved log you'd have to reconstruct.
3. **Policy independence.** A child can run under a different policy than the parent; that is only coherent if the child has its own instance boundary.
4. **Composition symmetry.** A workflow that calls another and a workflow that calls itself look the same. No special case for recursion.

The trade-off is a small per-call overhead (state init + one scheduling hop). For workflows that recurse tens of times this is negligible; if a hot loop genuinely becomes an issue, a tail-call optimization (detect "last step is `call self`" and reuse the current instance) is a future optimization RFC — it does not change the model.

## Compile-time checks

With `lrail wf compile --registry <dir>`:

- **Unknown workflow name**: error.
- **Required input missing** from `inputs`: error. (Optional inputs may be omitted.)
- **Extra input key** not declared in child's `input:` schema: warning.
- **Downstream reference** `{call.field}` naming an undeclared child `output:` field: warning.
- **Self-reference without `max_depth`**: error.
- **Transitive cycle** (A → B → A) without `max_depth`: error.

## When not to use call

- **Tiny helper**. If a step is one `js:` action, don't extract it into a whole workflow. `call` is for a reusable unit with its own `input:`/`output:` shape and tests.
- **Data you need to stream**. A child completes before returning; there is no streaming channel. Large collections are fine as input/output, but don't try to tunnel progress events through the call mechanism.
