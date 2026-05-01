---
name: 0001-declarative-orchestration
description: LLM Rail 포맷 재설계 — stateless 모델, 4개 스텝 타입, named schemas, call 기반 워크플로우 합성
status: Draft · v1
type: RFC (internal)
target: lrail 1.0.0
---

# RFC 0001: Declarative Orchestration

## 1. Summary

lrail 워크플로우 포맷을 재설계한다. 핵심 변화:

- **Stateless 모델**: 워크플로우는 input을 받아 output을 내는 순수 함수. 내부 store / mutable state 없음.
- **스텝 타입 4개로 축소**: `agentic`, `programmatic`, `router`, `call`. 각자 하나의 일.
- **Named schemas 필수**: 모든 스키마는 `schemas:` 블록에서 이름으로 정의. inline 금지.
- **Workflow 합성**: 워크플로우 자체가 input/output 스키마를 가지고, `call` 스텝으로 다른 워크플로우를 함수처럼 호출.
- **제거**: `tips`, workflow hooks, `state.context` store, `lrail.set/get/goto`, `accumulate`, `loop` (개념), `router.state`.

breaking change. clean break로 1.0.0 릴리스. `lrail wf migrate` 도구로 변환.

## 2. Motivation

Loom 등 consumer 측에서 lrail 워크플로우를 **agent가 편집하고 human이 시각화**하려 할 때 현 포맷은 다음과 같은 난점이 있다:

- 제어 흐름이 `js` action 안의 `lrail.goto()` 호출에 묻힘 → 외부 도구가 정규식 파싱에 의존.
- `lrail.set/get`이 글로벌 store를 불투명하게 변조 → 어떤 스텝이 무엇을 읽고 쓰는지 정적 분석 불가.
- `required_output: [field_names]` 는 필드명 리스트일 뿐 형·제약이 `validation` 블록에 흩어짐 → 스키마 한 곳에 모이지 않음.
- 워크플로우를 다른 워크플로우에서 호출할 메커니즘 부재 → orchestration 불가능.

이 문제들은 표면적으로 "포맷 장식"이 아니라 **lrail의 표현 단위를 한 층 위로 올리는 기회**다. 워크플로우 자체가 합성 가능한 함수가 되면 lrail은 "단일 워크플로우 실행기"에서 "워크플로우 오케스트레이터"로 올라간다.

## 3. Design Principles

### 3.1 One Obvious Way

한 문제에는 하나의 해결책만 둔다. 중복 채널 허용 안 함. 다음을 이 원칙으로 판단했다:

- 분기 → router 하나 (기존 `lrail.goto` 제거)
- 반복 → router backward goto (단순 반복) 또는 재귀 `call` (누적 반복). state 필드 없음.
- 데이터 전달 → `context_in` 하나 (기존 store 제거)
- 누적 → 재귀 `call`의 input 버퍼 (기존 `accumulate` 제거)
- 스키마 정의 → named schemas 하나 (inline 금지)

### 3.2 Stateless

워크플로우 내부에 mutable state를 두지 않는다. 모든 데이터는 step output으로 흐르고, 누적이 필요하면 재귀 `call`의 input/output 버퍼로 명시한다. side effect가 필요하면 `actions`의 `js`/`shell`에서 외부 시스템 (파일, DB, 큐) 에 명시적으로 접근한다. 숨은 상태 0.

### 3.3 Structural Typing

스키마 호환성은 **구조 기준**. 이름이 달라도 같은 shape면 호환. 도메인마다 같은 데이터에 다른 이름을 붙이는 현실을 반영.

### 3.4 Compile-time Verification

`lrail wf compile` 이 워크플로우 파일을 실행 전에 검증:
- 스키마 참조 유효성 + 순환 참조 감지
- `context_in` 참조가 prior step output에 존재하는가 + 타입 호환
- router 도달 가능성 (모든 case와 default)
- `call` 대상 워크플로우의 input/output 호환성
- 재귀 `call`의 max_depth 한계 설정 여부

정적 검증으로 잡히는 오류는 런타임까지 끌고 가지 않는다.

## 4. New Model

### 4.1 워크플로우 파일 구조

```yaml
name: <workflow-name>
version: "<semver>"

schemas:                    # 이 워크플로우에서 쓰는 모든 스키마
  <SchemaName>:
    ...

input: <SchemaName>         # 워크플로우 외부 경계 (호출자가 채움)
output: <SchemaName>        # 워크플로우 외부 경계 (완료 시 반환)

policy: ...                 # (기존 유지)
phases: ...                 # (기존 유지)
variants: ...               # (기존 유지)

steps:
  - id: <step-id>
    type: agentic | programmatic | router | call
    ...
```

### 4.2 스텝 타입

#### 4.2.1 agentic

에이전트가 판단을 수행하는 스텝. 변경 최소:
- `instruction` (필수)
- `context_in` (선택, prior step / workflow input에서 매핑)
- `required_output: <SchemaName>` (필수, named schema 참조)
- `validation` / `assertions` (기존 유지)

```yaml
- id: classify
  type: agentic
  context_in:
    items: "{fetch.raw}"
  instruction: "각 item을 structured / freeform / mixed 중 하나로 분류"
  required_output: ClassificationResult
```

#### 4.2.2 programmatic

`actions` (js/shell) 을 실행하는 스텝. 변경점:
- `actions[].name` 필수
- `actions[].description` 필수
- `js:` body 안의 `lrail.set/get/goto` 금지. 순수 `return` 만 허용.

```yaml
- id: dedupe-merge
  type: programmatic
  context_in:
    pool: "{prev-round.pool}"
    batch: "{collect.batch}"
  required_output: MergedPool
  actions:
    - name: dedupe
      description: ticker 기준 중복 제거 후 병합
      js: |
        const seen = new Set(context.pool.map(p => p.ticker));
        const fresh = context.batch.filter(b => !seen.has(b.ticker));
        return { pool: [...context.pool, ...fresh] };
```

`name` / `description` 필수화의 근거: 워크플로우의 처리 로직이 의미 단위로 쪼개져서 이름·설명이 달리지 않으면 시각화·검토 관점에서 코드가 그대로 블랙박스가 된다. 규율을 스키마 레벨에서 강제.

#### 4.2.3 router

분기 전용 스텝. state 없음.

```yaml
- id: gate
  type: router
  context_in:
    kind: "{classify.kind}"
    err_count: "{process.errors.length}"
  cases:
    - when:
        all:
          - { field: "{{kind}}", op: eq, value: structured }
          - { field: "{{err_count}}", op: lt, value: 5 }
      goto: parse-structured
    - when:
        any:
          - { field: "{{kind}}", op: eq, value: freeform }
          - { field: "{{err_count}}", op: gte, value: 5 }
      goto: parse-freeform
  default: error
  max_iterations: 100        # backward goto가 있으면 필수
```

설계:
- `cases[].when`: validation op 재사용. `all` / `any` / `not` 조합자 허용.
- `cases[].goto`: 타겟 step id. 스키마에 노출되어 정적 분석 가능.
- `default`: 어떤 case도 매칭 안 되면. **생략 시 compile error**.
- `max_iterations`: backward goto (이 router 이전 step을 가리키는 goto) 가 하나라도 있으면 필수. 런타임 초과 시 에러.
- 선택된 case의 id 또는 index는 이 router step의 output으로 기록 (다음 step에서 참조 가능).
- **reset 정책**: backward goto 시 target부터 이 router까지의 step output 전부 reset (`state: pending`, `output: undefined`). 현재 `applyGoto` 동작 그대로 유지.

#### 4.2.4 call

다른 워크플로우를 함수처럼 호출.

```yaml
- id: clean
  type: call
  workflow: clean-records    # 호출 대상 워크플로우 이름
  inputs:                    # 대상의 input: 스키마에 매핑
    raw: "{fetch.raw_data}"
    rules: "{{cleaning_rules}}"
  # 이 step의 output = 호출된 워크플로우의 output (output: 스키마 그대로)
```

실행 모델:
- **별도 sub-instance spawn**. parent와 격리된 새 인스턴스 생성, child 완료 시 output이 call step의 output으로 노출.
- audit: parent 쪽에 `called <workflow> (sub-instance <id>)` 한 줄, 상세는 child 자신의 audit.jsonl. drill-down 가능.
- 재귀 허용 (자기 자신 call). **`max_depth` 안전장치 필수** (기본 100, workflow에서 override 가능).
- call `inputs:` 값은 **단순 참조만**. 복잡한 계산은 앞에 `programmatic` step을 배치해 명시적 이름·설명과 함께 분리.

### 4.3 Schemas

```yaml
schemas:
  Input:
    type: object
    properties:
      raw: { type: array, items: Record }
      rules: { type: array, items: CleaningRule }
    required: [raw, rules]

  Output:
    type: object
    properties:
      cleaned: { type: array, items: Record }
      dropped_count: { type: integer, minimum: 0 }
    required: [cleaned, dropped_count]

  Record:
    type: object
    properties:
      id: { type: string }
      data: { type: object }
    required: [id, data]

  CleaningRule:
    type: object
    properties:
      field: { type: string }
      action: { type: string, enum: [drop, normalize, default] }
    required: [field, action]
```

**규칙**:
- 모든 스키마는 `schemas:` 블록에서 이름으로 정의. **inline object 정의 금지** (파서 단계에서 거부).
- 참조는 값 자리에 **이름 문자열**만 (`items: Record`). `{ $ref: ... }` 같은 JSON Schema 정식 문법은 도입하지 않는다.
- 참조 가능한 위치: `input:`, `output:`, `required_output:`, `properties` / `items` 내부, 다른 schema의 중첩.
- 이름 공간은 해당 워크플로우 파일 내. 워크플로우 간 공유는 future (§8).
- 순환 참조 허용 (재귀 데이터 구조). compile 시 감지 후 의도적 허용 판정.

**방언: JSON Schema 2020-12 minimal subset**:
- `type`: object / array / string / number / integer / boolean
- `properties` / `required` / `additionalProperties`
- `items` (array)
- `enum` / `const`
- `oneOf` (discriminated union)
- `default`
- `minLength` / `maxLength` / `minimum` / `maximum` / `minItems` / `maxItems`

**빠지는 것**: `$ref`, `allOf`, `anyOf`, `not`, `if/then/else`, `dependentSchemas`, `patternProperties`. LLM 생성 난이도 높고 실수요 낮음. 필요시 개별 평가 후 추가.

### 4.4 context_in

스텝의 **input 매핑**. prior step output / workflow input에서 이 스텝 안의 변수명으로 가져옴.

```yaml
- id: report
  context_in:
    items: "{transform.cleaned}"           # prior step의 field
    threshold: "{{quality_threshold}}"     # workflow input (param)
  ...
```

- 값 자리 구문:
  - `"{stepId.fieldName}"` — prior step output
  - `"{{inputFieldName}}"` — workflow input
- 타입 자동 추론: 참조 대상 스키마에서 끌어옴 (compile-time). 별도 선언 불필요.
- workflow input 참조가 추론 불가하거나 좁히고 싶으면 `{ from: "...", type: <SchemaName> }` 형태 명시 옵션 허용 (선택).

## 5. Removed Concepts

| 제거 | 이유 | 대체 |
|---|---|---|
| `tips` | 재시도 힌트 샘플링 sugar | instruction 인터폴레이션 또는 programmatic step에서 명시 구성 |
| `hooks` (workflow lifecycle 12 이벤트) | 실사용 0, 문서화 0, README의 "hooks"와 이름 충돌 | `audit.jsonl` 이미 모든 lifecycle 이벤트 기록 중 |
| `state.context` store | 불투명 글로벌 채널 | `context_in` 매핑 + step output |
| `lrail.set` | store 변조 | action에서 `return { ... }` |
| `lrail.get` | store 조회 | 다음 step의 `context_in` |
| `lrail.goto` | js 안에 묻힌 분기 | `router` step |
| `accumulate` | agentic retry pool sugar | 재귀 `call`의 input 버퍼 |
| `loop` (개념) | 반복 전용 타입 | router backward goto 또는 재귀 `call` |
| `router.state` | 이전 제안에서 누적용으로 상정 | 재귀 `call`로 표현, router는 순수 분기 |

router의 `before_complete` 같은 gate 훅 용도가 필요한 경우에는 **pre-check programmatic step**으로 표현한다.

## 6. Compile-time Verification

`lrail wf compile <path>` 가 다음을 검증:

1. **스키마 무결성**: 모든 참조가 `schemas:` 에 존재. 순환 참조 리포트.
2. **context_in 유효성**: 참조하는 step/field가 존재하고 실행 경로에 도달 가능.
3. **router reachability**: 모든 case와 default의 goto 타겟 존재. backward goto 있으면 `max_iterations` 필수.
4. **call IO 호환**: `inputs:` 가 대상 워크플로우 `input:` 스키마와 구조적 호환. call step의 output 사용처가 대상 `output:` 스키마와 호환.
5. **재귀 안전**: `call` 이 자기 자신 또는 사이클을 이루면 `max_depth` 설정 여부 확인.
6. **actions 규율**: `name` / `description` 존재.

compile 통과 후에만 `start` 가능 (또는 `--skip-compile` 플래그로 임시 우회).

## 7. Migration

### 7.1 Clean Break

구 포맷 / 신 포맷 병행 지원 없음. 1.0.0 릴리스 시점에 신 포맷만 실행.

`lrail wf validate <path>` 가 구 포맷 파일을 감지하면:
```
error: legacy format detected. run `lrail wf migrate <path>` to convert.
```

### 7.2 `lrail wf migrate <path>`

반자동 변환 도구. 확신 높은 변환은 자동, 의미 재설계가 필요한 부분은 `# TODO migrate:` 주석으로 표시.

변환 규칙:

| 구 포맷 | 신 포맷 |
|---|---|
| `params:` | `schemas.Input` 생성 + `input: Input` |
| 마지막 agentic step의 `required_output` | `schemas.Output` 추론 생성 + `output: Output` |
| `lrail.set({k: v})` in action | `return { k: v }` + 다음 step의 `context_in` 에 참조 추가 |
| `lrail.get("k")` in action | 가장 가까운 prior step에서 field 추적, `context_in` 매핑 |
| `lrail.goto("target")` | 독립 `router` step으로 추출, 조건 best-effort 복원 |
| `accumulate:` | TODO 주석 (재귀 call 패턴으로 사람이 재설계) |
| `hooks:` 필드 | 제거 + audit.jsonl 안내 주석 |
| `tips:` | instruction에 주석으로 삽입하거나 제거 |
| step `validation` 블록의 구조적 체크 | `schemas.<StepOutput>` 으로 추출, 나머지는 그대로 유지 (script, verify_source 등) |

예상 출력:
```
$ lrail wf migrate workflows/stock-screening.yml
✓ params → schemas.Input
✓ 12 steps migrated
⚠  2 unresolved:
   - step 'collect': accumulate needs redesign to recursive call (TODO)
   - step 'filter': lrail.goto in conditional needs manual router extraction (TODO)
→ written to workflows/stock-screening.migrated.yml
→ review TODO comments before using
```

자동 변환 범위는 완전하지 않음을 명시. 특히 accumulate와 goto 조건 추출은 인간 개입 전제.

## 8. Examples

### 8.1 단순 파이프라인

```yaml
name: data-cleaning
version: "1.0.0"

schemas:
  Input:
    type: object
    properties:
      source_url: { type: string }
      format: { type: string, enum: [json, csv] }
    required: [source_url, format]

  Output:
    type: object
    properties:
      cleaned: { type: array, items: Record }
      dropped_count: { type: integer, minimum: 0 }
    required: [cleaned, dropped_count]

  Record:
    type: object
    properties:
      id: { type: string }
      data: { type: object }
    required: [id, data]

  FetchResult:
    type: object
    properties:
      raw: { type: array, items: Record }
      metadata: { type: object }
    required: [raw, metadata]

  CleanResult:
    type: object
    properties:
      cleaned: { type: array, items: Record }
      dropped_count: { type: integer, minimum: 0 }
    required: [cleaned, dropped_count]

input: Input
output: Output

steps:
  - id: fetch
    type: programmatic
    context_in:
      url: "{{source_url}}"
      fmt: "{{format}}"
    required_output: FetchResult
    actions:
      - name: http-fetch
        description: 소스에서 원시 레코드 수집
        js: |
          const res = await fetch(context.url);
          const raw = await res.json();
          return { raw, metadata: { fetched_at: new Date().toISOString() } };

  - id: clean
    type: agentic
    context_in:
      raw: "{fetch.raw}"
    instruction: "raw의 각 레코드를 정제하고 dropped된 개수를 보고"
    required_output: CleanResult

  - id: finalize
    type: programmatic
    context_in:
      cleaned: "{clean.cleaned}"
      dropped: "{clean.dropped_count}"
    required_output: Output
    actions:
      - name: shape-output
        description: 최종 output 형태로 포장
        js: |
          return { cleaned: context.cleaned, dropped_count: context.dropped };
```

### 8.2 재귀 누적 (큐 소진)

```yaml
name: collect-until
version: "1.0.0"

schemas:
  Input:
    type: object
    properties:
      pool: { type: array, items: Item, default: [] }
      queue: { type: array, items: Item }
      target_size: { type: integer, minimum: 1 }
    required: [queue, target_size]

  Output:
    type: object
    properties:
      pool: { type: array, items: Item }
    required: [pool]

  Item:
    type: object
    properties:
      id: { type: string }
      payload: { type: object }
    required: [id, payload]

  RoundResult:
    type: object
    properties:
      processed: Item
    required: [processed]

  NextInput:
    type: object
    properties:
      pool: { type: array, items: Item }
      queue: { type: array, items: Item }
      target_size: { type: integer }
    required: [pool, queue, target_size]

input: Input
output: Output

max_depth: 200     # 자기 자신 call의 재귀 깊이 상한

steps:
  - id: done-check
    type: router
    context_in:
      pool: "{{pool}}"
      queue: "{{queue}}"
      target: "{{target_size}}"
    cases:
      - when:
          any:
            - { field: "{{pool}}", op: min_length, value: "{{target}}" }
            - { field: "{{queue}}", op: length, value: 0 }
        goto: return
    default: process-one

  - id: process-one
    type: agentic
    context_in:
      item: "{{queue[0]}}"
    instruction: "item을 처리하고 enriched 결과를 반환"
    required_output: RoundResult

  - id: build-next
    type: programmatic
    context_in:
      pool: "{{pool}}"
      queue: "{{queue}}"
      target: "{{target_size}}"
      processed: "{process-one.processed}"
    required_output: NextInput
    actions:
      - name: extend-pool
        description: 처리된 item을 pool에 추가하고 queue에서 제거
        js: |
          return {
            pool: [...context.pool, context.processed],
            queue: context.queue.slice(1),
            target_size: context.target,
          };

  - id: recurse
    type: call
    workflow: collect-until
    inputs:
      pool: "{build-next.pool}"
      queue: "{build-next.queue}"
      target_size: "{build-next.target_size}"

  - id: return
    type: programmatic
    context_in:
      pool: "{{pool}}"
      recursed_pool: "{recurse.pool}"
    required_output: Output
    actions:
      - name: select-pool
        description: recurse가 실행됐으면 그 결과, 아니면 현재 pool
        js: |
          return { pool: context.recursed_pool ?? context.pool };
```

포인트:
- router의 `done-check` 가 종료 조건 두 가지를 explicit 하게 스키마에 노출.
- 누적은 `build-next` 에서 input 버퍼로 쌓고 `recurse` 에 넘김. state 필드 없음.
- 재귀 종료 시 `return` step이 base case (`pool`) 또는 재귀 결과 (`recurse.pool`) 를 선택.
- `max_depth: 200` 이 무한 재귀 방지.

### 8.3 합성 (다른 워크플로우 호출)

```yaml
name: pipeline
version: "1.0.0"

schemas:
  Input:
    type: object
    properties:
      source_url: { type: string }
    required: [source_url]

  Output:
    type: object
    properties:
      report: { type: string }
    required: [report]

  FetchResult:
    type: object
    properties:
      raw: { type: array, items: Record }
    required: [raw]

  CleanResult:
    type: object
    properties:
      cleaned: { type: array, items: Record }
      dropped_count: { type: integer }
    required: [cleaned, dropped_count]

  Record:
    type: object
    properties:
      id: { type: string }
      data: { type: object }
    required: [id, data]

input: Input
output: Output

steps:
  - id: fetch
    type: programmatic
    context_in: { url: "{{source_url}}" }
    required_output: FetchResult
    actions:
      - name: http-get
        description: URL에서 raw records 수집
        js: |
          const res = await fetch(context.url);
          return { raw: await res.json() };

  - id: clean
    type: call
    workflow: data-cleaning        # §8.1의 워크플로우
    inputs:
      source_url: "{{source_url}}"
      format: json

  - id: report
    type: agentic
    context_in:
      cleaned: "{clean.cleaned}"
      dropped: "{clean.dropped_count}"
    instruction: "cleaned와 dropped_count로 요약 보고서 작성"
    required_output: Output
```

`clean` step이 `data-cleaning` 워크플로우의 output 스키마(`Output`, `{ cleaned, dropped_count }`) 그대로 노출하여 `report` 에서 참조. orchestration 자연 성립.

## 9. Open Questions

구현 중 결정할 세부:

1. **자기 자신이 아닌 간접 재귀 (A → B → A)**: depth 카운터는 동일하게 적용. 사이클 감지를 compile 단계에서 경고할지 에러로 막을지.
2. **tail call optimization**: 마지막 step이 `call self` 이고 그 output을 그대로 워크플로우 output으로 쓰는 경우 sub-instance spawn 대신 현재 인스턴스 재시작. MVP 에 포함 여부.
3. **스키마 파일 분할**: 여러 워크플로우가 공유하는 스키마를 `_shared/schemas.yml` 로 추출. 첫 버전에 불포함, 수요 생기면 별도 RFC.
4. **에이전트 tool schema 자동 노출**: agentic step의 `required_output` 스키마를 OpenAI function schema로 변환해 에이전트 런타임에 제공. RFC §3.6의 아이디어 중 살릴 만한 부분. 별도 RFC 후보.
5. **`context_in` 내 path 표현력**: 현재 `"{step.field}"` 단일 참조만. 배열 인덱싱 `"{step.items[0]}"` 이나 중첩 `"{step.nested.field}"` 를 허용할지. 제한 유지 권장 (복잡한 추출은 programmatic step에 격리).
6. **policy / phases / variants 와의 상호작용**: call된 child 워크플로우의 policy가 parent와 독립인지, parent가 덮어쓰는지. 기본 독립, `call` 에서 명시 override 옵션.

## 10. Non-goals

- `fn: |` 인라인 함수 정의 도입 (RFC 원안의 §3.3). `js:` body와 사실상 동일하며 경계 타입 이득은 named schema로 이미 달성.
- RFC 원안의 `branches:` (tagged union 기반 분기). router로 동등 표현 가능 (discriminator 필드를 agentic output에 두고 router가 분기).
- 워크플로우 외부에서 lrail runtime을 library로 임베드. CLI 실행 모델 유지.
- GUI 편집기 제공. Loom 등 consumer에 위임.

## 11. Implementation Plan

1. **Parser + schemas 인프라** — `schemas:` 블록 파싱, 이름 resolver, 순환 감지, JSON Schema subset 검증기 (Ajv 또는 json-schema-to-zod).
2. **새 step runner** — agentic / programmatic / router / call 각 타입의 실행 경로. 기존 runner 교체.
3. **call sub-instance orchestrator** — child 인스턴스 spawn, audit 연결, depth 카운터.
4. **`lrail wf compile`** — 정적 검증기.
5. **`lrail wf graph --json`** — 구조 export (Loom 연동).
6. **`lrail wf migrate`** — 반자동 변환 도구.
7. **문서 + examples 재작성** — `learn/` 전체, builtins (`lrail-build`, `lrail-optimize`), examples.
8. **회귀 테스트** — 기존 stateful 워크플로우 1~2개를 migrate 돌려 신 포맷으로 변환, 동일 input에서 side effect 순서 / output 일치 확인.
9. **1.0.0 릴리스** — changelog, README 갱신, 마이그레이션 가이드.

## 12. Success Criteria

- 기존 example 워크플로우들이 신 포맷으로 변환되어 동일 실행 결과 (side effect 순서, output). 
- `lrail wf compile` 이 타입·참조 오류를 런타임 전에 잡음. 실측: 의도적으로 오류 심은 워크플로우에서 100% 감지.
- Loom 측에서 YAML 정규식 파싱 없이 `lrail wf graph --json` 으로 노드/엣지/IO 스키마/분기 전체 렌더 가능.
- agent (workflow-designer) 가 LLM으로 신 포맷 워크플로우를 생성했을 때 `lrail wf compile` pass 비율이 구 포맷 대비 유의미하게 높음 (내부 벤치마크).
- 개념 수 감소: 구 포맷 문서화된 핵심 개념 (step type 2개 + validation/assertion + actions + params + tips + hooks + accumulate + policy + phases + variants + store + goto) 에서 tips/hooks/accumulate/store/goto 제거 → 개념 수 축소.

## 13. References

- 이 RFC의 논의 배경: Loom의 agent-driven 워크플로우 편집 + 시각화 요구.
- RFC 원안 (함수형 노드 + JSON Schema I/O 제안) — 본 문서의 일부 아이디어 (named schema, structural IO, call 합성) 를 흡수.
- 관련 기존 문서: `learn/concepts/step-types.md`, `learn/concepts/validation.md`, `learn/concepts/actions.md`, `learn/concepts/policy.md`.
