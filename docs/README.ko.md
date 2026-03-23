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
  <a href="#어떻게-보호하는가">어떻게 보호하는가</a> ·
  <a href="#워크플로우-엔진">워크플로우 엔진</a> ·
  <a href="#보안-아키텍처">보안 아키텍처</a> ·
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

조심하라고 말했습니다. 에이전트는 무시했습니다 — 컨텍스트가 길어지면 LLM이 원래 그렇습니다. 프롬프트 수준의 안전성은 제안일 뿐입니다. 에이전트는 제안을 따르지 않습니다.

**LLM Rail은 안전성을 구조적으로 강제합니다.** 프롬프트가 아니라, 모든 명령이 실행되기 전에 가로채는 훅, 실행되어서는 안 되는 것을 차단하는 정책, 그리고 실행된 모든 것을 기록하는 감사 로그로.

두 가지 레벨에서 작동합니다:

- **즉시 보호** — 플러그인을 설치하면 모든 Claude Code 세션이 보호됩니다. 위험한 명령이 차단되고, 시크릿이 리댁트되고, 모든 것이 기록됩니다.
- **워크플로우 제어** — 복잡한 작업을 위해 각 스텝이 필요한 컨텍스트만 받고, 자체 정책 하에 실행되며, 검증을 통과해야 다음으로 진행하는 검증된 스텝으로 분해합니다.

두 레벨은 같은 정책 엔진, 같은 감사 인프라, 같은 보안 모델을 공유합니다. 일상적으로 설정한 가드레일이 워크플로우도 보호합니다.

```bash
# 설정 끝.
/plugin marketplace add neuradex/llm-rail
/plugin install llm-rail@llm-rail
```

---

## 설치하고 잊기

다음 Claude Code 세션에서 `lrail.yml`이 합리적인 기본값으로 자동 생성됩니다. 이 파일 하나가 모든 것을 처리합니다:

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

홈 디렉토리에 두면 하위 모든 프로젝트에 적용됩니다. 특정 프로젝트에 두면 그 디렉토리 트리에서 글로벌 설정을 오버라이드합니다. cwd에서 상위로 올라가며 가장 가까운 `lrail.yml`이 적용됩니다 — `.gitignore`와 같은 방식입니다.

**파일 하나. 설정 제로. 매 세션 보호.**

---

## 어떻게 보호하는가

### 정책: 에이전트가 할 수 있는 것을 제어

에이전트가 실행하는 모든 Bash 명령은 PreToolUse 훅에 의해 가로채져 정책 규칙에 대해 검사된 후 실행됩니다. 거부된 명령은 절대 실행되지 않습니다.

간단한 규칙에는 글로브 패턴을 사용합니다. 플래그 순서 변경, 절대 경로 트릭, 서브커맨드 변형을 잡아야 할 때는 정규표현식을 사용합니다:

```yaml
rules:
  - effect: deny
    commands:
      - "sudo *"                                    # 글로브 — sudo 차단
      - regex: "rm\\s+(-\\w*r\\w*\\s+)*-\\w*f"     # 정규표현식 — rm -rf, rm -r -f, rm -fr 등을 포착
      - regex: "git\\s+push\\s+.*(--force|\\s-f)"   # 정규표현식 — 모든 force-push 변형을 포착
```

`rm -rf`가 차단된 것을 아는 에이전트가 `rm -r -f`나 `/bin/rm -rf`를 시도할 수 있습니다. 글로브 패턴은 이걸 놓칩니다. 정규표현식은 놓치지 않습니다.

### 시크릿: 보지 않고 사용하기

에이전트는 외부 서비스를 호출하기 위해 API 키가 필요합니다. 하지만 실제 값을 보거나 출력에 노출해서는 안 됩니다.

```yaml
env:
  secret_files: [.env, .env.local]
```

이 한 줄이 세 가지를 처리합니다:

1. **주입** — `.env` 파일의 시크릿 값이 에이전트의 서브프로세스 환경에 주입됩니다
2. **리댁트** — 시크릿 값이 포함된 모든 출력은 에이전트가 보기 전에 `[REDACTED]`로 대체됩니다
3. **차단** — Read, Grep 훅이 에이전트의 `.env` 파일 직접 접근을 차단합니다

에이전트가 `curl -H "Authorization: Bearer $API_KEY" ...`를 작성하면 정상 작동합니다. 하지만 `$API_KEY`가 실제로 무엇인지는 절대 알 수 없습니다.

### 감사: 모든 것이 기록됩니다

훅, 프록시, CLI — 모든 소스의 모든 명령이 타임스탬프, 소스 태그, 정책 판정과 함께 하나의 커맨드 로그에 기록됩니다:

```bash
lrail log              # 최근 명령
lrail log -n 50        # 최근 50개
lrail log -f           # 실시간 팔로우
lrail log --raw        # 머신 판독 가능한 TSV
```

거부된 명령도 기록됩니다. 에이전트가 무엇을 시도했고 무엇이 차단됐는지 정확히 확인할 수 있습니다.

### 자체 보호: 에이전트가 규칙을 바꿀 수 없습니다

`visible: false`(기본값)는 에이전트가 어떤 도구로도 `lrail.yml`을 읽을 수 없다는 것을 의미합니다 — Read, Edit, Write, Grep, Bash 전부. 어떤 규칙이 있는지 모르기 때문에 게임할 수 없습니다.

에이전트가 규칙을 보고 행동을 적응할 수 있게 하려면("이건 거부되겠구나, 다른 방법을 시도하자") `visible: true`로 설정하세요. 이것은 의도적인 선택이지, 기본값이 아닙니다.

---

## 워크플로우 엔진

가드레일은 나쁜 행동을 막습니다. 하지만 복잡한 작업이 실패하는 이유는 다릅니다: LLM에는 **최신성 편향(recency bias)** 이 있습니다. 컨텍스트가 길어질수록 원래 지시를 더 많이 잊어버립니다. 200스텝 작업에서 에이전트는 필연적으로 스텝을 건너뛰고, 데이터를 날조하고, 계획에서 벗어납니다.

워크플로우 엔진은 작업을 **각 스텝이 필요한 데이터만 받는 깨끗하고 좁은 컨텍스트를 가진 스텝**으로 분해하여 이 문제를 해결합니다. 10K 토큰의 집중된 입력을 받는 스텝은 100K 토큰의 누적된 이력에 파묻힌 에이전트보다 더 나은 출력을 생산합니다.

이것은 직접적인 비용 효과로 이어집니다: 컨텍스트가 충분히 좁으면 **Haiku가 Opus와 같은 품질**을 비용의 일부로 생산합니다. 모델이 똑똑할 필요가 없습니다 — 집중하면 됩니다. LLM Rail은 집중을 구조적으로 만듭니다.

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

`fetch-diff`는 셸 명령으로 실행됩니다 — LLM 없음, 토큰 없음, 밀리초. `review`는 `context_in`을 통해 필요한 diff만 정확히 받고, `required_output`에 선언된 출력만 생산하며, `validation`을 통과해야 워크플로우가 진행됩니다.

### 두 가지 스텝 타입, 하나의 워크플로우

| | Programmatic | Agentic |
|---|---|---|
| 실행 | CLI가 직접 실행 | LLM 에이전트가 작업 |
| 비용 | 토큰 제로 | 최소 (범위가 좁음) |
| 속도 | 밀리초 | 초 |
| 사용 시점 | 결정적 작업 (가져오기, 필터링, 전송) | 판단이 필요한 작업 (분석, 리뷰, 작성) |

혼합하는 것이 핵심입니다. 데이터를 programmatic으로 가져오고, 에이전트로 분석하고, 결과를 programmatic으로 전송합니다. 결정적 부분은 LLM이 관여하지 않기 때문에 환각이 불가능합니다.

### 검증 게이트

각 스텝의 출력은 두 단계의 검사를 거칩니다:

- **validation** — 스텝이 완료되기 전에 실행됩니다. 잘못된 출력을 즉시 거부합니다. 에이전트는 에러 메시지를 받고 재시도합니다.
- **assertions** — 스텝이 완료된 후(후속 액션 포함) 실행됩니다. 실패 시 스텝을 되돌립니다. 에이전트가 자동으로 재시도합니다.

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
    op: verify_source          # URL을 가져와 데이터가 실제로 존재하는지 확인
    value: { field: "snippet", sample_size: 3 }
```

22개 내장 연산자가 타입 검사, 범위, 배열 검증, 유일성, 날조 방지(`verify_source`는 URL을 가져와 인용된 데이터가 실제 페이지에 존재하는지 확인)를 지원합니다. 커스텀 검증은 `script` 연산자로 셸 명령을 검증 게이트로 실행할 수 있습니다.

### 워크플로우별 정책

`lrail.yml`의 프로젝트 수준 정책은 전체를 글로벌하게 보호합니다. 워크플로우는 그 위에 추가 제한을 올릴 수 있습니다:

```yaml
policy:
  mode: enforce
  rules:
    - effect: allow
      commands: ["curl -s https://api.example.com/*", "jq *"]
    - effect: deny
      commands: ["curl *", "rm *"]
```

코드 리뷰 워크플로우는 `git diff`와 `jq`를 허용할 수 있습니다. 데이터 수집 워크플로우는 특정 API 엔드포인트를 허용할 수 있습니다. 각 워크플로우는 필요한 권한만 정확히 받습니다.

### 라이프사이클과 배리언트

워크플로우는 단계를 거쳐 성숙합니다: `draft` → `dev` → `stable`. draft에서는 자유롭게 실험합니다. dev에서는 검증을 강화하고 agentic 스텝을 가능한 한 programmatic으로 전환합니다. stable에서는 정책이 enforce 모드여야 합니다.

여러 설계 방식이 배리언트로 공존할 수 있습니다 — 다른 스텝 구조, 다른 모델, 다른 데이터 소스 — 그리고 우수한 배리언트를 베이스에 병합합니다:

```bash
lrail wf code-review variants           # 배리언트 목록
lrail wf code-review merge api-driven   # 우수 배리언트 병합
lrail wf code-review promote            # 다음 단계 준비 여부 확인
```

### 완전한 감사 추적

모든 워크플로우 인스턴스가 전체 이력을 기록합니다:

```
.llm-rail/{workflow}/{instance}/
  ├── state.yaml      # 현재 인스턴스 상태
  ├── audit.jsonl      # 전체 라이프사이클 이벤트 (스텝 시작, 완료, 거부, 리셋)
  └── proxy.jsonl     # 전체 명령 실행과 정책 판정
```

글로벌 `lrail log`와 합치면 완전한 그림이 나옵니다: 에이전트가 무엇을 했는지, 무엇이 허용됐는지, 무엇이 차단됐는지, 그리고 왜.

---

## 보안 아키텍처

LLM Rail의 모든 보호 기능 — 정책, 시크릿, 감사, 자체 보호 — 은 스탠드얼론 사용과 워크플로우 실행 모두를 포괄하는 하나의 아키텍처로 수렴합니다:

```
┌─ 프로젝트 정책 (lrail.yml) ─────────────────────────────┐
│                                                           │
│  메인 에이전트 (훅)              서브에이전트 (프록시)     │
│  ┌──────────────────┐          ┌──────────────────┐      │
│  │ PreToolUse 훅     │          │ lrail <id> bash   │      │
│  │ → 정책 평가       │          │ → 프로젝트 정책   │      │
│  │ → 시크릿 리댁트   │          │ → 워크플로우 정책  │      │
│  │ → 커맨드 로그     │          │ → 시크릿 리댁트   │      │
│  └──────────────────┘          │ → 커맨드 로그     │      │
│                                 └──────────────────┘      │
└───────────────────────────────────────────────────────────┘
```

| 레이어 | 강제하는 것 | 방법 |
|---|---|---|
| **Bash 훅** | 어떤 명령이 실행 가능한지 | PreToolUse가 모든 Bash 호출을 가로채 정책 평가 후 exit 2로 차단 |
| **파일 훅** | 어떤 파일에 접근 가능한지 | Read/Grep 훅이 시크릿 파일 차단; 가드 훅이 `lrail.yml` 차단 |
| **설정 가시성** | 에이전트가 규칙을 아는지 | `visible: false`가 모든 도구에서 설정 숨김 |
| **Bash 프록시** | 워크플로우별 권한 | `lrail <id> bash`가 프로젝트 정책 위에 워크플로우 정책 추가 |
| **시크릿 중재** | 자격증명 노출 | 서브프로세스 env에 주입, 모든 출력에서 리댁트 |
| **감사 로그** | 책임 추적 | 모든 명령, 모든 판정, 모든 소스 — 기록 |

훅 프로토콜은 **exit 2**(차단 에러)를 사용합니다. Claude Code 허용 목록을 오버라이드하며, `bypassPermissions`를 포함한 모든 권한 모드에서 작동합니다. 에이전트가 무시할 수 있는 제안이 아닙니다 — 구조적 게이트입니다.

### 커스텀 에이전트를 위한 구조적 강제

최대 격리를 위해 에이전트의 도구를 `allowed-tools`로 `Bash(lrail *)`에 제한하세요. 에이전트는 프록시를 통해서만 명령을 실행할 수 있습니다 — 직접 셸 접근 불가. 정책 강제가 어려운 것이 아니라 구조적으로 우회 불가능해집니다.

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
