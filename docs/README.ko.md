<p align="center">
  <img src="https://img.shields.io/npm/v/llm-rail?style=flat-square&color=blue" alt="npm" />
  <img src="https://img.shields.io/badge/Claude_Code-plugin-blueviolet?style=flat-square" alt="Claude Code plugin" />
  <img src="https://img.shields.io/badge/license-private-lightgrey?style=flat-square" alt="license" />
</p>

<p align="center">
  <strong>LLM 에이전트를 위한 결정론적 워크플로우 제어.</strong>
</p>

<p align="center">
  <a href="#시작하기">시작하기</a> ·
  <a href="#작동-방식">작동 방식</a> ·
  <a href="#claude-code-플러그인">플러그인</a> ·
  <a href="./CONTRIBUTING.ko.md">기여 가이드</a>
</p>

<p align="center">
  <a href="../README.md">English</a> ·
  <strong>한국어</strong> ·
  <a href="./README.ja.md">日本語</a>
</p>

---

<br>

LLM 에이전트는 복잡한 작업에서 무너진다. 단계를 건너뛰고, 출력을 날조하며, 더 큰 모델을 투입할수록 비용만 올라간다 — 성공 보장도 없이.

**llm-rail**은 복잡한 작업을 작고 검증 가능한 스텝으로 분해한다. 각 스텝은 빠르고 저렴한 모델이 안정적으로 처리할 수 있을 만큼 단순하다.

<br>

<div align="center">

```
 ┌──────────────────┐          ┌──────────────────┐          ┌──────────────────┐
 │  복잡한 태스크     │          │  YAML 워크플로우   │          │  스텝별 실행       │
 │  Opus에서 실패     │  ─────▶ │  검증 게이트 포함   │  ─────▶ │  Haiku로 실행     │
 │  $$$  불안정       │          │                    │          │  ¢    안정적      │
 └──────────────────┘          └──────────────────┘          └──────────────────┘
```

</div>

<br>

| | |
|---|---|
| **문제** | LLM 에이전트에게 멀티스텝 코드 리뷰를 시켰다. 보안 분석을 건너뛰고, 복잡도 점수를 날조하고, 토큰비 $2를 청구했다. |
| **해결** | 리뷰를 검증 가능한 3개 스텝으로 정의한다. 각 스텝은 반드시 생성해야 할 출력을 선언한다. 검증 게이트가 출력을 확인한 후에야 다음 스텝으로 진행한다. 실패하면 재시도 — 쓰레기를 넘기지 않는다. |
| **결과** | 각 스텝은 Haiku로 충분하다. 총 비용: $0.08. 모든 출력 검증 완료. 전체 감사 추적. |

<br>

## 작동 방식

워크플로우를 YAML로 정의한다. 각 스텝은 필수 출력과 검증 규칙을 선언한다.

```yaml
steps:
  - id: analyze
    description: "{{target}} 코드베이스 분석"
    required_output: [file_list, complexity_score]
    validation:
      - field: file_list
        op: type
        value: array
      - field: complexity_score
        op: between
        value: [1, 10]

  - id: review
    depends_on: analyze
    context_in:
      files: "{analyze.file_list}"
    required_output: [comments, severity_counts]
    assertions:
      - field: comments
        op: each_has
        value: file
        message: 모든 코멘트에 파일 경로가 있어야 함
```

에이전트가 스텝별로 실행한다. 각 게이트에서 llm-rail이 규칙에 따라 출력을 검증한다. **불량 출력은 리젝트되고, 다음으로 넘어가지 않는다.**

<br>

> **21개 내장 검증 연산자** — 타입 체크, 범위 제약, 정규표현식 매칭, 배열 요소 어서션 등. 구조적 검증과 비즈니스 로직 어서션이 분리되며, 각각 커스텀 에러 메시지를 지원한다.

<br>

## 시작하기

```bash
npm install llm-rail
```

```bash
# 워크플로우 인스턴스 생성
llm-rail create code-review --param target=src/

# start → 검증 → 다음 스텝, 반복
llm-rail 0321-143022 start
llm-rail 0321-143022 next --result '{"file_list":["src/main.ts"],"complexity_score":5}'

# 진행 상황 확인
llm-rail 0321-143022 status
```

<br>

## Claude Code 플러그인

Claude Code 플러그인으로 설치하면 CLI를 직접 다룰 필요가 없다.

```bash
claude install llm-rail
```

| 스킬 | 설명 |
|---|---|
| `/llm-rail:init` | 프로젝트에 llm-rail 세팅 |
| `/llm-rail:design` | 자연어로 작업 설명 → 검증 가능한 YAML 워크플로우 생성 |
| `/llm-rail:run` | 엔드투엔드 실행 — 각 스텝을 Haiku에게 자동 위임 |
| `/llm-rail:audit` | 기존 워크플로우의 품질 개선 분석 |
| `/llm-rail:status` | 실행 중인 워크플로우 상태 확인 |

### `/llm-rail:run` 실행 시

```
오케스트레이터 (메인 에이전트)
  │
  ├── 워크플로우 검증 → 인스턴스 생성
  │
  ├── Step 1 → haiku 에이전트 spawn → start → 작업 → next ✓
  ├── Step 2 → haiku 에이전트 spawn → start → 작업 → next ✓
  ├── Step 3 → haiku 에이전트 spawn → start → 작업 → next ✓
  │
  └── 완료. 모든 스텝 검증됨. 전체 감사 로그.
```

각 step-runner 에이전트는 **start** (작업 읽기)와 **next** (결과 제출) 두 커맨드만 안다. 최소 컨텍스트, 최소 비용.

<br>

---

<p align="center">
  <strong>비싼 모델로 복잡한 작업을 실패시키는 걸 멈춰라.</strong>
  <br>
  스텝을 정의하고. 출력을 검증하고. 저렴한 모델에게 위임하라.
</p>
