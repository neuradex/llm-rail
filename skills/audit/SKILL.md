---
description: Audit an llm-rail workflow — analyze quality and suggest improvements
context: fork
agent: workflow-designer
allowed-tools: Read, Glob, Grep, Bash, Edit
---

# Workflow Audit

You are auditing an existing llm-rail workflow for quality, correctness, and efficiency.

## Target

If $ARGUMENTS specifies a workflow file or name, audit that. Otherwise, discover workflows in `workflows/*.yml` and let the user choose.

## Analysis Checklist

### 1. Schema Validity
Run `node ${CLAUDE_PLUGIN_ROOT}/dist/cli.js validate <workflow-name>` and report any errors.

### 2. Step Granularity
- **Too large**: A step with 5+ required_output fields probably does too much. Suggest splitting.
- **Too small**: A step with 1 required_output that's trivially derived from its input may be unnecessary. Suggest merging.

### 3. Validation Coverage
For each step, calculate: `validation rules / required_output fields`.
- 0% coverage: flag as "no validation"
- < 50%: flag as "low coverage"
- Suggest specific validation rules for uncovered fields.

### 4. context_in Efficiency
- **Missing data**: A step references data in tips but doesn't receive it via context_in.
- **Unused data**: context_in passes data that isn't mentioned in required_output, tips, or description.
- **Implicit dependencies**: Steps that seem to need prior data but lack context_in.

### 5. Dependency Graph
- **Over-serialization**: Steps with depends_on that don't actually use data from that dependency.
- **Parallelization opportunity**: Independent steps that could run concurrently.
- **Missing dependencies**: Steps using `{stepId.field}` in context_in but missing the corresponding depends_on.

### 6. Tips Quality
- Too vague (e.g., "do well") → suggest specific alternatives
- Missing tool/API guidance → suggest additions
- Contradictory tips → flag

## Output Format

Present findings as:

```
## Audit: <workflow-name>

### Schema: PASS/FAIL
<details>

### Step Granularity: <issues found / total steps>
<details per step>

### Validation Coverage: <percentage>
<details per step>

### Data Flow: <issues found>
<details>

### Dependencies: <issues found>
<details>

### Tips Quality: <issues found>
<details>

### Recommendations
1. ...
2. ...
```

If the user approves recommendations, apply them directly using Edit.
