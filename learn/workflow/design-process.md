---
name: design-process
description: Step-by-step process for designing v1 workflows
---

## Workflow Design Process

### Phase 1: Understand requirements

Run `lrail docs workflow/requirements-analysis` and follow the procedure. This produces validated, user-confirmed requirements.

From the confirmed requirements, identify:
- **Input shape** — what does the caller provide? (workflow `input:`)
- **Output shape** — what is the final deliverable? (workflow `output:`)
- **External side effects** — files the workflow reads/writes, APIs it calls, queues it drains.

### Phase 2: Name the shapes

v1 starts from schemas. Before writing any steps, decide which data shapes the workflow exchanges and give them names:

- `Input` and `Output` at the workflow boundary.
- One shape per step that produces structured output (agentic or programmatic with `required_output`).
- Shared entity shapes (`Record`, `Company`, `JobItem`) if multiple steps touch them.

Pick names that read as domain nouns, not implementation artifacts. `CompanyCandidate` beats `Step2Output` even though the latter is easier to auto-generate.

See `concepts/schemas` for the allowed JSON Schema subset.

### Phase 3: Propose step breakdown

For each step, decide:

- **Type**: agentic / programmatic / router / call. See `concepts/step-types`.
  - Judgment / research / synthesis → agentic
  - Deterministic transforms, API calls, shaping → programmatic
  - A branch or a loop → router
  - A reusable subtask with its own IO shape → call (possibly a workflow you haven't written yet)
- **Output shape**: which schema is `required_output`?
- **Inputs**: which prior step outputs or workflow input fields does it need? (`context_in`)
- **Side effects**: any actions that touch the filesystem / network / DB? Which step does them?

Don't prematurely introduce routers or calls. Add them when they genuinely express the shape you need; avoid them for linear flow.

See `workflow/design-tips` for design principles and anti-patterns.

### Phase 4: Write the YAML

Create `workflows/<name>.yml` (or `workflows/<name>/workflow.yml` for directory format). Required structure:

```yaml
format: v1
name: <name>
version: "0.1.0"
description: <purpose>
phase: draft

schemas:
  Input: { ... }
  Output: { ... }
  # ...per-step / shared shapes

input: Input
output: Output

# Only declare max_depth if a `call` step recurses into this workflow
# directly or transitively.
max_depth: 100

steps:
  - id: <step-id>
    type: agentic | programmatic | router | call
    # ...type-specific fields
```

**agentic**:
```yaml
- id: <id>
  type: agentic
  instruction: <agent directive>
  context_in:
    <local>: "{prev-step.field}"
  required_output: <SchemaName>
  validation:                   # only for non-structural checks (script, verify_source)
    - ...
  assertions:                   # cross-step / cross-field rules
    - ...
```

**programmatic**:
```yaml
- id: <id>
  type: programmatic
  context_in:
    <local>: "{prev-step.field}"
  required_output: <SchemaName>
  actions:
    - name: <short-name>        # REQUIRED
      description: <one-liner>  # REQUIRED
      js: |                     # OR shell:, exactly one
        return { ... };
```

**router**:
```yaml
- id: <id>
  type: router
  context_in:
    <local>: "{prev-step.field}"
  cases:
    - when: { field: "{{local}}", op: eq, value: ... }
      goto: <step-id>
  default: <step-id>            # REQUIRED
  max_iterations: 50            # REQUIRED if any goto is backward
```

**call**:
```yaml
- id: <id>
  type: call
  workflow: <other-workflow-name>
  inputs:
    <child-input-key>: "{prev.field}"
```

Key rules:

- `instruction` is the agent directive (what to do). `description` is the human label (what it's called).
- `required_output` points to a schema in the `schemas:` block. Structural rules (type, length, range, enum) live in the schema.
- `validation` stays for non-structural checks only: `script`, `verify_source`, regex, cross-field. Everything else moves to the schema.
- `context_in` is the **only** data channel. There is no `lrail.get` / `lrail.set` / `lrail.goto`.
- Routers and recursive calls need explicit bounds (`max_iterations`, `max_depth`).

See `concepts/step-types`, `concepts/schemas`, `concepts/router`, `concepts/call`, `concepts/actions`, `concepts/validation` for detailed references.

### Phase 5: Compile

```bash
lrail wf <name> compile [--path <file>] [--registry <dir>]
```

Compile catches:
- Missing / unknown schema references
- Context_in references to steps that don't exist or can't be reached in execution order
- Router cases without a target, missing `default`, or backward goto without `max_iterations`
- Self-recursive or transitively-recursive call without `max_depth`
- Missing action `name` / `description`
- Cross-workflow IO mismatches (with `--registry`)

Fix all `Errors:` before proceeding. Review `Warnings:` — most are real signals.

### Phase 6: Graph-check (optional)

Export the structure to sanity-check:

```bash
lrail wf <name> graph --json | jq '.control_edges'
```

Look for unexpected edges, orphan nodes, or surprise backward gotos.

### Phase 7: Test run

Create an instance and walk through it:

```bash
lrail wf <name> create [--param k=v ...]
lrail <alias> start
lrail <alias> next --result '<json>'   # for each agentic step
lrail <alias> status                    # final state
```

Record agent rejections and iterate on the schema / instruction wording if they're frequent.
