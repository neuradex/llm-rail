<p align="center">
  <img src="https://img.shields.io/npm/v/llm-rail?style=flat-square&color=blue" alt="npm" />
  <img src="https://img.shields.io/badge/Claude_Code-plugin-blueviolet?style=flat-square" alt="Claude Code plugin" />
  <img src="https://img.shields.io/badge/license-MIT-green?style=flat-square" alt="license" />
</p>

<p align="center">
  <strong>에이전트 작업을 위한 가드레일.</strong>
</p>

<p align="center">
  <a href="#왜-레일인가">왜 레일인가</a> ·
  <a href="#작동-방식">작동 방식</a> ·
  <a href="#시작하기">시작하기</a> ·
  <a href="#claude-code-플러그인">플러그인</a> ·
  <a href="./CONTRIBUTING.ko.md">기여 가이드</a>
</p>

<p align="center">
  <a href="../README.md">English</a> ·
  <strong>한국어</strong> ·
  <a href="./README.ja.md">日本語</a>
</p>

---

Ruby on Rails가 웹 개발에 레일을 깔았듯이, **LLM Rail은 에이전트 작업에 레일을 깝니다.**

"레일"이라는 단어에는 두 가지 의미가 담겨 있으며, 둘 다 의도적입니다:

- **궤도로서의 레일**: 에이전트가 달리는 사전 정의된 워크플로우 스텝. 빠르고, 효율적이고, 낭비가 없습니다.
- **가드레일로서의 레일**: 에이전트가 궤도를 벗어나지 못하게 하는 구조적 제어입니다.

LLM 에이전트는 복잡한 작업에서 무너집니다. 단계를 건너뛰고, 출력을 날조하고, 컨텍스트가 길어지면 원래 해야 할 일을 잊어버립니다. 더 큰 모델을 투입하면 비용만 올라갈 뿐, 성공이 보장되지 않습니다. 근본 원인은 **LLM의 최신성 편향(recency bias)** 입니다. 긴 컨텍스트에서 원래 지시를 잊고 표류합니다.

현재의 AI 안전성 접근법은 **대시보드에 붙인 스티커** 수준입니다 — "조심해라", "실수하지 마라" 같은 프롬프트 레벨 경고죠. LLM Rail은 다른 접근을 취합니다: **구조적 안전성**. 모델에게 착하게 굴라고 부탁하는 대신, 나쁜 일이 *발생할 수 없는* 실행 구조를 만듭니다.

**LLM Rail**은 세 겹의 레일로 이 문제를 해결합니다:

| 레일 | 제어 대상 |
|---|---|
| **워크플로우 레일** | 작업을 검증 가능한 스텝으로 분해합니다. 각 스텝은 좁은 컨텍스트에서 실행되어, Opus 대신 Haiku로도 충분합니다. |
| **정책 레일** | 모든 셸 명령이 IAM 스타일 allow/deny 규칙이 적용되는 bash 프록시를 거칩니다. 명시적으로 허가된 것만 실행 가능합니다. |
| **감사 레일** | 모든 액션, 명령, 검증이 기록됩니다. 인스턴스별 완전한 추적이 가능합니다. |

**LLM 시대의 Convention over Configuration**이라고 생각하시면 됩니다. Rails가 MVC로 "웹 앱을 만드는 법"을 정의했듯이, LLM Rail은 워크플로우 분해 + 실행 제어 + 감사 추적으로 "AI 에이전트를 운용하는 법"을 정의합니다. Opus가 워크플로우를 설계하고, Haiku가 그 위에서 달립니다.

AI 에이전트가 복잡한 코드 리뷰에 실패했나요? 검증 가능한 3개 스텝으로 나누어 각각 Haiku로 실행하세요. 총 비용은 $2에서 $0.08로 줄어듭니다. 모든 출력이 검증되고, 전체 감사 로그가 남습니다.

---

## 왜 레일인가

LLM에는 **최신성 편향(recency bias)** 이 있습니다 — 컨텍스트가 길어질수록 원래 지시를 더 많이 잊어버립니다 ([Peysakhovich & Lerer 2023](https://arxiv.org/abs/2310.01427), [Liu et al. 2023](https://arxiv.org/abs/2307.03172)). 이것이 복잡한 에이전트 작업의 근본적인 실패 패턴입니다.

LangChain이나 CrewAI 같은 기존 프레임워크는 오케스트레이션을 다루지만, 프레임워크 레벨의 **실행 제어와 감사 추적**은 제공하지 않습니다. 에이전트에게 *무엇을* 하라고는 알려주지만, *어디까지 할 수 있는지*는 제어하지 않습니다. LLM Rail이 이 공백을 채웁니다.

LLM Rail은 **각 스텝의 컨텍스트를 작고 집중적으로 유지**하여 recency 문제를 해결합니다:

- 각 스텝은 `context_in`으로 필요한 데이터만 받는 깨끗한 에이전트를 사용합니다
- 이전 스텝에서 누적된 컨텍스트 오염이 없습니다
- 에이전트가 똑똑할 필요 없이, 좁은 지시를 정확히 따르기만 하면 됩니다

이것이 **Haiku가 Opus를 대체할 수 있는** 이유입니다. 모델의 능력이 아니라 범위의 문제입니다. 작은 컨텍스트의 작은 모델이 큰 컨텍스트에 파묻힌 큰 모델보다 낫습니다.

그리고 진행 상황을 추적하는 것은 LLM이 아니라 워크플로우 엔진이기 때문에, **수백 개의 스텝이 있는 워크플로우라도 빠짐없이 전부 실행됩니다.** 긴 컨텍스트의 LLM 에이전트는 필연적으로 스텝을 빼먹지만, 워크플로우 엔진은 절대 빠뜨리지 않습니다.

엔터프라이즈에게 이것은 세 가지 핵심 질문에 대한 답입니다: **"복잡한 프로세스를 처리할 수 있나요?"** — 엔진이 모든 스텝의 완료를 보장합니다. **"통제할 수 있나요?"** — 정책 레일로 가능합니다. **"문제를 추적할 수 있나요?"** — 감사 레일로 가능합니다. 전부 프롬프트 레벨의 약속이 아니라 아키텍처 레벨에서 답합니다.

---

## 작동 방식

### 스텝 타입

LLM Rail은 하나의 워크플로우 안에서 두 가지 스텝 타입을 지원합니다:

```yaml
steps:
  # Programmatic: LLM이 필요 없습니다. CLI가 직접 실행합니다.
  - id: fetch-data
    type: programmatic
    actions:
      - shell: "curl -s {{api_url}}/data"
        extract: { records: "data", count: "total" }

  # Agentic: LLM 에이전트가 작업하고, 출력이 검증됩니다.
  - id: analyze
    description: "{{count}}개 레코드의 이상 징후 분석"
    instruction: "레코드를 분석하고 위험 점수와 함께 이상 징후를 식별하세요"
    depends_on: fetch-data
    context_in:
      records: "{fetch-data.records}"
    required_output: [anomalies, risk_score]
    validation:
      - field: anomalies
        op: type
        value: array
      - field: risk_score
        op: between
        value: [0, 100]

  # Programmatic: LLM 없이 후처리합니다.
  - id: notify
    type: programmatic
    depends_on: analyze
    actions:
      - shell: "curl -X POST {{webhook}} -d '{\"score\": {{risk_score}}}'"
```

**Programmatic 스텝**은 밀리초 단위로 실행되며 토큰 비용이 0입니다. **Agentic 스텝**은 집중된 검증 범위를 받아 Haiku가 안정적으로 처리합니다.

### 정책 시스템

에이전트가 실행할 수 있는 명령을 제어합니다 — AWS IAM에서 영감을 받았습니다:

```yaml
policy:
  mode: enforce
  rules:
    - effect: allow
      commands: ["curl *", "jq *", "node *"]
    - effect: deny
      commands: ["rm *", "sudo *"]
```

- **Trail 모드**: 전부 허용, 전부 기록. 개발 및 정책 발견에 사용합니다.
- **Enforce 모드**: deny-first 규칙 평가. 프로덕션에 사용합니다.
- **정책 생성**: trail 로그에서 최소한의 allow-list를 자동 생성합니다.

모든 명령은 bash 프록시(`lrail <id> bash "<cmd>"`)를 거치며, 정책을 적용하고 모든 실행을 기록합니다.

### 검증 게이트

22개의 내장 연산자가 각 스텝의 출력을 검사한 뒤 다음으로 진행합니다:

```yaml
validation:
  - field: file_list
    op: type
    value: array
  - field: complexity_score
    op: between
    value: [1, 10]
assertions:
  - field: comments
    op: each_has
    value: file
    message: 모든 코멘트에 파일 참조가 있어야 합니다
```

두 단계로 나뉩니다: **validation**(사전 검증 가드)은 부적절한 제출을 거부합니다. **assertions**(사후 검증)는 실패 시 해당 스텝을 되돌립니다. 에이전트가 에러 메시지를 받고 자동으로 재시도하므로, 사람이 개입할 필요가 없습니다.

`verify_source`(URL을 가져와서 데이터 스니펫이 실제로 존재하는지 확인하는 날조 방지)와 `script`(셸 기반 커스텀 검증 로직)도 포함됩니다.

### 워크플로우 라이프사이클

모든 워크플로우는 성숙도 단계를 거쳐 발전합니다:

```
draft → dev → stable
```

- **draft**: 탐색 단계입니다. 제약 없이 실행해보고, 결과를 관찰하고, 반복합니다.
- **dev**: 작동하는 워크플로우입니다. 검증을 다듬고, agentic 스텝을 programmatic으로 전환합니다.
- **stable**: 프로덕션 준비 완료입니다. 정책이 `enforce` 모드여야 합니다.

`lrail wf <name> promote`으로 실행 이력을 분석하고 승격 권장 사항을 확인할 수 있습니다.

### 배리언트

여러 설계 방식이 공존하고, 비교하고, 병합할 수 있습니다:

```
workflows/stock-screening/
  workflow.yml              # 베이스 (실행 대상)
  api-driven.workflow.yml   # 직접 API 방식
  programmatic.workflow.yml # 완전 결정적 방식
```

배리언트는 `extends: base`로 베이스를 상속하고 차이점만 정의합니다. 스텝은 ID 기준으로 병합됩니다 — 같은 ID면 오버라이드, 새 ID면 추가, 배리언트에 없는 ID는 베이스 그대로 유지됩니다. `lrail wf <name> merge <variant>`로 우수한 배리언트를 베이스에 병합할 수 있습니다.

### Accumulate 모드

데이터를 점진적으로 수집하는 스텝에 사용합니다:

```yaml
- id: collect
  instruction: "기업 데이터를 배치 단위로 수집하세요"
  required_output: [companies]
  accumulate:
    companies:
      key: ticker
  validation:
    - field: companies
      op: min_length
      value: 20
```

에이전트가 배치 단위로 제출하면, 각 배치가 키 기준 중복 제거와 함께 풀에 병합됩니다. 검증은 누적된 풀을 대상으로 실행되며, 품질 기준을 충족할 때까지 스텝이 열린 상태로 유지됩니다.

### 감사 추적

모든 이벤트가 인스턴스별로 기록됩니다:

```
.llm-rail/{workflow}/{instance}/
  ├── state.yaml      # 인스턴스 상태
  ├── audit.jsonl      # 전체 라이프사이클 이벤트
  └── policy.jsonl     # 전체 명령 실행 기록
```

---

## 기능 요약

| | |
|---|---|
| **스텝 타입** | `programmatic`(LLM 없이 직접 실행)과 `agentic`(LLM 에이전트 + 검증)을 하나의 워크플로우에서 사용합니다. |
| **액션** | `js:`(컨텍스트가 자동 주입되는 JavaScript)와 `shell:`(템플릿 보간 + JSON 추출). 체이닝된 액션 간 파이프 스타일 데이터 흐름을 지원합니다. |
| **정책** | AWS IAM 스타일 allow/deny 규칙. trail과 enforce 모드. 모든 에이전트 명령에 bash 프록시를 적용합니다. |
| **검증 게이트** | 22개 내장 연산자. 구조적 검증 + 비즈니스 로직 어서션 + `verify_source` 날조 방지 + `script` 커스텀 로직. |
| **명시적 데이터 플로우** | `context_in`으로 필요한 데이터만 전달합니다 — 암묵적 병합이나 컨텍스트 오염이 없습니다. |
| **Accumulate 모드** | 키 기준 중복 제거 병합으로 점진적 데이터 수집. 품질 게이트를 충족할 때까지 스텝이 열려 있습니다. |
| **배리언트** | 여러 워크플로우 설계가 공존하고, 비교하고, 병합됩니다. `extends: base`로 ID 기준 스텝 병합. |
| **라이프사이클 단계** | `draft` → `dev` → `stable` 진행, 승격 분석 지원. |
| **라이프사이클 훅** | 모든 단계에서 gate/event 훅 (`step:before_start`, `step:completed`, `policy:denied` 등). |
| **감사 로그** | 모든 이벤트를 JSONL로 기록. 인스턴스별 audit + policy 로그로 완전한 추적이 가능합니다. |
| **Claude Code 플러그인** | 내장 스킬 & 에이전트 — 에디터를 떠나지 않고 워크플로우를 설계, 실행, 감사할 수 있습니다. |

---

## 시작하기

### 설치

```bash
npm install llm-rail
```

### Claude Code 플러그인으로

```bash
# 마켓플레이스 추가
/plugin marketplace add neuradex/llm-rail

# 플러그인 설치
/plugin install llm-rail@llm-rail
```

프로젝트에서 `/llm-rail:init`을 실행하면 워크플로우 세팅과 `CLAUDE.md` 등록이 완료됩니다.

### CLI 레퍼런스

```bash
# 문서 탐색
lrail docs [topic]

# 워크플로우 관리
lrail wf list                                       # 전체 워크플로우 목록
lrail wf instances [--status <status>]              # 전체 인스턴스 목록
lrail wf <name> create [--variant <v>] [--param k=v]  # 인스턴스 생성
lrail wf <name> validate [--variant <v>]            # 워크플로우 YAML 검증
lrail wf <name> show [--variant <v>]                # 워크플로우 YAML 표시
lrail wf <name> variants                            # 배리언트 목록
lrail wf <name> merge <variant> [--backup <name>]   # 배리언트를 베이스에 병합
lrail wf <name> list [--status <status>]            # 인스턴스 목록
lrail wf <name> promote                             # 단계 승격 분석

# 인스턴스 실행
lrail <id> start                                    # 실행 시작
lrail <id> next --result '<json>'                   # 스텝 결과 제출
lrail <id> status                                   # 진행 상황 확인
lrail <id> query [--step <stepId>]                  # 인스턴스 상태 조회
lrail <id> reset <step-id>                          # 스텝 초기화
lrail <id> log [step-id] [-f]                       # 감사 로그 조회
lrail <id> bash '<command>'                         # 정책 프록시를 통한 명령 실행
lrail <id> summary                                  # 워크플로우 요약 및 경고
lrail <id> policy generate                          # trail에서 정책 생성

# 배리언트 관리
lrail wf <name> save-variant <v> --yaml '<content>'  # 배리언트 YAML 저장
```

---

## Claude Code 플러그인

Claude Code 플러그인으로 설치하면 CLI를 직접 다룰 필요 없이 모든 것을 처리할 수 있습니다.

| 스킬 | 설명 |
|---|---|
| `/llm-rail:init` | 프로젝트에 LLM Rail 세팅 |
| `/llm-rail:design` | 자연어로 작업을 설명하면 검증된 YAML 워크플로우를 생성합니다 |
| `/llm-rail:build` | 빌트인 메타 워크플로우를 사용해 워크플로우를 생성하고 최적화합니다 |
| `/llm-rail:run` | 엔드투엔드 실행 — 단일 에이전트가 전체 스텝을 순차 실행합니다 |
| `/llm-rail:review` | 시험 실행 + 분석 — 문제 검출, 수정 제안, 정책 생성 |
| `/llm-rail:status` | 실행 중인 워크플로우의 상태를 확인합니다 |
| `/llm-rail:optimize` | 기존 워크플로우를 최적화합니다 (베이스라인, 3단계 최적화, 3티어 검증) |

### 자동 워크플로우 생성

YAML을 직접 작성하고 싶지 않으신가요? 프레임워크가 대신 만들어 드립니다:

- **`/llm-rail:build`** — 자연어로 작업을 설명하세요. 프레임워크가 실현 가능성을 분석하고, 워크플로우를 생성하고, 검증하고, 테스트 실행까지 자동으로 수행합니다.
- **`/llm-rail:optimize`** — 기존 워크플로우를 받아 7단계 최적화 파이프라인을 실행합니다: 베이스라인 측정 → programmatic 비율 개선 → 실행 시간 단축 → 검증 실패 감소 → 3티어 모델 검증 → 종합 리포트. 결과는 배리언트 파일로 저장되며 원본은 수정하지 않습니다.

이 메타 워크플로우들은 LLM Rail 자체를 사용하여 LLM Rail 워크플로우를 만들고 개선합니다 — 프레임워크가 스스로를 호스팅합니다.

### `/llm-rail:run` 실행 시

```
오케스트레이터 (메인 에이전트)
  │
  ├── 워크플로우 검증 → 인스턴스 생성
  │
  └── 인스턴스 전체에 에이전트 1개 spawn
        │
        ├── start → [programmatic 스텝 자동 실행] → agentic 스텝 프롬프트
        ├── 작업 → next → [programmatic 스텝 자동 실행] → agentic 스텝 프롬프트
        ├── 작업 → next → ...
        │
        └── 워크플로우 완료. 모든 스텝 검증됨. 전체 감사 로그.
```

하나의 에이전트, 하나의 인스턴스, 처음부터 끝까지. 각 스텝은 좁고 검증된 범위를 받습니다. 최소한의 컨텍스트, 최소한의 비용.

---

<p align="center">
  <strong>안전한 AI = 모델에게 착하게 굴라고 부탁하는 것이 아니라, 나쁜 일이 발생할 수 없는 구조를 만드는 것입니다.</strong>
  <br>
  레일을 정의하세요. 저렴한 모델을 그 위에서 달리게 하세요 — 빠르고, 안전하고, 투명하게.
</p>
