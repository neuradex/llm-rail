# Contributing

> [English](./CONTRIBUTING.md) · [한국어](./CONTRIBUTING.ko.md) · [日本語](./CONTRIBUTING.ja.md)

## Project Structure

```
src/
├── cli.ts                # CLI entry point
├── types.ts              # Type definitions (StepDef, ActionDef, PolicyDef, etc.)
├── util.ts               # YAML I/O, ID generation, utilities
├── engine/
│   ├── workflow.ts       # Workflow loading & schema validation
│   ├── state.ts          # Instance state CRUD (.llm-rail/{workflow}/{instance}/)
│   ├── validator.ts      # Step output validation (21 operators)
│   ├── context.ts        # Cross-step context resolution & template interpolation
│   ├── dependency.ts     # Step dependency resolution
│   ├── hooks.ts          # Lifecycle hooks (gate / event)
│   ├── actions.ts        # Action executor (template, stdin, extract)
│   ├── runner.ts         # Programmatic step auto-execution (advanceThrough)
│   ├── policy.ts         # Policy evaluation + trail logging
│   ├── tip-pool.ts       # Random tip selection
│   └── output.ts         # CLI output formatting
├── commands/
│   ├── create.ts         ├── start.ts
│   ├── next.ts           ├── status.ts
│   ├── query.ts          ├── reset.ts
│   ├── list.ts           ├── validate.ts
│   ├── bash.ts           └── policy.ts
└── audit/
    └── logger.ts         # Audit log (JSONL) + instanceDir helper
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
llm-rail create <workflow> [--param k=v]                Create instance from workflow definition
llm-rail <id> start                                     Start the next pending step
llm-rail <id> next --result '<json>'                    Submit step output (validated)
llm-rail <id> bash '<command>'                          Execute command through policy-enforced proxy
llm-rail <id> status                                    Show instance progress
llm-rail <id> query [--step <step-id>]                  Query step details
llm-rail <id> reset <step-id>                           Reset a step for re-execution
llm-rail validate <workflow>                            Validate workflow YAML schema
llm-rail list [--status <status>]                       List all instances
llm-rail policy check <workflow> --command '<cmd>'      Dry-run policy check
llm-rail policy generate <id> --workflow <name>         Generate allow-list from trail logs
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
| `policy` | PolicyDef | no | Command execution policy (trail/enforce) |
| `steps` | StepDef[] | yes | Ordered step definitions |

### Step fields

| Field | Type | Required | Description |
|---|---|---|---|
| `id` | string | yes | Unique step identifier |
| `type` | string | no | `"agentic"` (default) or `"programmatic"` |
| `description` | string | agentic only | Supports `{{param}}` interpolation |
| `depends_on` | string \| string[] | no | Step ID(s) this depends on |
| `required_output` | string[] | agentic only | Fields the agent must produce |
| `actions` | ActionDef[] | programmatic required | Shell commands to execute |
| `validation` | Rule[] | no | Structural validation rules |
| `assertions` | Rule[] | no | Business logic assertions |
| `context_in` | object | no | Explicit data flow: `local_name: "{stepId.field}"` |
| `tips` | string[] | no | Execution hints (2 randomly shown per step) |
| `meta` | object | no | Arbitrary metadata for hooks |

### ActionDef

| Field | Type | Required | Description |
|---|---|---|---|
| `run` | string | yes | Shell command. Supports `{{field}}` template interpolation. |
| `extract` | object | no | Map of `targetKey: sourceKey` to extract from stdout JSON. |

### PolicyDef

| Field | Type | Required | Description |
|---|---|---|---|
| `mode` | string | yes | `"trail"` (log only) or `"enforce"` (deny-first rules) |
| `rules` | PolicyRule[] | enforce only | Array of `{ effect: "allow"\|"deny", commands: string[] }` |

### Template Syntax

- `{{param}}` — Parameter interpolation in description and action `run` fields
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
| `step:reset` | event | Fires when step is reset |
| `workflow:created` | event | Fires when instance is created |
| `workflow:completed` | event | Fires when all steps are done |
| `workflow:error` | event | Fires on workflow error |
| `action:before_run` | event | Fires before action execution |
| `action:completed` | event | Fires after action completes |
| `action:failed` | event | Fires when action fails |
| `policy:denied` | event | Fires when policy blocks a command |

Gate hooks return `{ allow: boolean, message?: string }`.

## Instance Directory Structure

All instance data is stored under a unified directory:

```
.llm-rail/{workflow-name}/{instance-id}/
  ├── state.yaml      # Instance state (steps, context, status)
  ├── audit.jsonl      # Lifecycle event log
  └── policy.jsonl     # Command execution log (bash proxy)
```

## License

Private
