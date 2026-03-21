<p align="center">
  <img src="https://img.shields.io/npm/v/lrail?style=flat-square&color=blue" alt="npm" />
  <img src="https://img.shields.io/badge/Claude_Code-plugin-blueviolet?style=flat-square" alt="Claude Code plugin" />
  <img src="https://img.shields.io/badge/license-private-lightgrey?style=flat-square" alt="license" />
</p>

<p align="center">
  <strong>エージェンティック作業のためのガードレール。</strong>
</p>

<p align="center">
  <a href="#なぜレールか">なぜレールか</a> ·
  <a href="#仕組み">仕組み</a> ·
  <a href="#はじめに">はじめに</a> ·
  <a href="#claude-codeプラグイン">プラグイン</a> ·
  <a href="./CONTRIBUTING.ja.md">コントリビューション</a>
</p>

<p align="center">
  <a href="../README.md">English</a> ·
  <a href="./README.ko.md">한국어</a> ·
  <strong>日本語</strong>
</p>

---

Ruby on Railsがウェブ開発にレールを敷いたように、**lrailはエージェンティック作業にレールを敷く。**

「レール」という言葉には二重の意味がある — どちらも意図的だ：

- **軌道としてのレール**: エージェントが走る事前定義されたワークフローステップ。高速、効率的、無駄なし。
- **ガードレールとしてのレール**: エージェントが軌道を外れないための構造的制御。

LLMエージェントは複雑なタスクで崩壊する。ステップを飛ばし、出力をでっち上げ、コンテキストが長くなると本来やるべきことを忘れる。より大きなモデルを投入してもコストだけが膨らむ — 成功の保証もなく。根本原因：**LLMにはrecency bias（最新性バイアス）がある。** 長いコンテキストでは元の指示を忘れて漂流する。

現在のAI安全性アプローチは**ダッシュボードに貼ったステッカー**レベルだ — 「注意しろ」「間違えるな」というプロンプトレベルの警告。lrailは異なるアプローチを取る：**構造的安全性**。モデルに良い子でいろと頼むのではなく、悪いことが*起こり得ない*実行構造を構築する。

**lrail**は3層のレールでこれを解決する：

| レール | 制御対象 |
|---|---|
| **ワークフローレール** | タスクを検証可能なステップに分解。各ステップは狭いコンテキストで実行 — OpusではなくHaikuで十分なほど。 |
| **ポリシーレール** | すべてのシェルコマンドがIAMスタイルのallow/denyルール付きbashプロキシを通過。明示的に許可されたことだけ実行可能。 |
| **監査レール** | すべてのアクション、コマンド、検証 — 記録。インスタンスごとの完全なトレーサビリティ。 |

これは**LLM時代のConvention over Configuration**だ。RailsがMVCで「ウェブアプリの作り方」を定義したように、lrailはワークフロー分解＋実行制御＋監査証跡で「AIエージェントの動かし方」を定義する。Opusがワークフローを設計し、Haikuがその上を走る。

AIエージェントが複雑なコードレビューに失敗した？ 検証可能な3ステップに分けてそれぞれHaikuで実行しろ。総コスト$2 → $0.08。全出力検証済み。完全な監査ログ。

---

## なぜレールか

LLMには**recency bias（最新性バイアス）**がある — コンテキストが長くなるほど元の指示を忘れる（[Peysakhovich & Lerer 2023](https://arxiv.org/abs/2310.01427)、[Liu et al. 2023](https://arxiv.org/abs/2307.03172)）。これが複雑なエージェンティックタスクの根本的な失敗パターンだ。

LangChainやCrewAIのような既存フレームワークはオーケストレーションを扱うが、フレームワークレベルの**実行制御と監査証跡**は持たない。エージェントに*何を*するかは伝えるが、*どこまでやっていいか*は制御しない。lrailがこのギャップを埋める。

lrailはrecencyの問題を**各ステップのコンテキストを小さく集中的に保つ**ことで解決する：

- 各ステップは`context_in`で必要なデータだけを受け取るクリーンなエージェント
- 前のステップからのコンテキスト汚染なし
- エージェントが賢い必要はない — 狭い指示を正確に実行するだけでいい

これが**HaikuがOpusを置き換えられる**理由だ。モデルの能力ではなくスコープの問題。小さなコンテキストの小さなモデルは、大きなコンテキストに溺れた大きなモデルに勝る。

そして進捗を管理するのはLLMではなくワークフローエンジンだから、**数百ステップのワークフローでも一つ残らず全て実行される。** 長いコンテキストのLLMエージェントは必然的にステップを飛ばす。ワークフローエンジンは決して忘れない。

エンタープライズにとって、これは3つの重要な質問に答える：**「複雑なプロセスを処理できるか？」** — エンジンが全ステップの完了を保証する。**「制御できるか？」** — ポリシーレールで可能。**「問題を追跡できるか？」** — 監査レールで可能。すべてプロンプトレベルの約束ではなく、アーキテクチャレベルで回答する。

---

## 仕組み

### ステップタイプ

lrailは単一のワークフローで2つのステップタイプをサポートする：

```yaml
steps:
  # Programmatic: LLM不要。CLIが直接実行。
  - id: fetch-data
    type: programmatic
    actions:
      - run: "curl -s {{api_url}}/data"
        extract: { records: "data", count: "total" }

  # Agentic: LLMエージェントが作業。出力は検証される。
  - id: analyze
    description: "{{count}}件のレコードの異常を分析"
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

  # Programmatic: LLMなしで後処理
  - id: notify
    type: programmatic
    depends_on: analyze
    actions:
      - run: "curl -X POST {{webhook}} -d '{\"score\": {{risk_score}}}'"
```

**Programmaticステップ**はミリ秒単位で実行、トークンコスト0。**Agenticステップ**は集中的で検証されたスコープを得て、Haikuが安定的に処理。

### ポリシーシステム

エージェントが実行できることを制御 — AWS IAMインスパイア：

```yaml
policy:
  mode: enforce
  rules:
    - effect: allow
      commands: ["curl *", "jq *", "node *"]
    - effect: deny
      commands: ["rm *", "sudo *"]
```

- **Trailモード**: すべて許可、すべて記録。開発とポリシー発見用。
- **Enforceモード**: deny-firstのルール評価。本番用。
- **ポリシー生成**: trailログから最小限のallow-listを自動生成。

すべてのコマンドはbashプロキシ（`lrail <id> bash "<cmd>"`）を経由し、ポリシーを適用しすべての実行を記録する。

### 検証ゲート

21の組み込み演算子が各ステップの出力を検査してから次へ進む：

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
    message: 全コメントにファイル参照が必須
```

不良な出力はリジェクトされ、次に進まない。エージェントがエラーメッセージを受けてリトライ — 人間の介入不要。

### 監査証跡

すべてのイベントがインスタンスごとに記録：

```
.llm-rail/{workflow}/{instance}/
  ├── state.yaml      # インスタンス状態
  ├── audit.jsonl      # 全ライフサイクルイベント
  └── policy.jsonl     # 全コマンド実行記録
```

---

## 機能一覧

| | |
|---|---|
| **ステップタイプ** | `programmatic`（LLMなしで直接実行）と`agentic`（LLMエージェント＋検証）を1つのワークフローで。 |
| **アクション** | テンプレート展開とJSON抽出を備えたシェルコマンド。順次実行でコンテキスト蓄積。 |
| **ポリシー** | AWS IAMスタイルのallow/denyルール。trailとenforceモード。全エージェントコマンドにbashプロキシ。 |
| **検証ゲート** | 21の組み込み演算子。構造バリデーション＋ビジネスロジックアサーション、カスタムエラーメッセージ。 |
| **明示的データフロー** | `context_in`で必要なデータのみ受け渡し — 暗黙のマージなし、コンテキスト汚染なし。 |
| **ライフサイクルフック** | 全段階でgate/eventフック（`step:before_start`、`step:completed`、`policy:denied`等）。 |
| **監査ログ** | 全イベントをJSONLで記録。インスタンスごとにaudit＋policyログで完全なトレーサビリティ。 |
| **Claude Codeプラグイン** | 組み込みスキル＆エージェント — エディタを離れずにワークフロー設計・実行・監査。 |

---

## はじめに

### インストール

```bash
npm install lrail
```

### Claude Codeプラグインとして

```bash
claude install lrail
```

プロジェクトで`/lrail:init`を実行すると、ワークフローのセットアップと`CLAUDE.md`への登録が完了する。

### 使い方

```bash
# ワークフローインスタンスを作成
lrail wf code-review create --param target=src/

# start → 検証 → 次のステップ、の繰り返し
lrail 0321-143022 start
lrail 0321-143022 next --result '{"file_list":["src/main.ts"],"complexity_score":5}'

# ポリシー適用済みbashプロキシでコマンド実行
lrail 0321-143022 bash 'git diff --stat'

# 進捗確認
lrail 0321-143022 status

# ポリシー管理
lrail wf code-review policy check --command 'curl https://api.example.com'
lrail 0321-143022 policy generate
```

---

## Claude Codeプラグイン

Claude Codeプラグインとしてインストールすれば、CLIを直接操作する必要がない。

| スキル | 説明 |
|---|---|
| `/lrail:init` | プロジェクトにlrailをセットアップ |
| `/lrail:design` | 自然言語でタスクを説明 → 検証可能なYAMLワークフローを生成 |
| `/lrail:run` | エンドツーエンド実行 — 単一のHaikuエージェントが全ステップを順次実行 |
| `/lrail:review` | 試行実行＋分析 — 問題検出、修正提案、ポリシー生成 |
| `/lrail:status` | 実行中のワークフローの状態を確認 |

### `/lrail:run`の実行フロー

```
オーケストレーター（メインエージェント）
  │
  ├── ワークフロー検証 → インスタンス作成
  │
  └── インスタンス全体にHaikuエージェント1つをspawn
        │
        ├── start → [programmaticステップ自動実行] → agenticステップのプロンプト
        ├── 作業 → next → [programmaticステップ自動実行] → agenticステップのプロンプト
        ├── 作業 → next → ...
        │
        └── ワークフロー完了。全ステップ検証済み。完全な監査ログ。
```

1つのエージェント、1つのインスタンス、最初から最後まで。各ステップは狭く検証されたスコープ。最小コンテキスト、最小コスト。

---

<p align="center">
  <strong>安全なAI = モデルに良い子でいろと頼むことではなく、悪いことが起こり得ない構造を作ること。</strong>
  <br>
  レールを定義せよ。安価なモデルをその上で走らせよ — 高速、安全、透明に。
</p>
