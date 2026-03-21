# LLM Rail — Project Instructions

## Terminology
- **LLM Rail** = the framework
- **`lrail`** = the CLI command
- Do not confuse these. "lrail is a framework" is wrong. "LLM Rail is a framework, `lrail` is its CLI" is correct.

## Documentation Architecture

### Single Source of Truth: `learn/` (lrail docs)
All concepts, procedures, and guidelines live in `learn/`. Agents and skills reference `lrail docs <topic>` — they do NOT duplicate content.

- `learn/concepts/` — step-types, validation, actions, policy, phases
- `learn/workflow/` — execution, review, design-tips, first-run, promote

### Agents & Skills = Role + Reference
- `agents/*.md` — role definition + `lrail docs` references only
- `skills/*/SKILL.md` — behavioral workflow + `lrail docs` references only
- Exception: `agents/workflow-designer.md` keeps YAML schema inline (it's the designer's core tool)

### Maintenance Rule
When modifying source code that affects:
- CLI commands → update `learn/workflow/execution.md` and `learn/workflow/first-run.md`
- Assertion operators → update `learn/concepts/validation.md`
- Step type behavior → update `learn/concepts/step-types.md`
- Policy behavior → update `learn/concepts/policy.md`
- Actions behavior → update `learn/concepts/actions.md`
- Type definitions → update `agents/workflow-designer.md` schema reference

**Never add concept explanations to agents/skills.** Always put them in `learn/` and reference with `lrail docs`.

### Consistency Check
Run `/consistency-check` periodically to detect drift between source code, docs, agents, and skills.
