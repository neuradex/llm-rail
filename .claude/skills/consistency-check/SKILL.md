---
description: Check consistency across lrail docs (learn/), skills, agents, README, and source code
context: fork
allowed-tools: Read, Glob, Grep, Bash
---

# Consistency Check

You are auditing the lrail repository for inconsistencies. The key principle: **`learn/` (lrail docs) is the single source of truth** for all concepts, procedures, and guidelines. Agents and skills must reference docs, not duplicate them.

## Sources of Truth

| Domain | Source of truth | Location |
|---|---|---|
| CLI commands | Source code | `src/cli.ts` |
| Types / schema | Source code | `src/types.ts` |
| Assertion operators | Source code | `src/engine/validator.ts` (`opHandlers`) |
| Step types & agent selection | lrail docs | `learn/concepts/step-types.md` |
| Validation & assertions | lrail docs | `learn/concepts/validation.md` |
| Policy system | lrail docs | `learn/concepts/policy.md` |
| Actions system | lrail docs | `learn/concepts/actions.md` |
| Workflow phases | lrail docs | `learn/concepts/phases.md` |
| Execution procedure | lrail docs | `learn/workflow/execution.md` |
| Review methodology | lrail docs | `learn/workflow/review.md` |
| Design principles | lrail docs | `learn/workflow/design-tips.md` |

## What to cross-check

### 1. lrail docs ↔ Source Code
- Assertion operators in `learn/concepts/validation.md` must match `opHandlers` in `src/engine/validator.ts` and `AssertionOp` in `src/types.ts`
- Step type descriptions in `learn/concepts/step-types.md` must match behavior in `src/engine/runner.ts` and `src/engine/workflow.ts`
- CLI commands in `learn/workflow/execution.md` and `learn/workflow/first-run.md` must match `src/cli.ts`
- Policy behavior in `learn/concepts/policy.md` must match `src/engine/policy.ts`

### 2. Agents/Skills → lrail docs (no duplication)
- **Agents** (`agents/*.md`) and **skills** (`skills/*/SKILL.md`) must NOT contain inline explanations of concepts that belong in `learn/`
- They should reference `lrail docs <topic>` instead
- Check for: assertion operator tables, step type decision matrices, agent selection guides, execution flow details, policy explanations
- If found inline → flag as duplication, suggest replacing with `lrail docs` reference

### 3. CLI Commands
- **Source of truth**: `src/cli.ts` (usage function and command routing)
- **Must match**: `learn/workflow/execution.md`, `learn/workflow/first-run.md`, `agents/workflow-designer.md` CLI Reference, `README.md`

### 4. Schema / Type Definitions
- **Source of truth**: `src/types.ts` (StepDef, WorkflowDef, ParamDef, etc.)
- **Must match**: `agents/workflow-designer.md` schema reference (this is the one place schema stays inline — it's the designer's core reference)

### 5. Package & Plugin
- `package.json` `files` array — all listed paths must exist
- `.claude-plugin/plugin.json` version should match `package.json` version

### 6. Skill & Agent Metadata
- Each skill's `description` in frontmatter must reflect what it does
- Each agent's `description` must reflect its role
- `allowed-tools` in skills must include all tools actually used
- Agent `tools` list must match tools the agent is told to use

### 7. Terminology
- **LLM Rail** = the framework name
- **`lrail`** = the CLI command
- Docs and agents should not confuse these (e.g., "lrail is a framework" is wrong — "LLM Rail is a framework, `lrail` is its CLI" is correct)

## Process

1. **Gather sources**: Read `src/cli.ts`, `src/types.ts`, `src/engine/validator.ts`, all `learn/**/*.md`
2. **Gather dependents**: Read all `skills/*/SKILL.md`, all `agents/*.md`, `README.md`, `package.json`
3. **Compare each check category** above. For each inconsistency:
   - **Where**: which files conflict
   - **What**: the specific mismatch (quote both sides)
   - **Fix**: which file should be updated (source code or `learn/` is always right)
4. **Report summary**:
   - 🔴 **Breaking**: wrong behavior or would confuse agents (e.g., wrong CLI command, duplicated outdated info)
   - 🟡 **Stale**: outdated but not harmful (e.g., missing new operator from docs)
   - 🟢 **Minor**: cosmetic or low-impact

## Output Format

```
## Consistency Report

### lrail docs ↔ Source Code
- 🔴 validation.md missing `verify_source` operator (added in validator.ts)

### Agents/Skills Duplication
- 🟡 workflow-designer.md has inline assertion ops table — should reference `lrail docs concepts/validation`

### CLI Commands
- 🔴 first-run.md shows `lrail hello validate` but CLI expects `lrail wf hello validate`

### Terminology
- 🟢 step-runner.md says "lrail framework" — should say "LLM Rail framework"

## Summary
- 🔴 Breaking: N
- 🟡 Stale: N
- 🟢 Minor: N
```
