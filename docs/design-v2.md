# lrail v2 Design Document

> Status: **Implemented** · Date: 2026-03-21

## Overview

v2 introduces three interconnected features:

1. **Step Types** — `programmatic` and `agentic` steps
2. **Actions** — post-validation shell command execution with `run` primitive
3. **Policy** — AWS IAM-inspired command allow/deny with trail/enforce modes

These additions unify the patterns from SNA (emit, permission), tcli (assertions, external scripts), and auto-form (batch API calls) into a single workflow grammar.

---

## 1. Step Types

### Current

All steps are implicitly agentic — they require `description`, `required_output`, and an agent to do the work.

### Proposed

Explicit `type` field on each step:

| type | Description | Agent needed? | Required fields |
|---|---|---|---|
| `agentic` (default) | Agent works on the task. Current behavior. | Yes | `description`, `required_output` |
| `programmatic` | CLI auto-executes. No agent, only actions. | No | `actions` (at least one) |

### Schema Changes

```typescript
export interface StepDef {
  id: string;
  type?: "programmatic" | "agentic";  // default: "agentic"
  description?: string;                // required for agentic, optional for programmatic
  depends_on?: string | string[];
  required_output?: string[];          // required for agentic, optional for programmatic
  validation?: AssertionRule[];
  assertions?: AssertionRule[];
  tips?: string[];
  context_in?: Record<string, string>;
  meta?: Record<string, unknown>;
  actions?: ActionDef[];               // NEW
}
```

### Validation Rules

- `type: "agentic"` (or omitted): `description` and `required_output` are mandatory. Same as v1.
- `type: "programmatic"`: `actions` must have at least one entry. `description` and `required_output` are optional. No agent is spawned.

### Backward Compatibility

- `type` defaults to `"agentic"`. All existing workflows work unchanged.

---

## 2. Actions

Actions run **after validation passes** on agentic steps, or **as the step itself** on programmatic steps.

### Schema

```typescript
export interface ActionDef {
  run: string;                          // shell command
  extract?: Record<string, string>;     // jq-style extraction → context
}
```

### YAML Example

```yaml
steps:
  - id: deploy
    type: programmatic
    depends_on: review
    context_in:
      artifact: "{build.artifact_path}"
    actions:
      - run: "curl -s -X POST https://api.example.com/deploy -d '{\"path\": \"{{artifact}}\"}'"
        extract:
          deploy_id: ".id"
          deploy_url: ".url"
```

### Execution Semantics

1. **Input**: The full step context (resolved `context_in` + accumulated context) is passed to `run` as:
   - **stdin**: JSON object of the entire step context
   - **Template interpolation**: `{{field}}` in the `run` string is replaced with the corresponding context value

2. **Output capture**: If `extract` is defined, the command's stdout is parsed as JSON, and each key is extracted using the specified jq-style path and stored in the workflow context.

3. **Failure**: Non-zero exit code → step fails. Error is logged. Workflow halts (same as validation failure).

4. **Sequential execution**: Multiple actions in a step run sequentially. Each action's extracted values are available to subsequent actions.

### Where Actions Run (by step type)

| Step Type | When Actions Execute | Agent Involved? |
|---|---|---|
| `programmatic` | Actions **are** the step. CLI runs them directly. | No |
| `agentic` | Actions run **after** agent output passes validation. | Agent does the work, actions do post-processing. |

### Template Interpolation

```yaml
actions:
  - run: "echo '{{ticker}}' | process-data"
```

Resolution order:
1. `context_in` resolved values
2. Step output (agentic steps only, after validation)
3. Accumulated workflow context
4. Params

---

## 3. Policy System

### Concept

Inspired by AWS IAM + CloudTrail + Access Analyzer:

- **Trail mode**: Allow everything, log everything. For development and policy discovery.
- **Enforce mode**: Apply allow/deny patterns. For production.
- **Policy generation**: Auto-generate minimal-privilege policy from trail logs.

### Schema

```typescript
export interface PolicyRule {
  effect: "allow" | "deny";
  commands: string[];                   // glob patterns, e.g. "curl *", "rm *"
}

export interface PolicyDef {
  mode: "trail" | "enforce";
  rules?: PolicyRule[];                 // required for enforce mode
}
```

### Workflow-Level Declaration

```yaml
name: stock-screening
policy:
  mode: trail

steps:
  - id: collect
    # ...
```

Or with enforcement:

```yaml
policy:
  mode: enforce
  rules:
    - effect: allow
      commands:
        - "curl *"
        - "jq *"
        - "node *"
    - effect: deny
      commands:
        - "rm *"
        - "sudo *"
```

### Evaluation Order

1. Explicit `deny` rules are checked first.
2. If any deny matches → **block**.
3. Explicit `allow` rules are checked.
4. If any allow matches → **permit**.
5. No match → **block** (implicit deny, like IAM).

### Trail Log Format

```jsonl
{"timestamp":"...","instance_id":"...","step_id":"collect","command":"curl -s https://...","allowed":true}
{"timestamp":"...","instance_id":"...","step_id":"collect","command":"jq '.data'","allowed":true}
```

Stored in `.llm-rail/logs/<id>.policy.jsonl`.

### CLI Commands

```bash
# Generate minimal policy from trail logs
lrail <alias|id> policy generate

# Check a command against a workflow's policy (dry-run)
lrail wf <workflow-name> policy check "curl https://example.com"
```

---

## 4. Bash Proxy

### Problem

step-runner agents need to execute shell commands, but we need:
- Per-instance command logging (audit)
- Policy enforcement
- Context isolation between parallel instances

### Solution

```bash
lrail <id> bash "<command>"
```

This proxy:
1. Resolves the workflow instance and its policy
2. **Trail mode**: Logs the command, then executes it
3. **Enforce mode**: Checks against policy rules, blocks if denied, then executes if allowed
4. Returns stdout/stderr and exit code to the agent

### Agent Configuration

step-runner agent tools:
```
tools: [Read, Glob, Grep, Bash]
```

The agent is instructed to use `lrail <id> bash "<command>"` instead of raw shell commands. Since the agent only knows `start` and `next` (and the instance ID from `start` output), the proxy naturally carries the instance context.

> **Note**: Write/Edit are intentionally excluded. If file writing is needed, the agent submits data via `next`, and the workflow's `actions` handle file operations.

---

## 5. CLI Changes

### New Commands

| Command | Description |
|---|---|
| `lrail <id> bash "<command>"` | Proxied shell execution with policy + logging |
| `lrail <alias|id> policy generate` | Generate minimal policy from trail log |
| `lrail wf <workflow> policy check "<cmd>"` | Dry-run policy check |

### Modified Commands

| Command | Change |
|---|---|
| `lrail <id> next` | After validation, execute `actions` if defined |
| `lrail <id> start` | For `programmatic` steps, auto-execute actions and advance (no agent interaction) |

### CLI Usage Update

```
Usage:
  lrail wf <workflow-name> create [--param k=v ...]
  lrail <id> start
  lrail <id> next --result '<json>'
  lrail <id> bash "<command>"
  lrail <id> status
  lrail <id> query [--step <stepId>]
  lrail <id> reset <step-id>
  lrail wf <name> list [--status <status>]
  lrail wf <workflow-name> validate
  lrail <alias|id> policy generate
  lrail wf <workflow-name> policy check "<command>"
```

---

## 6. Engine Changes

### Action Executor (`src/engine/actions.ts`)

```typescript
export interface ActionResult {
  success: boolean;
  stdout: string;
  stderr: string;
  exitCode: number;
  extracted?: Record<string, unknown>;
}

export function executeAction(
  action: ActionDef,
  context: Record<string, unknown>,
): ActionResult;

export function executeActions(
  actions: ActionDef[],
  context: Record<string, unknown>,
): ActionResult[];
```

Responsibilities:
- Template interpolation (`{{field}}`)
- Pipe context as stdin JSON
- Parse stdout for `extract`
- Return results (success/failure + extracted values)

### Policy Engine (`src/engine/policy.ts`)

```typescript
export function checkPolicy(
  policy: PolicyDef,
  command: string,
): { allowed: boolean; reason: string };

export function logPolicyEvent(
  instanceId: string,
  stepId: string,
  command: string,
  allowed: boolean,
): void;

export function generatePolicy(instanceId: string): PolicyDef;
```

### Modified: `next.ts`

After validation + assertions pass:
```
validate output → assertions → actions (if defined) → advance to next step
```

### Modified: `start.ts`

When starting a `programmatic` step:
```
resolve context_in → execute actions → extract results → auto-complete → advance
```

The programmatic step completes without waiting for `next`.

### Modified: `workflow.ts`

`validateWorkflowDef()` additions:
- If `type: "programmatic"`: validate that `actions` has at least one entry
- If `type: "agentic"` or omitted: existing validation (description + required_output required)
- Validate `policy` section if present
- Validate action `extract` paths

---

## 7. Type Changes Summary

### New Types

```typescript
// Action definition
export interface ActionDef {
  run: string;
  extract?: Record<string, string>;
}

// Policy
export interface PolicyRule {
  effect: "allow" | "deny";
  commands: string[];
}

export interface PolicyDef {
  mode: "trail" | "enforce";
  rules?: PolicyRule[];
}
```

### Modified Types

```typescript
// StepDef: add type + actions
export interface StepDef {
  id: string;
  type?: "programmatic" | "agentic";   // NEW (default: "agentic")
  description?: string;                 // CHANGED: optional for programmatic
  depends_on?: string | string[];
  required_output?: string[];           // CHANGED: optional for programmatic
  validation?: AssertionRule[];
  assertions?: AssertionRule[];
  tips?: string[];
  context_in?: Record<string, string>;
  meta?: Record<string, unknown>;
  actions?: ActionDef[];                // NEW
}

// WorkflowDef: add policy
export interface WorkflowDef {
  name: string;
  version?: string;
  description?: string;
  params?: Record<string, ParamDef>;
  context?: Record<string, unknown>;
  policy?: PolicyDef;                   // NEW
  steps: StepDef[];
}

// HookEvent: add action events
export type HookEvent =
  | "workflow:created"
  | "workflow:completed"
  | "workflow:error"
  | "step:before_start"
  | "step:started"
  | "step:before_complete"
  | "step:completed"
  | "step:rejected"
  | "step:reset"
  | "action:before_run"                 // NEW
  | "action:completed"                  // NEW
  | "action:failed"                     // NEW
  | "policy:denied";                    // NEW
```

---

## 8. Execution Flow Diagrams

### Agentic Step (with actions)

```
start → agent works → next --result '{...}'
  → validate required_output
  → run assertions
  → execute actions (sequential)
  → extract results to context
  → advance to next step
```

### Programmatic Step

```
start (or auto-advance from previous step)
  → resolve context_in
  → execute actions (sequential)
  → extract results to context
  → auto-complete
  → advance to next step
```

### Bash Proxy Flow

```
agent calls: lrail <id> bash "curl ..."
  → load instance → load workflow policy
  → trail mode: log command → execute → return
  → enforce mode: check rules → deny? block : execute → return
```

---

## 9. New Files

| File | Purpose |
|---|---|
| `src/engine/actions.ts` | Action executor (template, stdin, extract) |
| `src/engine/policy.ts` | Policy evaluation + trail logging + generation |
| `src/commands/bash.ts` | Bash proxy command handler |
| `src/commands/policy.ts` | Policy generate/check command handlers |

---

## 10. Migration

- **No breaking changes**. All v1 workflows are valid v2 workflows.
- `type` defaults to `"agentic"`.
- `description` and `required_output` remain required for agentic steps.
- `actions` and `policy` are purely additive.

---

## 11. Implementation Order

| Phase | Scope | Dependency |
|---|---|---|
| **P1** | Types + schema validation | None |
| **P2** | Action executor + template interpolation | P1 |
| **P3** | `next.ts` actions integration (agentic) | P2 |
| **P4** | `start.ts` programmatic step auto-execution | P2 |
| **P5** | Bash proxy + trail logging | P1 |
| **P6** | Policy engine (enforce mode) | P5 |
| **P7** | Policy generate command | P5 |
| **P8** | Update step-runner agent instructions | P5 |
