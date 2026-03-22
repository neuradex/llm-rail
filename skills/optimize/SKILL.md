---
description: Optimize an existing lrail workflow — baseline, 3 sequential optimizations, 3-tier parallel verification, synthesize
context: fork
allowed-tools: Bash, Read, Agent
---

# Workflow Optimize (Orchestrator)

You are the orchestrator for optimizing lrail workflows. You manage the `lrail-optimize` workflow instance. Most steps run with a single agent; only the verify step spawns 3 parallel agents.

## Argument Parsing

Parse $ARGUMENTS as: `<workflow-name> [--variant <v>]`

Example: `/optimize outreach-collector`

## Execution Model

```
baseline              ← 1 agent
  ↓
optimize-programmatic ← 1 agent (builds on baseline YAML)
  ↓
optimize-time         ← 1 agent (builds on previous output)
  ↓
optimize-validation   ← 1 agent (builds on previous output)
  ↓
verify-model-tier     ← 3 parallel agents [haiku] [sonnet] [opus]
  ↓
synthesize            ← programmatic (auto-executes)
```

- Steps 1-4: single agent, sequential. Each optimization builds on the previous.
- Step 5: 3 agents in parallel. Runs the optimized WF with 3 model tiers.
- Step 6: programmatic. Auto-computes final metrics comparison.

## Phases

### Phase 1: Setup

1. **Validate**: `lrail wf lrail-optimize validate`
2. **Create**: `lrail wf lrail-optimize create --param workflow_name="<name>" [--param target_variant="<v>"]` — capture the **alias**

### Phase 2: Baseline + Optimization (sequential, 1 agent)

Launch **1 agent** (`general-purpose`) to handle steps 1-4:

- The agent runs `start`, performs baseline measurement, submits via `next`
- Then handles each optimization step sequentially: analyze, improve, submit
- Each optimization step's assertion gate verifies the metric improved vs baseline
- If rejected, the agent retries with a better optimization

Include full lrail command syntax (start, next, bash) in the agent prompt.

### Phase 3: Verify Model Tier (3 parallel)

After step 4 completes, lrail advances to step 5 (verify-model-tier).

1. Read the step 5 prompt from the agent's last `next` output
2. Query the optimized YAML: `lrail <alias> query --step optimize-validation`
3. Spawn **3 agents in parallel** (`general-purpose`), one per model tier:
   - Each agent creates an instance of the target workflow and runs it to completion
   - Each agent returns: `{model_tier, completed, execution_time_sec, validation_failure_count}`
   - **These agents do NOT interact with the optimize instance** — they run the TARGET workflow
4. Collect results from all 3 agents
5. Package into `tier_results` + compute `min_passing_tier`
6. Submit: `lrail <alias> next --result '<json>'`

### Phase 4: Report

Step 6 (synthesize) auto-executes as a programmatic step, producing `metrics_comparison`.

Run `lrail <alias> query` and display:
- 4-axis metrics comparison table (baseline vs optimized)
- Whether all 4 metrics improved
- Total changes applied across all directions

## Agent Prompt Templates

### Steps 1-4 agent (Phase 2)
- Instance alias and lrail commands (start, next, bash)
- Target workflow name
- Instruction: follow each step's prompts, do real optimization work
- Tip: use minimal params for test runs (e.g., min_companies=3)

### Verify tier agents (Phase 3)
- Target workflow name and optimized YAML
- Model tier assignment (which model this agent represents)
- Instruction: create and run the target workflow, measure time and rejection count
- **Do NOT include optimize instance lrail commands** — these agents run the TARGET workflow only

## Critical Rules

- **Steps 1-4 use a single agent** — sequential optimization pipeline
- **Step 5 uses 3 parallel agents** — one per model tier for verification
- **Step 5 agents run the TARGET workflow**, not the optimize workflow
- **Step 6 is programmatic** — auto-executes after step 5
- **You (orchestrator) never do step work** — only manage lifecycle
- Never manipulate state files directly — only interact through the CLI
