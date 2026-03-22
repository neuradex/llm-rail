# Contributing

> **English** · [한국어](./docs/CONTRIBUTING.ko.md) · [日本語](./docs/CONTRIBUTING.ja.md)

Thank you for your interest in contributing to LLM Rail. This guide covers the process for setting up a development environment, making changes, and submitting contributions.

## Development Setup

```bash
git clone https://github.com/neuradex/llm-rail.git
cd llm-rail
npm install
npm run build
npm test
```

For development with live reload:

```bash
npm run dev -- docs              # Run CLI in dev mode
npx tsx src/cli.ts wf list       # Run directly from source
```

## Project Structure

```
src/           # TypeScript source
  cli.ts       # CLI entry point
  types.ts     # Type definitions
  engine/      # Core engine (workflow, state, validation, policy, actions)
  commands/    # CLI command handlers
  audit/       # Audit logging
learn/         # Documentation (single source of truth — served via `lrail docs`)
agents/        # Agent definitions (role + lrail docs references)
skills/        # Skill definitions (behavioral workflow + lrail docs references)
builtins/      # Built-in meta-workflows
test/          # Tests (node:test)
```

## Reference Documentation

Schema details, validation operators, lifecycle hooks, and other technical references live in `learn/` and are accessed via `lrail docs <topic>`. Do not duplicate them — always reference with `lrail docs`.

Key topics:

```bash
lrail docs concepts/step-types      # Step types (agentic / programmatic)
lrail docs concepts/validation      # Validation operators
lrail docs concepts/actions         # Action system
lrail docs concepts/policy          # Policy enforcement
lrail docs workflow/execution       # Execution procedure
```

## Making Changes

1. Fork the repository and create a feature branch
2. Make your changes with tests
3. Run `npm test` to verify
4. Submit a pull request against `main`

### Documentation Maintenance

When modifying source code, keep docs in sync:

| Changed area | Update |
|---|---|
| CLI commands | `learn/workflow/execution.md`, `learn/workflow/first-run.md` |
| Validation operators | `learn/concepts/validation.md` |
| Step type behavior | `learn/concepts/step-types.md` |
| Policy behavior | `learn/concepts/policy.md` |
| Actions behavior | `learn/concepts/actions.md` |
| Type definitions | `agents/workflow-designer.md` schema reference |

**Never add concept explanations to agents or skills.** Put them in `learn/` and reference with `lrail docs`.

### Code Conventions

- TypeScript with ES modules (`"type": "module"`)
- No external runtime dependencies beyond `js-yaml`
- Functions return plain objects — no classes for data structures
- CLI output uses `engine/output.ts` formatting helpers

### Testing

Tests use Node.js built-in test runner (`node:test`):

```bash
npm test                           # Run all tests
node --import tsx --test test/variant.test.ts   # Run a specific test
```

Tests create temporary directories in `before`/`after` hooks for isolation.

## Areas of Interest

We are actively looking for contributions in these areas:

- **Security model** — strengthening structural enforcement, exploring new isolation patterns
- **Validation operators** — new operators for common use cases
- **Programmatic step patterns** — more action primitives beyond `shell:` and `js:`
- **Sample workflows** — production-grade workflow examples that showcase complex use cases (multi-step pipelines, policy enforcement, validation chains, accumulate patterns, etc.)
- **Agent integrations** — integrations with other AI agents beyond Claude Code (OpenAI Codex, Devin, Cursor Agent, etc.)
- **Benchmarks** — realistic before/after comparisons: cost, accuracy, and completion rate with and without LLM Rail on real-world tasks
- **`lrail docs` indexing** — smarter doc discovery so agents can efficiently find relevant topics without scanning all files
- **Hooks patterns** — reusable lifecycle hook recipes for common needs (notifications, metrics, CI gates, etc.)
- **Bug reports & design feedback** — found a bug, a gap in the design, or something that doesn't feel right? Open an issue. All feedback is welcome.

## License

MIT — see [LICENSE](../LICENSE)
