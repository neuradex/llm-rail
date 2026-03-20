<p align="center">
  <img src="https://img.shields.io/npm/v/llm-rail?style=flat-square&color=blue" alt="npm" />
  <img src="https://img.shields.io/badge/Claude_Code-plugin-blueviolet?style=flat-square" alt="Claude Code plugin" />
  <img src="https://img.shields.io/badge/license-private-lightgrey?style=flat-square" alt="license" />
</p>

<p align="center">
  <strong>에이전틱 작업을 위한 가드레일.</strong>
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

Ruby on Rails가 웹 개발에 레일을 깔았듯이, **llm-rail은 에이전틱 작업에 레일을 깐다.**

"레일"이라는 단어에는 이중 의미가 있다 — 둘 다 의도적이다:

- **궤도로서의 레일**: 에이전트가 달리는 사전 정의된 워크플로우 스텝. 빠르고, 효율적이고, 낭비 없음.
- **가드레일로서의 레일**: 에이전트가 궤도를 벗어나지 못하게 하는 구조적 제어.

LLM 에이전트는 복잡한 작업에서 무너진다. 단계를 건너뛰고, 출력을 날조하고, 컨텍스트가 길어지면 원래 해야 할 일을 잊어버린다. 더 큰 모델을 투입하면 비용만 올라간다 — 성공 보장도 없이. 근본 원인: **LLM에는 최신성 편향(recency bias)이 있다.** 긴 컨텍스트에서 원래 지시를 잊고 흘러간다.

현재의 AI 안전성 접근법은 **대시보드에 붙인 스티커** 수준이다 — "조심해라", "실수하지 마라" 같은 프롬프트 레벨 경고. llm-rail은 다른 접근을 취한다: **구조적 안전성**. 모델에게 착하게 굴라고 부탁하는 대신, 나쁜 일이 *발생할 수 없는* 실행 구조를 만든다.

**llm-rail**은 세 겹의 레일로 이걸 해결한다:

| 레일 | 제어 대상 |
|---|---|
| **워크플로우 레일** | 작업을 검증 가능한 스텝으로 분해. 각 스텝은 좁은 컨텍스트에서 실행 — Opus 대신 Haiku로 충분할 만큼. |
| **정책 레일** | 모든 쉘 명령이 IAM 스타일 allow/deny 규칙이 적용되는 bash 프록시를 거침. 명시적으로 허가된 것만 실행 가능. |
| **감사 레일** | 모든 액션, 명령, 검증 — 기록. 인스턴스별 완전한 추적성. |

이것은 **LLM 시대의 Convention over Configuration**이다. Rails가 MVC로 "웹 앱을 만드는 법"을 정의했듯이, llm-rail은 워크플로우 분해 + 실행 제어 + 감사 추적으로 "AI 에이전트를 돌리는 법"을 정의한다. Opus가 워크플로우를 설계하고, Haiku가 그 위에서 달린다.

AI 에이전트가 복잡한 코드 리뷰에 실패했다면? 검증 가능한 3개 스텝으로 나눠서 각각 Haiku로 실행하라. 총 비용 $2 → $0.08. 모든 출력 검증됨. 전체 감사 로그.

---

## 왜 레일인가

LLM에는 **최신성 편향(recency bias)**이 있다 — 컨텍스트가 길어질수록 원래 지시를 잊어버린다. 이게 복잡한 에이전틱 작업의 근본적인 실패 패턴이다.

LangChain이나 CrewAI 같은 기존 프레임워크는 오케스트레이션을 다루지만, 프레임워크 레벨의 **실행 제어와 감사 추적**은 없다. 에이전트에게 *무엇을* 하라고는 알려주지만, *얼마나 할 수 있는지*는 제어하지 않는다. llm-rail이 이 공백을 채운다.

llm-rail은 recency 문제를 **각 스텝의 컨텍스트를 작고 집중적으로 유지**해서 해결한다:

- 각 스텝은 `context_in`으로 필요한 데이터만 받는 깨끗한 에이전트
- 이전 스텝에서 누적된 컨텍스트 오염 없음
- 에이전트가 똑똑할 필요 없다 — 좁은 지시를 정확히 따르기만 하면 된다

이게 **Haiku가 Opus를 대체할 수 있는** 이유다. 모델 능력의 문제가 아니라 범위의 문제. 작은 컨텍스트의 작은 모델이 큰 컨텍스트에 빠진 큰 모델보다 낫다.

엔터프라이즈에게 이건 두 가지 핵심 질문에 답한다: **"통제할 수 있는가?"** — 정책 레일로 가능. **"문제를 추적할 수 있는가?"** — 감사 레일로 가능. 둘 다 프롬프트 레벨의 약속이 아니라 아키텍처 레벨에서 답한다.

---

## 작동 방식

### 스텝 타입

llm-rail은 하나의 워크플로우에서 두 가지 스텝 타입을 지원한다:

```yaml
steps:
  # Programmatic: LLM 불필요. CLI가 직접 실행.
  - id: fetch-data
    type: programmatic
    actions:
      - run: "curl -s {{api_url}}/data"
        extract: { records: "data", count: "total" }

  # Agentic: LLM 에이전트가 작업. 출력 검증됨.
  - id: analyze
    description: "{{count}}개 레코드의 이상 징후 분석"
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

  # Programmatic: LLM 없이 후처리
  - id: notify
    type: programmatic
    depends_on: analyze
    actions:
      - run: "curl -X POST {{webhook}} -d '{\"score\": {{risk_score}}}'"
```

**Programmatic 스텝**은 밀리초 단위로 실행, 토큰 비용 0. **Agentic 스텝**은 집중적이고 검증된 범위를 받아 Haiku가 안정적으로 처리.

### 정책 시스템

에이전트가 실행할 수 있는 것을 제어 — AWS IAM 영감:

```yaml
policy:
  mode: enforce
  rules:
    - effect: allow
      commands: ["curl *", "jq *", "node *"]
    - effect: deny
      commands: ["rm *", "sudo *"]
```

- **Trail 모드**: 전부 허용, 전부 기록. 개발 및 정책 발견용.
- **Enforce 모드**: deny-first 규칙 평가. 프로덕션용.
- **정책 생성**: trail 로그에서 최소 allow-list 자동 생성.

모든 명령은 bash 프록시(`llm-rail <id> bash "<cmd>"`)를 거치며, 정책을 적용하고 모든 실행을 기록한다.

### 검증 게이트

21개 내장 연산자가 각 스텝의 출력을 검사한 후 다음으로 진행:

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
    message: 모든 코멘트에 파일 참조가 있어야 함
```

불량 출력은 리젝트되고 다음으로 넘어가지 않는다. 에이전트가 에러 메시지를 받고 재시도 — 사람 개입 불필요.

### 감사 추적

모든 이벤트가 인스턴스별로 기록:

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
| **스텝 타입** | `programmatic` (LLM 없이 직접 실행)과 `agentic` (LLM 에이전트 + 검증)을 하나의 워크플로우에서. |
| **액션** | 템플릿 보간과 JSON 추출이 가능한 쉘 명령. 순차 실행으로 컨텍스트 누적. |
| **정책** | AWS IAM 스타일 allow/deny 규칙. trail과 enforce 모드. 모든 에이전트 명령에 bash 프록시. |
| **검증 게이트** | 21개 내장 연산자. 구조적 검증 + 비즈니스 로직 어서션, 커스텀 에러 메시지. |
| **명시적 데이터 플로우** | `context_in`으로 필요한 데이터만 전달 — 암묵적 병합 없음, 컨텍스트 오염 없음. |
| **라이프사이클 훅** | 모든 단계에서 gate/event 훅 (`step:before_start`, `step:completed`, `policy:denied` 등). |
| **감사 로그** | 모든 이벤트를 JSONL로 기록. 인스턴스별 audit + policy 로그로 완전한 추적성. |
| **Claude Code 플러그인** | 내장 스킬 & 에이전트 — 에디터를 떠나지 않고 워크플로우 설계, 실행, 감사. |

---

## 시작하기

### 설치

```bash
npm install llm-rail
```

### Claude Code 플러그인으로

```bash
claude install llm-rail
```

프로젝트에서 `/llm-rail:init`을 실행하면 워크플로우 세팅과 `CLAUDE.md` 등록이 완료된다.

### 사용법

```bash
# 워크플로우 인스턴스 생성
llm-rail create code-review --param target=src/

# start → 검증 → 다음 스텝, 반복
llm-rail 0321-143022 start
llm-rail 0321-143022 next --result '{"file_list":["src/main.ts"],"complexity_score":5}'

# 정책이 적용되는 bash 프록시로 명령 실행
llm-rail 0321-143022 bash 'git diff --stat'

# 진행 상황 확인
llm-rail 0321-143022 status

# 정책 관리
llm-rail policy check code-review --command 'curl https://api.example.com'
llm-rail policy generate 0321-143022 --workflow code-review
```

---

## Claude Code 플러그인

Claude Code 플러그인으로 설치하면 CLI를 직접 다룰 필요가 없다.

| 스킬 | 설명 |
|---|---|
| `/llm-rail:init` | 프로젝트에 llm-rail 세팅 |
| `/llm-rail:design` | 자연어로 작업 설명 → 검증 가능한 YAML 워크플로우 생성 |
| `/llm-rail:run` | 엔드투엔드 실행 — 단일 Haiku 에이전트가 전체 스텝을 순차 실행 |
| `/llm-rail:audit` | 기존 워크플로우의 품질 개선 분석 |
| `/llm-rail:status` | 실행 중인 워크플로우 상태 확인 |

### `/llm-rail:run` 실행 시

```
오케스트레이터 (메인 에이전트)
  │
  ├── 워크플로우 검증 → 인스턴스 생성
  │
  └── 인스턴스 전체에 Haiku 에이전트 1개 spawn
        │
        ├── start → [programmatic 스텝 자동 실행] → agentic 스텝 프롬프트
        ├── 작업 → next → [programmatic 스텝 자동 실행] → agentic 스텝 프롬프트
        ├── 작업 → next → ...
        │
        └── 워크플로우 완료. 모든 스텝 검증됨. 전체 감사 로그.
```

하나의 에이전트, 하나의 인스턴스, 처음부터 끝까지. 각 스텝은 좁고 검증된 범위. 최소 컨텍스트, 최소 비용.

---

<p align="center">
  <strong>안전한 AI = 모델에게 착하게 굴라고 부탁하는 게 아니라, 나쁜 일이 발생할 수 없는 구조를 만드는 것.</strong>
  <br>
  레일을 정의하라. 저렴한 모델을 그 위에서 달리게 하라 — 빠르고, 안전하고, 투명하게.
</p>
