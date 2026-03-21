# 기여 가이드

> [English](./CONTRIBUTING.md) · [한국어](./CONTRIBUTING.ko.md) · [日本語](./CONTRIBUTING.ja.md)

## 프로젝트 구조

```
src/
├── cli.ts                # CLI 엔트리포인트
├── types.ts              # 타입 정의 (StepDef, ActionDef, PolicyDef 등)
├── util.ts               # YAML I/O, ID 생성, 유틸리티
├── engine/
│   ├── workflow.ts       # 워크플로우 정의 로딩 & 스키마 검증
│   ├── state.ts          # 인스턴스 상태 CRUD (.llm-rail/{workflow}/{instance}/)
│   ├── validator.ts      # 스텝 출력 검증 (21개 연산자)
│   ├── context.ts        # 스텝 간 컨텍스트 해결 & 템플릿 보간
│   ├── dependency.ts     # 스텝 간 의존성 해결
│   ├── hooks.ts          # 라이프사이클 훅 (gate / event)
│   ├── actions.ts        # 액션 실행기 (template, stdin, extract)
│   ├── runner.ts         # 프로그래매틱 스텝 자동 실행 (advanceThrough)
│   ├── policy.ts         # 정책 평가 + 트레일 로깅
│   ├── tip-pool.ts       # 팁 랜덤 선택
│   └── output.ts         # CLI 출력 포매팅
├── commands/
│   ├── create.ts         ├── start.ts
│   ├── next.ts           ├── status.ts
│   ├── query.ts          ├── reset.ts
│   ├── list.ts           ├── validate.ts
│   ├── bash.ts           └── policy.ts
└── audit/
    └── logger.ts         # 감사 로그 (JSONL) + instanceDir 헬퍼
```

## 개발

```bash
npm install                          # 의존성 설치
npm run build                        # 빌드
npm test                             # 테스트 실행
npm run dev -- create code-review    # 개발 모드
```

## CLI 레퍼런스

```
lrail wf <workflow> create [--param k=v]                워크플로우 정의로 인스턴스 생성
lrail <id> start                                     다음 대기 중인 스텝 시작
lrail <id> next --result '<json>'                    스텝 출력 제출 (검증됨)
lrail <id> bash '<command>'                          정책 적용 프록시를 통한 명령 실행
lrail <id> status                                    인스턴스 진행 상황 표시
lrail <id> query [--step <step-id>]                  스텝 상세 조회
lrail <id> reset <step-id>                           스텝 리셋 후 재실행
lrail wf <workflow> validate                            워크플로우 YAML 스키마 검증
lrail wf <name> list [--status <status>]                       전체 인스턴스 목록
lrail wf <workflow> policy check --command '<cmd>'      정책 체크 드라이런
lrail <alias|id> policy generate         트레일 로그로부터 허용 목록 생성
```

## 워크플로우 스키마

### 최상위

| 필드 | 타입 | 필수 | 설명 |
|---|---|---|---|
| `name` | string | O | 워크플로우 식별자 |
| `version` | string | X | Semver 버전 |
| `description` | string | X | 워크플로우 설명 |
| `params` | object | X | 입력 파라미터 (type, required, default, description, validation) |
| `context` | object | X | 공유 컨텍스트 |
| `policy` | PolicyDef | X | 명령 실행 정책 (trail/enforce) |
| `steps` | StepDef[] | O | 정렬된 스텝 정의 |

### 스텝 필드

| 필드 | 타입 | 필수 | 설명 |
|---|---|---|---|
| `id` | string | O | 고유 스텝 식별자 |
| `type` | string | X | `"agentic"` (기본값) 또는 `"programmatic"` |
| `description` | string | agentic 전용 | `{{param}}` 보간 지원 |
| `depends_on` | string \| string[] | X | 선행 스텝 ID |
| `required_output` | string[] | agentic 전용 | 에이전트가 반드시 생성해야 하는 필드 |
| `actions` | ActionDef[] | programmatic 필수 | 실행할 셸 명령 |
| `validation` | Rule[] | X | 구조적 검증 규칙 |
| `assertions` | Rule[] | X | 비즈니스 로직 어서션 |
| `context_in` | object | X | 명시적 데이터 플로우: `로컬명: "{stepId.field}"` |
| `tips` | string[] | X | 실행 힌트 (스텝당 2개 랜덤 표시) |
| `meta` | object | X | 훅용 임의 메타데이터 |

### ActionDef

| 필드 | 타입 | 필수 | 설명 |
|---|---|---|---|
| `run` | string | O | 셸 명령. `{{field}}` 템플릿 보간 지원. |
| `extract` | object | X | stdout JSON에서 추출할 `targetKey: sourceKey` 매핑. |

### PolicyDef

| 필드 | 타입 | 필수 | 설명 |
|---|---|---|---|
| `mode` | string | O | `"trail"` (로그만) 또는 `"enforce"` (deny-first 규칙) |
| `rules` | PolicyRule[] | enforce 전용 | `{ effect: "allow"\|"deny", commands: string[] }` 배열 |

### 템플릿 문법

- `{{param}}` — description 및 action `run` 필드에서 파라미터 보간
- `{stepId.field}` — `context_in`에서 스텝 출력 참조

## 검증 연산자

`validation`과 `assertions` 규칙에 사용 가능한 21개 내장 연산자:

| 연산자 | 설명 | 대상 |
|---|---|---|
| `exists` | 필드가 존재하는지 | any |
| `not_empty` | 비어있지 않은지 | string / array / object |
| `type` | 타입 체크 (`string`, `number`, `boolean`, `array`, `object`) | any |
| `min_length` | 최소 길이 | string / array |
| `max_length` | 최대 길이 | string / array |
| `length` | 정확한 길이 | string / array |
| `min` | 최솟값 | number |
| `max` | 최댓값 | number |
| `between` | 범위 `[min, max]` | number |
| `eq` | 완전 일치 | any |
| `neq` | 불일치 | any |
| `gt` | 초과 | number |
| `gte` | 이상 | number |
| `lt` | 미만 | number |
| `lte` | 이하 | number |
| `contains` | 값 포함 | string / array |
| `not_contains` | 값 미포함 | string / array |
| `matches` | 정규표현식 매치 | string |
| `one_of` | 허용 값 목록 내 | any |
| `each_has` | 배열의 각 요소가 해당 키를 보유 | array |

모든 규칙에 `message` 필드로 커스텀 에러 메시지 지정 가능.

- **`validation`** — 구조적 체크 (타입, 길이, 비어있음). "데이터 형태가 맞는가?"
- **`assertions`** — 비즈니스 로직 체크 (값 범위, 허용 값). "데이터가 타당한가?"

## 라이프사이클 훅

워크플로우/스텝 라이프사이클에서 발생하는 훅:

| 훅 | 타입 | 설명 |
|---|---|---|
| `step:before_start` | gate | 스텝 시작을 차단할 수 있음 |
| `step:started` | event | 스텝이 `in_progress`에 진입한 후 발생 |
| `step:rejected` | event | 검증 실패 시 발생 |
| `step:before_complete` | gate | 스텝 완료를 차단할 수 있음 |
| `step:completed` | event | 스텝 완료 후 발생 |
| `step:reset` | event | 스텝 리셋 시 발생 |
| `workflow:created` | event | 인스턴스 생성 시 발생 |
| `workflow:completed` | event | 모든 스텝 완료 시 발생 |
| `workflow:error` | event | 워크플로우 에러 발생 시 |
| `action:before_run` | event | 액션 실행 전 발생 |
| `action:completed` | event | 액션 완료 후 발생 |
| `action:failed` | event | 액션 실패 시 발생 |
| `policy:denied` | event | 정책이 명령을 차단했을 때 발생 |

Gate 훅은 `{ allow: boolean, message?: string }`을 반환.

## 인스턴스 디렉토리 구조

모든 인스턴스 데이터는 통합 디렉토리에 저장:

```
.llm-rail/{workflow-name}/{instance-id}/
  ├── state.yaml      # 인스턴스 상태 (steps, context, status)
  ├── audit.jsonl      # 라이프사이클 이벤트 로그
  └── policy.jsonl     # 명령 실행 로그 (bash proxy)
```

## 라이선스

Private
