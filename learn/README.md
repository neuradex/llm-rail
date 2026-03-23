---
name: LLM Rail
description: Deterministic workflow control for LLM agents
---

## What is LLM Rail?

LLM Rail is a guardrail framework for agentic work. `lrail` is its CLI command.

LLM Rail splits complex tasks into steps and controls execution with validation, policy, and audit.

The dual meaning of "rail": **Track** (speed & productivity) + **Guardrail** (safety & correctness).

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
