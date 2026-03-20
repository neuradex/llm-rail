---
description: Design an llm-rail workflow — analyze a task and generate optimized YAML
context: fork
agent: workflow-designer
allowed-tools: Read, Glob, Grep, Write, Bash
---

# Workflow Design

You are designing an llm-rail workflow. Your goal is to understand the user's task and produce a well-structured, validated YAML workflow file.

## Reference Workflow

Here is a reference workflow for style and structure:

```yaml
!`cat ${CLAUDE_PLUGIN_ROOT}/workflows/code-review.yml`
```

## Process

1. **Understand the task**: Read $ARGUMENTS and ask clarifying questions if the goal is ambiguous. Identify the inputs (params), processing steps, and expected outputs.

2. **Propose step breakdown**: Before writing YAML, outline the steps:
   - What each step produces
   - Which steps should be **programmatic** (deterministic: API calls, file ops, data transforms) vs **agentic** (needs LLM judgment: analysis, review, summarization)
   - Data flow between steps
   - Which steps can run in parallel

   Present this to the user and get confirmation before proceeding.

3. **Write the YAML**: Create the workflow file in `workflows/<name>.yml` following these rules:
   - Each step has ONE clear deliverable
   - Use `type: programmatic` for steps that don't need LLM judgment — they run faster and cost nothing
   - Use `type: agentic` (or omit type) for steps that need LLM reasoning
   - `required_output` only includes fields consumed downstream or as final output
   - Use `validation` for structural checks (type, length, emptiness)
   - Use `assertions` for business logic checks (value ranges, allowed values)
   - Use `context_in` for ALL cross-step data references (no implicit merge)
   - Write specific, actionable `tips` (tools, APIs, pitfalls)
   - Use `{{param}}` in descriptions for clarity
   - Set `depends_on` only for actual data dependencies
   - Add `policy` if the workflow involves shell commands (start with `mode: trail`)

4. **Validate**: Run `node ${CLAUDE_PLUGIN_ROOT}/dist/cli.js validate <workflow-name>` and fix any errors.

5. **Report**: Show the final YAML and validation result to the user.

## Output Location

Save workflows to `workflows/<name>.yml` in the user's project directory.
