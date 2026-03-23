<!-- AGENT NOTE: 이 파일을 수정하면 ../README.md (영어)와 docs/README.ja.md (일본어)도 함께 업데이트하세요. -->

<p align="center">
  <img src="https://img.shields.io/npm/v/llm-rail?style=flat-square&color=blue" alt="npm" />
  <img src="https://img.shields.io/badge/Claude_Code-plugin-blueviolet?style=flat-square" alt="Claude Code plugin" />
  <img src="https://img.shields.io/badge/license-MIT-green?style=flat-square" alt="license" />
</p>

<h1 align="center">LLM Rail</h1>

<p align="center">
  <strong>AI 에이전트를 위한 통합 가드레일.</strong>
  <br>
  구조적 안전성. 워크플로우 제어. 완전한 감사.
</p>

<p align="center">
  <a href="#설치하고-잊기">설치하고 잊기</a> ·
  <a href="#정책--시크릿">정책 & 시크릿</a> ·
  <a href="#워크플로우-엔진">워크플로우 엔진</a> ·
  <a href="#보안-모델">보안</a> ·
  <a href="#시작하기">시작하기</a> ·
  <a href="../CONTRIBUTING.md">기여 가이드</a>
</p>

<p align="center">
  <a href="../README.md">English</a> ·
  <strong>한국어</strong> ·
  <a href="./README.ja.md">日本語</a>
</p>

> **베타 (0.x.x)** — 활발히 개발 중입니다. API와 스키마가 변경될 수 있습니다. 안정성이 필요하다면 버전을 고정해 주세요.

---

AI 에이전트가 프로젝트에 `rm -rf`를 실행했습니다. 또는 출력에 API 키를 노출했습니다. 또는 main에 force-push를 했습니다.

프롬프트 수준의 안전성("조심해 주세요")은 작동하지 않습니다. 컨텍스트가 길어지면 에이전트는 지시를 무시합니다. **구조적 강제가 필요합니다.**

LLM Rail은 두 가지 레벨에서 작동합니다:

- **즉시 보호** — 플러그인을 설치하면 정책 강제, 시크릿 보호, 명령 감사가 자동으로 시작됩니다
- **워크플로우 제어** — 복잡한 작업을 검증된 스텝으로 분해하고, 각 스텝의 컨텍스트와 권한을 통제합니다

```bash
# 플러그인을 설치하세요. 그게 전부입니다.
/plugin marketplace add neuradex/llm-rail
/plugin install llm-rail@llm-rail
```

다음 세션부터 모든 Claude Code 명령이 보호됩니다. 설정 불필요.

---

## 설치하고 잊기

LLM Rail은 설치하는 순간 작동합니다. 다음 Claude Code 세션에서:

1. `lrail.yml`이 합리적인 기본값으로 자동 생성됩니다
2. 위험한 명령이 차단됩니다 (`rm -rf`, `sudo`, `git push --force`, ...)
3. 에이전트가 실행하는 모든 명령이 기록됩니다
4. 설정 파일 자체가 에이전트의 변조로부터 보호됩니다

**파일 하나. 설정 제로. 매 세션 보호.**

```yaml
# lrail.yml — 자동 생성, 언제든 수정 가능
visible: false          # 에이전트가 이 파일을 읽거나 수정할 수 없습니다

policy:
  mode: enforce
  default: allow        # deny-list 방식: 특정 명령만 차단
  rules:
    - effect: deny
      commands:
        - "rm -rf *"
        - "sudo *"
        - "chmod 777 *"
        - "git push --force *"
        - "git reset --hard *"
        - regex: "curl.*\\|\\s*(bash|sh)"   # 셸로 파이프
        - regex: "lrail\\.yml"              # 이 설정 보호
```

홈 디렉토리에 `lrail.yml` 하나를 두면 — 하위 모든 프로젝트에 적용됩니다.

---

## 정책 & 시크릿

### 정책 강제

간단한 규칙에는 글로브 패턴. 정밀함이 필요할 때는 정규표현식:

```yaml
rules:
  - effect: deny
    commands:
      - "sudo *"                                    # 글로브 — 간단
      - regex: "rm\\s+(-\\w*r\\w*\\s+)*-\\w*f"     # 정규표현식 — rm -r -f, rm -rf 등을 포착
      - regex: "git\\s+push\\s+.*(--force|\\s-f)"   # 정규표현식 — 모든 force-push 변형을 포착
```

에이전트가 플래그 순서를 바꾸거나 절대 경로를 사용해도 정규표현식 규칙을 우회할 수 없습니다.

### 시크릿 보호

`.env` 파일을 지정하세요. 시크릿이 자동 주입되고 자동 리댁트됩니다:

```yaml
env:
  secret_files: [.env, .env.local]
```

- 에이전트가 `curl -H "Authorization: Bearer $API_KEY" ...` 실행 — 정상 작동
- 하지만 `$API_KEY` 값은 에이전트 출력에 **절대 노출되지 않습니다** — `[REDACTED]`로 대체
- 에이전트가 `cat .env`나 시크릿 파일을 `grep`할 수 없습니다 — 훅이 차단

### 명령 감사

모든 명령이 기록됩니다. 에이전트가 실제로 무엇을 했는지 확인하세요:

```bash
lrail log              # 최근 명령
lrail log -n 50        # 최근 50개
lrail log -f           # 실시간 팔로우
lrail log --raw        # 머신 판독 가능한 TSV
```

### 설정 자체 보호

기본적으로 에이전트는 `lrail.yml`을 읽거나, 편집하거나, 쓸 수 없습니다. 자신을 제어하는 규칙을 제거할 수 없습니다.

에이전트가 설정을 읽고 적응할 수 있게 하려면 `visible: true`로 설정하세요 (예: "이 명령은 거부되겠구나, 다른 방법을 시도하자"):

```yaml
visible: true   # 에이전트가 이 설정을 보고 수정할 수 있습니다
```

---

## 워크플로우 엔진

가드레일 이상이 필요한 작업에 — 복잡한 작업을 검증된 스텝으로 분해하여 각 스텝의 컨텍스트, 권한, 출력을 제어합니다.

```yaml
name: code-review
steps:
  - id: fetch-diff
    type: programmatic
    actions:
      - shell: "git diff {{base_branch}}...HEAD"
        extract: { diff: "." }

  - id: review
    description: "diff에서 이슈를 리뷰"
    depends_on: fetch-diff
    context_in:
      diff: "{fetch-diff.diff}"
    required_output: [issues, severity]
    validation:
      - field: issues
        op: type
        value: array
      - field: severity
        op: one_of
        value: [low, medium, high, critical]
```

### 왜 중요한가

LLM에는 **최신성 편향(recency bias)** 이 있습니다 — 컨텍스트가 길어질수록 더 많이 잊어버립니다. 200스텝 작업에서 에이전트는 필연적으로 스텝을 건너뜁니다. 워크플로우 엔진은 절대 잊지 않습니다.

각 스텝은 필요한 데이터만 담은 **좁은 컨텍스트**를 받습니다. 작은 모델, 작은 컨텍스트, 정확한 출력. **Haiku가 Opus를 대체합니다.** 비용이 $2에서 $0.08로 줄어듭니다.

### 스텝 타입

| | Programmatic | Agentic |
|---|---|---|
| 실행 | CLI가 직접 실행 | LLM 에이전트가 작업 |
| 비용 | 토큰 제로 | 최소 (범위가 좁음) |
| 속도 | 밀리초 | 초 |
| 사용 시점 | 결정적 작업 | 판단이 필요한 작업 |

하나의 워크플로우에서 혼합하여 사용하세요. 데이터는 programmatic으로 가져오고, 에이전트로 분석하고, 결과는 programmatic으로 전송합니다.

### 검증 게이트

22개 내장 연산자. 두 단계:

- **validation** — 사전 완료 가드. 스텝이 완료되기 전에 잘못된 출력을 거부합니다.
- **assertions** — 사후 완료 검사. 실패 시 스텝을 되돌리고, 에이전트가 자동으로 재시도합니다.

```yaml
validation:
  - field: score
    op: between
    value: [0, 100]
  - field: sources
    op: each_has
    value: url
    message: "모든 소스에 URL이 있어야 합니다"
assertions:
  - field: sources
    op: verify_source          # URL을 가져와 데이터 존재 여부를 확인
    value: { field: "snippet", sample_size: 3 }
```

`script` 연산자로 셸 기반 커스텀 검증도 가능합니다 — 스크립트할 수 있는 모든 검사를 실행할 수 있습니다.

### 워크플로우별 정책

프로젝트 수준 정책은 전체를 보호합니다. 워크플로우 수준 정책은 작업별 제한을 추가합니다:

```yaml
policy:
  mode: enforce
  rules:
    - effect: allow
      commands: ["curl -s https://api.example.com/*", "jq *"]
    - effect: deny
      commands: ["curl *", "rm *"]
```

허용하는 특정 API 엔드포인트만 접근 가능. 나머지는 모두 거부.

### 라이프사이클 & 배리언트

워크플로우는 단계를 거쳐 성숙합니다: `draft` → `dev` → `stable`

여러 설계 방식이 배리언트로 공존하고, 비교 후 우수한 배리언트를 베이스에 병합합니다:

```bash
lrail wf code-review variants           # 배리언트 목록
lrail wf code-review merge api-driven   # 우수 배리언트 병합
lrail wf code-review promote            # 다음 단계 준비 여부 확인
```

### 감사 추적

모든 이벤트가 인스턴스별로 기록됩니다:

```
.llm-rail/{workflow}/{instance}/
  ├── state.yaml      # 인스턴스 상태
  ├── audit.jsonl      # 전체 라이프사이클 이벤트
  └── proxy.jsonl     # 전체 명령 실행 + 정책 판정
```

---

## 보안 모델

LLM Rail은 **구조적으로** 안전성을 강제합니다 — 프롬프트가 아닙니다.

```
┌─ 프로젝트 정책 (lrail.yml) ─────────────────────────────┐
│                                                           │
│  메인 에이전트 (훅)              서브에이전트 (프록시)     │
│  ┌──────────────────┐          ┌──────────────────┐      │
│  │ PreToolUse 훅     │          │ lrail <id> bash   │      │
│  │ → 정책 평가       │          │ → 프로젝트 정책   │      │
│  │ → 커맨드 로그     │          │ → 워크플로우 정책  │      │
│  └──────────────────┘          │ → 커맨드 로그     │      │
│                                 └──────────────────┘      │
└───────────────────────────────────────────────────────────┘
```

| 레이어 | 강제 방식 |
|---|---|
| **Bash** | PreToolUse 훅이 모든 명령을 정책에 대해 검사 |
| **Read/Edit/Write** | 훅이 시크릿 파일과 `lrail.yml`을 보호 |
| **Config** | `visible: false`가 에이전트의 규칙 열람을 차단 |
| **Bash (프록시)** | `lrail <id> bash`가 워크플로우 수준 정책을 추가 |
| **시크릿** | 자동 주입, 자동 리댁트, 파일 접근 차단 |

훅 프로토콜은 **exit 2**(차단 에러)를 사용합니다 — Claude Code 허용 목록을 오버라이드하며, `bypassPermissions`를 포함한 모든 권한 모드에서 작동합니다.

### 커스텀 에이전트를 위한 구조적 강제

에이전트를 `Bash(lrail *)`의 `allowed-tools`로 제한하세요. 프록시를 통해서만 실행할 수 있습니다 — 직접 셸 접근 불가. 정책이 구조적으로 우회 불가능해집니다.

---

## 시작하기

### Claude Code 플러그인 (권장)

```bash
/plugin marketplace add neuradex/llm-rail
/plugin install llm-rail@llm-rail
```

새 세션을 시작하세요. 보호가 적용됩니다.

### CLI 도구로

```bash
npm install llm-rail
lrail init
```

### CLI 레퍼런스

```bash
# 가드레일
lrail init                                            # 초기화 (플러그인 설치 시 자동)
lrail policy eval --command '<cmd>'                   # 정책에 대해 명령 테스트
lrail log [-n <count>] [-f] [--raw]                   # 명령 이력
lrail bash '<command>'                                # 글로벌 프록시를 통해 실행

# 워크플로우 관리
lrail wf list                                         # 워크플로우 목록
lrail wf <name> create [--variant <v>] [--param k=v]  # 인스턴스 생성
lrail wf <name> validate [--variant <v>]              # YAML 검증
lrail wf <name> promote                               # 승격 준비 여부 확인

# 인스턴스 실행
lrail <id> start                                      # 실행 시작
lrail <id> next --result '<json>'                     # 스텝 결과 제출
lrail <id> status                                     # 진행 상황 확인
lrail <id> bash '<command>'                           # 프록시를 통해 실행
lrail <id> policy generate                            # trail에서 정책 생성
```

---

## Claude Code 플러그인

| 스킬 | 설명 |
|---|---|
| `/llm-rail:design` | 작업을 설명하면 → 검증된 워크플로우 생성 |
| `/llm-rail:build` | 워크플로우를 자동으로 생성, 최적화, 테스트 |
| `/llm-rail:run` | 워크플로우를 처음부터 끝까지 실행 |
| `/llm-rail:review` | 시험 실행 + 분석 — 문제 감지, 수정 제안 |
| `/llm-rail:optimize` | 7단계 최적화 파이프라인으로 배리언트 출력 |

프레임워크가 자체 워크플로우를 만들고 개선합니다 — 셀프 호스팅입니다.

---

<p align="center">
  <strong>프롬프트 수준의 안전성은 대시보드에 붙인 스티커입니다. 구조적 안전성은 안전벨트입니다.</strong>
  <br>
  LLM Rail은 안전벨트를 만듭니다.
</p>
