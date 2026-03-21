---
name: design-process
description: Step-by-step process for designing and writing lrail workflows
---

## Workflow Design Process

### Phase 1: Understand requirements

Run `lrail docs workflow/requirements-analysis` and follow the procedure. This produces validated, user-confirmed requirements.

From the confirmed requirements, identify:
- **Inputs** — what params does the workflow need?
- **Outputs** — what is the final deliverable?

### Phase 2: Propose step breakdown

Before writing YAML, outline each step:
- What it produces (required_output)
- **Programmatic** (deterministic: API calls, file ops, data transforms) vs **agentic** (needs LLM judgment: analysis, review, summarization)
- Data flow — which step's output does each step consume? (context_in)
- Parallelism — which steps are independent? (depends_on)
- **Scale sensitivity** — if a param controls volume (e.g., `min_companies`), design the step to handle the full range. Use `accumulate` for large collections instead of single-shot submission.

See `lrail docs workflow/design-tips` for design principles and anti-patterns.

### Phase 3: Write the YAML

Create `workflows/<name>.yml` (or `workflows/<name>/workflow.yml` for directory format).

Required structure:
```yaml
name: <name>
version: "0.1.0"
description: <purpose>
phase: draft
params:             # if the workflow needs input
  <key>:
    type: string | number | boolean
    required: boolean
    default: any
    description: string
steps:
  - id: <step-id>
    instruction: <agent directive>         # required for agentic
    description: <human-readable summary>  # optional
    type: programmatic                     # omit for agentic (default)
    depends_on: <step-id or [step-ids]>
    required_output: [<fields>]
    validation: [<AssertionRule>]
    assertions: [<AssertionRule>]
    context_in:
      local_name: "{stepId.field}"
    tips: [<actionable instructions>]
    accumulate:                            # for incremental collection
      <field>:
        key: <dedupe field>
    actions:                               # required for programmatic
      - run: <shell command>
        extract:
          targetKey: sourceKey
policy:
  mode: trail                              # start with trail, switch to enforce later
```

Key rules:
- `instruction` is the agent directive (what to do). `description` is the human label (what it's called).
- `required_output` = only fields consumed downstream or as final output
- `validation` = structural checks (type, length). `assertions` = business logic (value ranges).
- `context_in` for ALL cross-step data references — never rely on implicit merge
- `tips` = actionable instructions, not suggestions. Encode domain knowledge here.
- `depends_on` = only actual data dependencies

See `lrail docs concepts/step-types` for step type details.
See `lrail docs concepts/validation` for assertion operator reference.
See `lrail docs concepts/actions` for programmatic action syntax.

### Phase 4: Validate

```bash
lrail wf <name> validate
```

Fix all errors before proceeding.

### Phase 5: Test run (optional, for `/build`)

Create an instance and run end-to-end to verify the workflow completes:

```bash
lrail wf <name> create [--param k=v]
lrail <id> start
lrail <id> next --result '<json>'   # for each agentic step
```

Record rejection count and fix issues in the YAML if needed.
