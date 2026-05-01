---
name: LLM Rail
description: Declarative workflow orchestration for LLM agents
---

## What is LLM Rail?

LLM Rail is a declarative framework for orchestrating agent work with static verification. `lrail` is its CLI command.

The dual meaning of "rail": **Track** (speed & productivity) + **Guardrail** (safety & correctness).

LLM Rail works at two levels:

- **Standalone guardrails** — install the plugin, get policy enforcement and audit logging immediately. No workflows needed. A single `lrail.yml` controls what agents can do.
- **Workflow orchestration** — decompose complex tasks into typed steps, compose whole workflows as functions, and statically verify the whole thing before it runs.

A v1 workflow is a function: declared **input** and **output** schemas, a composable **step graph**, and no hidden state. Another workflow can `call` it in the same way a program calls a function.

## Topics

### concepts/
Core building blocks of the framework.

- **step-types** — `agentic`, `programmatic`, `router`, `call`
- **schemas** — Named JSON Schema definitions, structural typing, workflow IO
- **router** — Declarative branching and bounded loops
- **call** — Workflow composition via sub-instance spawn + recursion
- **actions** — `js:` and `shell:` actions, `name`/`description` required, pipe data flow
- **validation** — Structural checks (absorbed into schemas) and residual assertions (`script`, `verify_source`)
- **policy** — Command control: trail → enforce
- **phases** — Workflow lifecycle: draft → dev → stable
- **variants** — Multiple workflow designs, extends, merge semantics

### workflow/
How to use LLM Rail in practice.

- **first-run** — Your first v1 workflow from scratch
- **execution** — Commands, flow, orchestration (including `compile`, `graph`, `migrate`)
- **review** — How to review a workflow (trial run, analysis, audit)
- **design-process** — Workflow design methodology and planning
- **design-tips** — Design principles and anti-patterns
- **promote** — Maturing a workflow through phases

## Quickstart

```bash
lrail wf <name> compile              # Static checks: schemas, references, routers, recursion
lrail wf <name> graph --json         # Structured JSON for visualizers
lrail wf <name> migrate              # Convert a legacy workflow to v1
```

The legacy format (the pre-1.0 `steps:` + `params:` shape, with `lrail.set/get/goto`, `tips`, `accumulate`, and workflow hooks) is no longer supported at runtime. Use `lrail wf migrate` once to convert your files, then review the `.migrated.yml` output.
