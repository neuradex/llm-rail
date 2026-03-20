# Contributing

> [English](./CONTRIBUTING.md) · [한국어](./CONTRIBUTING.ko.md) · [日本語](./CONTRIBUTING.ja.md)

## Project Structure

```
src/
├── cli.ts                # CLI entry point
├── types.ts              # Type definitions
├── util.ts               # YAML I/O, ID generation, utilities
├── engine/
│   ├── workflow.ts       # Workflow loading & schema validation
│   ├── state.ts          # Instance state CRUD
│   ├── validator.ts      # Step output validation (21 operators)
│   ├── context.ts        # Cross-step context resolution & template interpolation
│   ├── dependency.ts     # Step dependency resolution
│   ├── hooks.ts          # Lifecycle hooks (gate / event)
│   ├── tip-pool.ts       # Random tip selection
│   └── output.ts         # CLI output formatting
├── commands/
│   ├── create.ts         ├── start.ts
│   ├── next.ts           ├── status.ts
│   ├── query.ts          ├── reset.ts
│   ├── list.ts           └── validate.ts
└── audit/
    └── logger.ts         # Audit log (JSONL)
```

## Development

```bash
npm install                          # Install dependencies
npm run build                        # Build
npm test                             # Run tests
npm run dev -- create code-review    # Dev mode
```

## CLI Reference

```
llm-rail create <workflow> [--param k=v]     Create instance from workflow definition
llm-rail <id> start                          Start the next pending step
llm-rail <id> next --result '<json>'         Submit step output (validated)
llm-rail <id> status                         Show instance progress
llm-rail <id> query [--step <step-id>]       Query step details
llm-rail <id> reset <step-id>               Reset a step for re-execution
llm-rail validate <workflow>                 Validate workflow YAML schema
llm-rail list [--status <status>]            List all instances
```

## Workflow Schema

### Top-level

| Field | Type | Required | Description |
|---|---|---|---|
| `name` | string | yes | Workflow identifier |
| `version` | string | no | Semver version |
| `description` | string | no | Human-readable purpose |
| `params` | object | no | Input parameters (type, required, default, description, validation) |
| `context` | object | no | Shared context |
| `steps` | StepDef[] | yes | Ordered step definitions |

### Step fields

| Field | Type | Required | Description |
|---|---|---|---|
| `id` | string | yes | Unique step identifier |
| `description` | string | yes | Supports `{{param}}` interpolation |
| `depends_on` | string \| string[] | no | Step ID(s) this depends on |
| `required_output` | string[] | yes | Fields the agent must produce |
| `validation` | Rule[] | no | Structural validation rules |
| `assertions` | Rule[] | no | Business logic assertions |
| `context_in` | object | no | Explicit data flow: `local_name: "{stepId.field}"` |
| `tips` | string[] | no | Execution hints (2 randomly shown per step) |
| `meta` | object | no | Arbitrary metadata for hooks |

### Template Syntax

- `{{param}}` — Parameter interpolation in description fields
- `{stepId.field}` — Step output reference in `context_in` values

## Validation Operators

21 built-in operators for `validation` and `assertions` rules:

| Op | Description | Applies to |
|---|---|---|
| `exists` | Field exists | any |
| `not_empty` | Not empty | string / array / object |
| `type` | Type check (`string`, `number`, `boolean`, `array`, `object`) | any |
| `min_length` | Minimum length | string / array |
| `max_length` | Maximum length | string / array |
| `length` | Exact length | string / array |
| `min` | Minimum value | number |
| `max` | Maximum value | number |
| `between` | Range `[min, max]` | number |
| `eq` | Strict equality | any |
| `neq` | Not equal | any |
| `gt` | Greater than | number |
| `gte` | Greater or equal | number |
| `lt` | Less than | number |
| `lte` | Less or equal | number |
| `contains` | Contains value | string / array |
| `not_contains` | Does not contain | string / array |
| `matches` | Regex match | string |
| `one_of` | One of allowed values | any |
| `each_has` | Every array item has key | array |

All rules support a `message` field for custom error text.

- **`validation`** — Structural checks (type, length, emptiness). "Is the data shaped correctly?"
- **`assertions`** — Business logic checks (value ranges, allowed values). "Does the data make sense?"

## Lifecycle Hooks

Hooks fire at workflow/step lifecycle events:

| Hook | Type | Description |
|---|---|---|
| `step:before_start` | gate | Can block step from starting |
| `step:started` | event | Fires after step enters `in_progress` |
| `step:rejected` | event | Fires when validation fails |
| `step:before_complete` | gate | Can block step completion |
| `step:completed` | event | Fires after step completes |
| `workflow:completed` | event | Fires when all steps are done |

Gate hooks return `{ allow: boolean, message?: string }`.

## License

Private
