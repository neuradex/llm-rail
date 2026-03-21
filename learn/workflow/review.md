---
name: review
description: How to review an lrail workflow — parallel trial runs, comparative analysis, policy audit, and fix proposals
---

## Workflow Review Methodology

### Phase 1: Static Review

#### 1a. Validate
```bash
lrail wf <workflow-name> validate
```
If validation fails, report errors with `lrail docs` references and stop.

#### 1b. Design Review
Read the workflow YAML (`workflows/<name>.yml`) and evaluate:

- **Step type candidates**: For each agentic step, ask: "Does this step require LLM judgment, or is it deterministic?" Flag candidates for `programmatic`.
- **API verification**: If tips mention specific APIs or data sources, verify they exist (try a sample request with `curl`). Flag non-existent or unreliable APIs.
- **Validation coverage**: Steps with low or no validation on `required_output` — suggest specific rules.

Report findings before proceeding to Phase 2.

### Phase 2: Parallel Trial Runs

#### 2a. Create Two Instances

Create two instances for the same workflow — one for each model tier:

```bash
lrail wf <workflow-name> create [--param k=v ...]   # → alias-a (for haiku)
lrail wf <workflow-name> create [--param k=v ...]   # → alias-b (for sonnet)
```

#### 2b. Choose Agent Type

Per `lrail docs concepts/step-types` "Agent Selection" section: if any agentic step's tips mention WebSearch, WebFetch, URLs, or external data → use `general-purpose`. Otherwise use `step-runner`.

#### 2c. Launch Both Agents in Parallel

Launch two agents **simultaneously** in a single message with two Agent tool calls:

- **Agent A** (Haiku): `model: haiku`, instance: alias-a
- **Agent B** (Sonnet): `model: sonnet`, instance: alias-b

Both use the same `subagent_type` (determined in 2b). For `general-purpose` agents, include the full lrail command syntax (start, next, bash) in the prompt — reference `lrail docs workflow/execution` for the exact commands.

**Why parallel**: Comparing model tiers reveals whether the workflow is robust enough for low-cost execution (Haiku) or requires higher capability (Sonnet). It also exposes fabrication patterns — Haiku fabricates more aggressively, so if both pass, the workflow's guardrails are working.

#### 2d. Collect Results

After both agents complete:
```bash
lrail <alias-a> status
lrail <alias-b> status
lrail <alias-a> query --step <step-id>   # for each step
lrail <alias-b> query --step <step-id>   # for each step
```

### Phase 3: Comparative Output Analysis

Analyze both runs side by side. For each agentic step:

#### 3a. Fabrication Detection
- **Threshold-boundary values**: Numbers suspiciously close to validation boundaries (e.g., PER=15.0 when assertion is `lte: 15`)
- **Round numbers**: Financial data with too many round values (10.0%, 20.0%)
- **Missing sources**: Data claims without verifiable sources
- **Consistency**: Cross-reference outputs between steps — does downstream data match upstream?

#### 3b. Model Comparison
Compare Haiku vs Sonnet outputs:

| Signal | Interpretation |
|---|---|
| Both pass, similar outputs | Workflow is robust — Haiku sufficient |
| Sonnet passes, Haiku fails | Workflow needs stronger guardrails or Haiku is insufficient for this task |
| Both fail at same step | Workflow design issue — validation too strict, APIs inaccessible, or step is infeasible |
| Both pass, very different data | At least one is fabricating — add `verify_source` or tighter validation |

#### 3c. Step Type Recommendation
Based on actual execution:
- Step produced deterministic output that doesn't need LLM? → **programmatic**
- Step called an API that could be called directly? → **programmatic with actions**
- Step required genuine analysis/reasoning? → **keep agentic**, but check validation coverage

### Phase 4: Policy & Command Analysis

#### 4a. Command Audit
Read the bash command logs from **both** instances:
```bash
cat .llm-rail/<workflow-name>/<instance-id-a>/policy.jsonl
cat .llm-rail/<workflow-name>/<instance-id-b>/policy.jsonl
```

For each command:
- **Dangerous**: `rm`, `git push`, `curl` to external hosts, `chmod`, writes outside project → flag
- **Safe**: `cat`, `ls`, `grep`, `node -e`, reads within project → allow
- **Watchable**: Commands that are OK but should be monitored (API calls, file writes) → allow + log

#### 4b. Safer Alternatives
For each dangerous command, suggest a workaround:
- External API calls → wrap in a programmatic step with `actions` (auditable, repeatable)
- File mutations → use specific allow patterns instead of wildcards
- Network access → restrict to known hosts

#### 4c. Policy Generation
Propose a `policy` block for the workflow:
```yaml
policy:
  mode: enforce
  rules:
    - effect: allow
      commands: [...]
    - effect: deny
      commands: [...]
```

### Phase 5: Report & Fix

Present a structured report:

```
## Review: <workflow-name>

### Static Review
- Step type candidates: <count>
- API issues: <count>
- Validation gaps: <count>

### Trial Runs
| | Haiku (alias-a) | Sonnet (alias-b) |
|---|---|---|
| Status | PASS/FAIL | PASS/FAIL |
| Steps completed | n/total | n/total |
| Blocked at | step-id or — | step-id or — |

### Comparative Analysis
Per-step findings:
- <step-id>: Haiku <result> / Sonnet <result> — <interpretation>

### Command Audit
- Total commands: Haiku <n> / Sonnet <n>
- Dangerous: <n> (details)
- Proposed policy: <summary>

### Recommendations
1. [Priority] <specific fix with YAML diff>
2. ...

### Model Recommendation
Minimum viable model: Haiku / Sonnet

### Suggested Phase
Current: <phase> → Recommended: <phase>
```

After presenting the report, offer to apply the recommended fixes.

### Critical Rules

- **You (reviewer) do the analysis** — the agents only execute
- **Always run the workflow before making recommendations** — don't guess from YAML alone
- **Always run both models in parallel** — single-model review misses fabrication patterns
- **Be specific** — "Step 2 should be programmatic" is not enough. Show the `actions` YAML.
- **Trail mode for trial runs** — never run with enforce mode (it may block commands you need to observe)
