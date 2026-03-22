# 기여 가이드

> [English](./CONTRIBUTING.md) · [한국어](./CONTRIBUTING.ko.md) · [日本語](./CONTRIBUTING.ja.md)

LLM Rail에 관심을 가져주셔서 감사합니다. 이 가이드는 개발 환경 설정, 변경 사항 작성, 기여 제출 과정을 안내합니다.

## 개발 환경 설정

```bash
git clone https://github.com/neuradex/llm-rail.git
cd llm-rail
npm install
npm run build
npm test
```

실시간 리로드로 개발하기:

```bash
npm run dev -- docs              # 개발 모드로 CLI 실행
npx tsx src/cli.ts wf list       # 소스에서 직접 실행
```

## 프로젝트 구조

```
src/           # TypeScript 소스
  cli.ts       # CLI 엔트리포인트
  types.ts     # 타입 정의
  engine/      # 코어 엔진 (워크플로우, 상태, 검증, 정책, 액션)
  commands/    # CLI 커맨드 핸들러
  audit/       # 감사 로깅
learn/         # 문서 (단일 진실 원천 — `lrail docs`로 제공)
agents/        # 에이전트 정의 (역할 + lrail docs 참조)
skills/        # 스킬 정의 (행동 워크플로우 + lrail docs 참조)
builtins/      # 빌트인 메타 워크플로우
test/          # 테스트 (node:test)
```

## 레퍼런스 문서

스키마 상세, 검증 연산자, 라이프사이클 훅 등 기술 레퍼런스는 `learn/`에 있으며 `lrail docs <topic>`으로 접근합니다. 내용을 복제하지 마세요 — 항상 `lrail docs`로 참조하세요.

주요 토픽:

```bash
lrail docs concepts/step-types      # 스텝 타입 (agentic / programmatic)
lrail docs concepts/validation      # 검증 연산자
lrail docs concepts/actions         # 액션 시스템
lrail docs concepts/policy          # 정책 적용
lrail docs workflow/execution       # 실행 절차
```

## 변경 사항 작성

1. 저장소를 포크하고 기능 브랜치를 생성합니다
2. 테스트와 함께 변경 사항을 작성합니다
3. `npm test`로 검증합니다
4. `main` 브랜치에 대해 Pull Request를 제출합니다

### 문서 유지보수

소스 코드 수정 시 문서를 동기화하세요:

| 변경 영역 | 업데이트 대상 |
|---|---|
| CLI 커맨드 | `learn/workflow/execution.md`, `learn/workflow/first-run.md` |
| 검증 연산자 | `learn/concepts/validation.md` |
| 스텝 타입 동작 | `learn/concepts/step-types.md` |
| 정책 동작 | `learn/concepts/policy.md` |
| 액션 동작 | `learn/concepts/actions.md` |
| 타입 정의 | `agents/workflow-designer.md` 스키마 참조 |

**에이전트나 스킬에 개념 설명을 추가하지 마세요.** `learn/`에 작성하고 `lrail docs`로 참조하세요.

### 코드 컨벤션

- ES 모듈 기반 TypeScript (`"type": "module"`)
- `js-yaml` 외에 외부 런타임 의존성 없음
- 함수는 일반 객체를 반환 — 데이터 구조에 클래스 사용 금지
- CLI 출력은 `engine/output.ts` 포매팅 헬퍼 사용

### 테스트

Node.js 빌트인 테스트 러너(`node:test`)를 사용합니다:

```bash
npm test                           # 전체 테스트 실행
node --import tsx --test test/variant.test.ts   # 특정 테스트 실행
```

테스트는 격리를 위해 `before`/`after` 훅에서 임시 디렉토리를 생성합니다.

## 기여를 환영하는 영역

다음 영역에서 적극적으로 기여를 찾고 있습니다:

- **보안 모델** — 구조적 강제 강화, 새로운 격리 패턴 탐색
- **검증 연산자** — 일반적인 사용 사례를 위한 새로운 연산자
- **프로그래매틱 스텝 패턴** — `shell:`, `js:` 외 새로운 액션 프리미티브

## 라이선스

MIT — [LICENSE](../LICENSE) 참조
