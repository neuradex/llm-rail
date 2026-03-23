---
name: LLM Rail
description: Deterministic workflow control for LLM agents
---

## What is LLM Rail?

LLM Rail is a guardrail framework for agentic work. `lrail` is its CLI command.

The dual meaning of "rail": **Track** (speed & productivity) + **Guardrail** (safety & correctness).

LLM Rail works at two levels:

- **Standalone guardrails** — install the plugin, get policy enforcement and audit logging immediately. No workflows needed. A single `lrail.yml` controls what agents can do.
- **Workflow control** — decompose complex tasks into validated steps with full orchestration, policy, and audit.

## Topics

### concepts/
Core building blocks of the framework.

- **step-types** — Agentic vs programmatic steps, agent selection
- **validation** — Declarative guards, cross-step assertions, verify_source
- **actions** — `js:` and `shell:` actions with pipe data flow
- **policy** — Command control: trail → enforce
- **phases** — Workflow lifecycle: draft → dev → stable
- **variants** — Multiple workflow designs, extends, merge semantics

### workflow/
How to use LLM Rail in practice.

- **first-run** — Your first workflow from scratch
- **execution** — How to execute a workflow instance (commands, flow, orchestration)
- **review** — How to review a workflow (trial run, analysis, audit)
- **design-process** — Workflow design methodology and planning
- **design-tips** — Design principles and anti-patterns
- **promote** — Maturing a workflow through phases
