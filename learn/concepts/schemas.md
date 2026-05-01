---
name: schemas
description: Named schema definitions, workflow IO, structural typing
---

## schemas — the single source of truth for shape

A v1 workflow declares every type up front in a top-level `schemas:` block, then references them by name everywhere a shape is expected.

```yaml
schemas:
  Input:
    type: object
    properties:
      source_url: { type: string }
      format: { type: string, enum: [json, csv] }
    required: [source_url, format]

  Output:
    type: object
    properties:
      cleaned: { type: array, items: Record }
      dropped_count: { type: integer, minimum: 0 }
    required: [cleaned, dropped_count]

  Record:
    type: object
    properties:
      id: { type: string }
      data: { type: object }
    required: [id, data]

input: Input
output: Output
```

## Rules

- **Named schemas only.** Inline object definitions at reference sites (`input:`, `output:`, `required_output:`, `items:`, `properties.<k>:`) are rejected. You must name the shape.
- **String references.** A reference is a bare string naming a schema. There is no `$ref: "#/..."`; there is no need for one.
- **No inline compositions.** Only reference names (`items: Record`) where a schema is expected.
- **Cycles are allowed.** Recursive shapes (a tree that nests itself, linked lists) are fine. `lrail wf compile` reports cycles for awareness but does not reject them.

## JSON Schema subset

LLM Rail accepts a deliberately small subset of JSON Schema 2020-12:

- `type`: `object` / `array` / `string` / `number` / `integer` / `boolean`
- `properties` / `required` / `additionalProperties`
- `items` (for arrays)
- `enum` / `const`
- `oneOf` (for discriminated unions)
- `default`
- `minLength` / `maxLength` / `minimum` / `maximum` / `minItems` / `maxItems`

Everything else (`$ref`, `allOf`, `anyOf`, `not`, `if/then/else`, `dependentSchemas`, `patternProperties`, union types like `type: [string, null]`) is **not** accepted. This keeps schemas easy for LLMs to generate and for tools to reason about. If a case seems to require a removed keyword, you almost always want to split it into multiple named schemas with `oneOf`.

## Workflow input and output

A workflow's **external boundary** is `input:` and `output:`. Both point to schema names.

- `input:` is what the caller (CLI `--param`, or a parent's `call` step) fills in when creating an instance. All references of the form `{{name}}` resolve against this.
- `output:` is what the workflow produces. It is the output of the **last completed step**, re-validated against the `output:` schema when a `call` step collects the result.

Think of each workflow as a function: `(Input) -> Output`.

## Structural compatibility (call step)

When one workflow calls another, the compatibility check is **structural, not name-based**. If A exports `Output = { id, data }` and B consumes `Input = { id, data }` as its input, the call is compatible even if A calls its schema `JobItem` and B calls its schema `Task`. Names are for readability; shape is the contract.

`lrail wf compile --registry <dir>` performs the cross-workflow check: every required field of the child's `input:` must be mapped by the caller's `inputs:`, and every `{call.field}` reference in the caller must name a declared field of the child's `output:`.

## Where schemas drive checks

Schemas act in four places:

1. **Workflow input** on instance creation (caller-supplied).
2. **Agentic output** on submit — the agent's JSON is validated against the step's `required_output` schema before the step completes.
3. **Programmatic output** — the action chain's accumulated return is validated the same way.
4. **Call IO** — caller's inputs against child's `input:`, child's final step's output against child's `output:`.

Schema failures stop execution with per-field errors. An agentic failure keeps the step `in_progress` so the agent can retry; a programmatic failure halts with `state.status = error`.

## Why no inline schemas

Early drafts of v1 allowed inline objects at reference sites. We dropped that for a plain reason: one way to spell each thing. "Name the shape" also forces you to read the schemas block once and see everything the workflow knows about; the graph `--json` export can label every node and edge with schema names; a migrator or editor can pattern-match on a single block instead of crawling the step tree.

## Working with legacy types

Legacy workflows had two shape systems: `params:` (for input) and `validation:` rules (for step output). `lrail wf migrate` converts them:

- `params:` → a generated `Input` schema
- Each step's `required_output` array + structural validation rules → a `<PascalStepId>Output` schema
- The last step's schema becomes the workflow `output:`
- Non-structural rules (`script`, `verify_source`) are preserved as v1 `validation:` entries on the step

After migration, you usually want to rename and consolidate the generated schemas.
