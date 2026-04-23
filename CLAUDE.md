# LLM Rail — Project Instructions

## Terminology
- **LLM Rail** = the framework
- **`lrail`** = the CLI command
- Do not confuse these. "lrail is a framework" is wrong. "LLM Rail is a framework, `lrail` is its CLI" is correct.

## Documentation Architecture

### Single Source of Truth: `learn/` (lrail docs)
All concepts, procedures, and guidelines live in `learn/`. Agents and skills reference `lrail docs <topic>` — they do NOT duplicate content.

- `learn/concepts/` — step-types, schemas, router, call, actions, validation, policy, phases, variants
- `learn/workflow/` — execution, first-run, review, design-process, design-tips, requirements-analysis, promote

### Agents & Skills = Role + Reference
- `agents/*.md` — role definition + `lrail docs` references only
- `skills/*/SKILL.md` — behavioral workflow + `lrail docs` references only
- Exception: `agents/workflow-designer.md` keeps YAML schema inline (it's the designer's core tool)

### Maintenance Rule
When modifying source code that affects:
- CLI commands → update `learn/workflow/execution.md` and `learn/workflow/first-run.md`
- Assertion operators → update `learn/concepts/validation.md`
- Step type behavior → update `learn/concepts/step-types.md`
- Router semantics → update `learn/concepts/router.md`
- Call / composition → update `learn/concepts/call.md`
- Schema dialect / parser → update `learn/concepts/schemas.md`
- Policy behavior → update `learn/concepts/policy.md`
- Actions behavior → update `learn/concepts/actions.md`
- v1 type definitions → update `src/types-v1.ts` and the schema references in `learn/concepts/schemas.md`

**Never add concept explanations to agents/skills.** Always put them in `learn/` and reference with `lrail docs`.

## v1 vs legacy

`format: v1` workflows use the new runtime (`src/engine/*-v1.ts`, `src/types-v1.ts`). Files without that marker fall back to the legacy path. The legacy loader has a guard that rejects v1 files with a clear message; the v1 loader only accepts v1 files. Do not add code that silently accepts one shape as the other.

The 1.0.0 release plan removes legacy entirely after the migration tool + docs are complete. Until then, keep the two implementations separate; do not weave shared state across them.

### Consistency Check
Run `/consistency-check` periodically to detect drift between source code, docs, agents, and skills.

## Development Environment

```bash
# Install dependencies + build
npm install && npm run build

# lrail is now available via npx or node_modules/.bin
lrail docs
lrail wf list

# For live development without rebuilding
npx tsx src/cli.ts docs
```

The CLI resolves package directories (`learn/`, `builtins/`) via `import.meta.url`, so it works from the repo root without setting any environment variables.
