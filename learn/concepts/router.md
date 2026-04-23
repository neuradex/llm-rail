---
name: router
description: Declarative branching and bounded loops
---

## router — control flow made visible

A `router` step inspects data and picks the next step. It replaces the legacy `lrail.goto` pattern (a string argument buried inside a `js:` action) with a shape where every branch, target, and condition is visible in the YAML.

```yaml
- id: gate
  type: router
  context_in:
    decision: "{classify.kind}"
    errors: "{process.errors.length}"
  cases:
    - when:
        all:
          - { field: "{{decision}}", op: eq, value: structured }
          - { field: "{{errors}}", op: lt, value: 5 }
      goto: parse-structured
    - when: { field: "{{decision}}", op: eq, value: freeform }
      goto: parse-freeform
  default: escalate
  max_iterations: 100
```

## Fields

- **`cases`** — ordered list; first match wins. Each case is `{ when, goto }`.
- **`default`** — required. The target when no case matches. No silent fall-through.
- **`max_iterations`** — required if any goto can be backward (target at or before the router in step order). Compile enforces this.
- **`context_in`** — optional. Resolves references into router-local names for use in `when.field`.

## `when` expressions

A `when` is one of:

- **A single rule**: `{ field, op, value }` using the same operator set as `validation` (`eq`, `neq`, `gt`, `gte`, `lt`, `lte`, `min_length`, `type`, `one_of`, ...). See `concepts/validation`.
- **An implicit AND**: a JSON array of rules, all must be true.
- **Combinators**:
  - `{ all: [ w1, w2, ... ] }` — every sub-expression true
  - `{ any: [ w1, w2, ... ] }` — at least one true
  - `{ not: w }` — negation

Each `field` value is a reference template, not a literal key:

- `{stepId.field}` — prior step output
- `{{name}}` — router's own `context_in` local first, else workflow input

## Forward vs backward goto

A goto is **forward** if the target is after the router in the `steps:` array, **backward** otherwise.

**Forward goto** skips the intermediate steps (they stay `pending`) and resumes sequential execution from the target onward. Steps between the router and the target are simply not executed.

**Backward goto** is a loop. The router and every step in `[target, router]` (inclusive) have their `output` reset to `undefined` and their `status` reset to `pending`, so the next iteration starts from a clean base. The router's iteration counter increments; if it would exceed `max_iterations`, execution errors.

This asymmetric reset is deliberate: loops need a fresh start so self-referencing `context_in` (`pool: "{merge.pool}"`) reads last iteration's value — but only once the step re-executes and re-produces it. For the first iteration, those references need a default (see `concepts/step-types` and `concepts/call`'s recursion section).

## What the router records

A router's output is a small object downstream steps can read:

```yaml
{
  selected_goto: "parse-structured",
  selected_case: 0,            # -1 if default fired
  used_default: false,
  iteration: 3                 # only present on backward goto
}
```

A later step can switch on `{gate.selected_goto}` to log, alert, or shape its own input.

## Patterns

### A gate that either continues or aborts

```yaml
- id: check
  type: router
  context_in:
    error_count: "{validate.errors.length}"
  cases:
    - when: { field: "{{error_count}}", op: gt, value: 0 }
      goto: abort
  default: proceed
```

### A poll-until-ready loop

```yaml
- id: poll
  type: programmatic
  required_output: PollResult
  actions: [ ... produces { ready: boolean } ... ]

- id: wait
  type: router
  cases:
    - when: { field: "{poll.ready}", op: eq, value: true }
      goto: next
  default: poll         # backward
  max_iterations: 30
```

This polls `poll` up to 30 times. Between iterations `poll.output` is reset so a fresh read happens each round.

### A dispatcher with default escalation

```yaml
- id: route
  type: router
  context_in:
    kind: "{classify.kind}"
  cases:
    - when: { field: "{{kind}}", op: eq, value: a }
      goto: handle-a
    - when: { field: "{{kind}}", op: eq, value: b }
      goto: handle-b
    - when: { field: "{{kind}}", op: eq, value: c }
      goto: handle-c
  default: unknown-handler
```

## When not to use router

Two anti-patterns:

1. **Router for accumulation.** A backward-goto loop is fine for "poll until ready" and "retry N times", but building up a pool of items across iterations means reaching for state that keeps resetting. Use a recursive `call` with an input buffer (see `concepts/call`) instead.

2. **Router to express sequencing.** If you just want to run step B after step A, they already run that way without a router. Routers introduce branches; don't add one for linear flow.

## Static checks

`lrail wf compile` validates:

- `default` is present and names a real step.
- Every `cases[].goto` names a real step.
- If any goto is backward, `max_iterations` is declared.
- `when.field` references existing steps (when using `{step.field}`) or the router's own `context_in` locals.

The `graph --json` export renders every case as a `router-case` edge with `when_summary`, plus the `router-default` edge, each flagged `backward: true|false`.
