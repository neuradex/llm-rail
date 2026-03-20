---
description: Check consistency across all docs, skills, agents, README, and source code in the llm-rail repo
context: fork
allowed-tools: Read, Glob, Grep, Bash
---

# Consistency Check

You are auditing the llm-rail repository for inconsistencies between source code, documentation, skill definitions, agent definitions, and package configuration.

## What to cross-check

### 1. CLI Commands
- **Source of truth**: `src/cli.ts` (the usage function and command routing)
- **Must match**:
  - `README.md` usage section
  - `agents/workflow-designer.md` CLI Reference section
  - `skills/run/SKILL.md` execution flow
  - `skills/status/SKILL.md`
  - Any other file referencing `llm-rail <command>`

### 2. Validation / Assertion Operators
- **Source of truth**: `src/engine/validator.ts` (the `opHandlers` object)
- **Must match**:
  - `README.md` validation operators table
  - `agents/workflow-designer.md` assertion operations table
  - `src/types.ts` (AssertionRule type if it constrains ops)

### 3. Schema / Type Definitions
- **Source of truth**: `src/types.ts` (StepDef, WorkflowDef, ParamDef, etc.)
- **Must match**:
  - `agents/workflow-designer.md` schema reference section
  - `README.md` workflow definition YAML example
  - `skills/design/SKILL.md` if it references schema fields

### 4. Project Structure
- **Source of truth**: actual files in `src/` (use Glob `src/**/*.ts`)
- **Must match**:
  - `README.md` project structure tree

### 5. Package Distribution
- **Source of truth**: `package.json` `files` array
- **Check**:
  - All listed paths actually exist
  - No dev-only files accidentally included
  - `.claude-plugin/plugin.json` version matches `package.json` version

### 6. Skill & Agent Descriptions
- **Cross-check**:
  - Each skill's `description` in frontmatter accurately reflects what the skill does
  - Each agent's `description` in frontmatter accurately reflects the agent's role
  - `allowed-tools` in skills include all tools actually referenced in the skill body
  - Agent `tools` list includes all tools the agent instructions tell it to use

### 7. CLAUDE.md Injection (init skill)
- **Check**:
  - Commands referenced in the CLAUDE.md template inside `skills/init/SKILL.md` are valid skill names
  - Description matches the current purpose of llm-rail

## Process

1. **Gather sources of truth**: Read `src/cli.ts`, `src/types.ts`, `src/engine/validator.ts`, and Glob `src/**/*.ts`
2. **Gather documentation**: Read `README.md`, all `skills/*/SKILL.md`, all `agents/*.md`, `package.json`, `.claude-plugin/plugin.json`
3. **Compare each check category** above. For each inconsistency found, report:
   - **Where**: which files conflict
   - **What**: the specific mismatch (quote both sides)
   - **Fix suggestion**: which file should be updated (always prefer source code as truth)
4. **Report summary**: list all inconsistencies grouped by category, with severity:
   - 🔴 **Breaking**: would cause wrong behavior or confuse agents (e.g., wrong CLI command in a skill)
   - 🟡 **Stale**: outdated but not harmful (e.g., missing file in README structure tree)
   - 🟢 **Minor**: cosmetic or low-impact (e.g., slightly different wording)

## Output Format

```
## Consistency Report

### CLI Commands
- 🔴 README.md missing `query`, `list`, `validate`, `reset` commands
  - src/cli.ts defines: create, list, validate, start, next, status, query, reset
  - README.md shows: create, start, next, status

### Validation Operators
- 🟡 README.md table only lists 5 of 20 operators
  ...

### [category]
- [severity] [description]
  ...

## Summary
- 🔴 Breaking: N
- 🟡 Stale: N
- 🟢 Minor: N
```
