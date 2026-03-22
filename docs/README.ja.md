<p align="center">
  <img src="https://img.shields.io/npm/v/llm-rail?style=flat-square&color=blue" alt="npm" />
  <img src="https://img.shields.io/badge/Claude_Code-plugin-blueviolet?style=flat-square" alt="Claude Code plugin" />
  <img src="https://img.shields.io/badge/license-MIT-green?style=flat-square" alt="license" />
</p>

<p align="center">
  <strong>エージェント作業のためのガードレール。</strong>
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

Ruby on Railsがウェブ開発にレールを敷いたように、**LLM Railはエージェント作業にレールを敷きます。**

「レール」という言葉には二つの意味が込められています。どちらも意図的です：

- **軌道としてのレール**: エージェントが走るための、事前に定義されたワークフローステップです。高速で、効率的で、無駄がありません。
- **ガードレールとしてのレール**: エージェントが軌道を外れないようにする構造的な制御です。

LLMエージェントは複雑なタスクで崩壊します。ステップを飛ばし、出力をでっち上げ、コンテキストが長くなると本来やるべきことを忘れてしまいます。より大きなモデルを投入してもコストが増えるだけで、成功は保証されません。根本原因は**LLMの最新性バイアス（recency bias）**です。長いコンテキストでは、元の指示を忘れて漂流してしまいます。

現在のAI安全性へのアプローチは**ダッシュボードに貼ったステッカー**のようなものです — 「注意して」「間違えないで」というプロンプトレベルの警告にすぎません。LLM Railは異なるアプローチを取ります：**構造的安全性**です。モデルに良い振る舞いをお願いするのではなく、悪いことが*起こり得ない*実行構造を構築します。

**LLM Rail**は3層のレールでこの問題を解決します：

| レール | 制御対象 |
|---|---|
| **ワークフローレール** | タスクを検証可能なステップに分解します。各ステップは狭いコンテキストで実行されるため、OpusではなくHaikuで十分です。 |
| **ポリシーレール** | すべてのシェルコマンドが、IAMスタイルのallow/denyルール付きbashプロキシを通過します。明示的に許可されたことだけが実行可能です。 |
| **監査レール** | すべてのアクション、コマンド、検証が記録されます。インスタンスごとに完全なトレーサビリティを提供します。 |

**LLM時代のConvention over Configuration**とお考えください。RailsがMVCで「ウェブアプリの作り方」を定義したように、LLM Railはワークフロー分解＋実行制御＋監査証跡で「AIエージェントの運用方法」を定義します。Opusがワークフローを設計し、Haikuがその上を走ります。

AIエージェントが複雑なコードレビューに失敗しましたか？ 検証可能な3ステップに分割して、それぞれHaikuで実行してみてください。総コストは$2から$0.08に下がります。すべての出力が検証され、完全な監査ログが残ります。

---

## なぜレールか

LLMには**最新性バイアス（recency bias）**があります — コンテキストが長くなるほど、元の指示をより多く忘れてしまいます（[Peysakhovich & Lerer 2023](https://arxiv.org/abs/2310.01427)、[Liu et al. 2023](https://arxiv.org/abs/2307.03172)）。これが複雑なエージェントタスクの根本的な失敗パターンです。

LangChainやCrewAIのような既存フレームワークはオーケストレーションを扱いますが、フレームワークレベルの**実行制御と監査証跡**は持っていません。エージェントに*何を*するかは伝えますが、*どこまでやっていいか*は制御しません。LLM Railがこのギャップを埋めます。

LLM Railは**各ステップのコンテキストを小さく集中的に保つ**ことで、最新性バイアスの問題を解決します：

- 各ステップは`context_in`で必要なデータだけを受け取る、クリーンなエージェントを使用します
- 前のステップからのコンテキスト汚染がありません
- エージェントが賢い必要はありません — 狭い指示を正確に実行するだけで十分です

これが**HaikuがOpusを代替できる**理由です。モデルの能力ではなく、スコープの問題です。小さなコンテキストの小さなモデルは、大きなコンテキストに埋もれた大きなモデルに勝ります。

そして、進捗を管理するのはLLMではなくワークフローエンジンなので、**数百ステップのワークフローでも一つ残らずすべて実行されます。** 長いコンテキストのLLMエージェントは必然的にステップを飛ばしますが、ワークフローエンジンは決して忘れません。

エンタープライズにとって、これは3つの重要な質問への回答です：**「複雑なプロセスを処理できますか？」** — エンジンが全ステップの完了を保証します。**「制御できますか？」** — ポリシーレールで可能です。**「問題を追跡できますか？」** — 監査レールで可能です。すべてプロンプトレベルの約束ではなく、アーキテクチャレベルでの回答です。

---

## 仕組み

### ステップタイプ

LLM Railは1つのワークフロー内で2種類のステップタイプをサポートします：

```yaml
steps:
  # Programmatic: LLMは不要です。CLIが直接実行します。
  - id: fetch-data
    type: programmatic
    actions:
      - shell: "curl -s {{api_url}}/data"
        extract: { records: "data", count: "total" }

  # Agentic: LLMエージェントが作業し、出力が検証されます。
  - id: analyze
    description: "{{count}}件のレコードの異常を分析"
    instruction: "レコードを分析し、リスクスコア付きで異常を特定してください"
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

  # Programmatic: LLMなしの後処理です。
  - id: notify
    type: programmatic
    depends_on: analyze
    actions:
      - shell: "curl -X POST {{webhook}} -d '{\"score\": {{risk_score}}}'"
```

**Programmaticステップ**はミリ秒単位で実行され、トークンコストはゼロです。**Agenticステップ**は集中的で検証されたスコープを受け取り、Haikuが安定して処理します。

### ポリシーシステム

エージェントが実行できるコマンドを制御します — AWS IAMからインスパイアされました：

```yaml
policy:
  mode: enforce
  rules:
    - effect: allow
      commands: ["curl *", "jq *", "node *"]
    - effect: deny
      commands: ["rm *", "sudo *"]
```

- **Trailモード**: すべてを許可し、すべてを記録します。開発やポリシー発見に使用します。
- **Enforceモード**: deny-firstのルール評価です。本番環境に使用します。
- **ポリシー生成**: trailログから最小限のallow-listを自動生成します。

すべてのコマンドはbashプロキシ（`lrail <id> bash "<cmd>"`）を経由し、ポリシーを適用してすべての実行を記録します。

### 検証ゲート

22の組み込み演算子が、各ステップの出力を検査してから次へ進めます：

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
    message: すべてのコメントにファイル参照が必要です
```

2段階に分かれています：**validation**（事前検証ガード）は不適切な送信を拒否します。**assertions**（事後検証チェック）は失敗時にステップを差し戻します。エージェントがエラーメッセージを受け取って自動的にリトライするため、人間の介入は不要です。

`verify_source`（URLを取得して、データスニペットが実際にページ上に存在するか確認する捏造防止機能）や`script`（シェルベースのカスタム検証ロジック）も含まれています。

### ワークフローライフサイクル

すべてのワークフローは成熟度フェーズを経て進化します：

```
draft → dev → stable
```

- **draft**: 探索段階です。制約なしに実行して、結果を観察し、改善を繰り返します。
- **dev**: 動作するワークフローです。検証を洗練させ、agenticステップをprogrammaticに変換していきます。
- **stable**: 本番準備完了です。ポリシーが`enforce`モードである必要があります。

`lrail wf <name> promote`で実行履歴を分析し、フェーズ昇格の推奨を確認できます。

### バリアント

複数の設計アプローチが共存し、比較し、マージできます：

```
workflows/stock-screening/
  workflow.yml              # ベース（実行対象）
  api-driven.workflow.yml   # 直接APIアプローチ
  programmatic.workflow.yml # 完全に決定的なアプローチ
```

バリアントは`extends: base`でベースを継承し、差分だけを定義します。ステップはIDベースでマージされます — 同じIDならオーバーライド、新しいIDなら追加、バリアントに含まれないIDはベースのまま保持されます。`lrail wf <name> merge <variant>`で優秀なバリアントをベースにマージできます。

### Accumulateモード

データを段階的に収集するステップに使用します：

```yaml
- id: collect
  instruction: "企業データをバッチ単位で収集してください"
  required_output: [companies]
  accumulate:
    companies:
      key: ticker
  validation:
    - field: companies
      op: min_length
      value: 20
```

エージェントがバッチ単位で送信すると、各バッチがキーによる重複排除でプールにマージされます。検証は蓄積されたプール全体に対して実行され、品質基準を満たすまでステップは開いたままになります。

### 監査証跡

すべてのイベントがインスタンスごとに記録されます：

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
| **ステップタイプ** | `programmatic`（LLMなしで直接実行）と`agentic`（LLMエージェント＋検証）を1つのワークフローで使用できます。 |
| **アクション** | `js:`（コンテキストが自動注入されるJavaScript）と`shell:`（テンプレート展開＋JSON抽出）。チェーンされたアクション間でパイプスタイルのデータフローをサポートします。 |
| **ポリシー** | AWS IAMスタイルのallow/denyルール。trailとenforceモード。全エージェントコマンドにbashプロキシを適用します。 |
| **検証ゲート** | 22の組み込み演算子。構造バリデーション＋ビジネスロジックアサーション＋`verify_source`捏造防止＋`script`カスタムロジック。 |
| **明示的データフロー** | `context_in`で必要なデータのみを受け渡します — 暗黙のマージもコンテキスト汚染もありません。 |
| **Accumulateモード** | キーによる重複排除マージで段階的にデータを収集します。品質ゲートを満たすまでステップは開いたままです。 |
| **バリアント** | 複数のワークフロー設計が共存し、比較し、マージできます。`extends: base`でIDベースのステップマージ。 |
| **ライフサイクルフェーズ** | `draft` → `dev` → `stable`の進行、昇格分析を支援します。 |
| **ライフサイクルフック** | 全段階でgate/eventフック（`step:before_start`、`step:completed`、`policy:denied`など）。 |
| **監査ログ** | 全イベントをJSONLで記録。インスタンスごとにaudit＋policyログで完全なトレーサビリティを提供します。 |
| **Claude Codeプラグイン** | 組み込みスキル＆エージェント — エディタを離れずにワークフローの設計・実行・監査が行えます。 |

---

## はじめに

### インストール

```bash
npm install llm-rail
```

### Claude Codeプラグインとして

```bash
claude install llm-rail
```

プロジェクト内で`/llm-rail:init`を実行すると、ワークフローのセットアップと`CLAUDE.md`への登録が完了します。

### CLIリファレンス

```bash
# ドキュメントの閲覧
lrail docs [topic]

# ワークフロー管理
lrail wf list                                       # 全ワークフロー一覧
lrail wf instances [--status <status>]              # 全インスタンス一覧
lrail wf <name> create [--variant <v>] [--param k=v]  # インスタンス作成
lrail wf <name> validate [--variant <v>]            # ワークフローYAMLの検証
lrail wf <name> show [--variant <v>]                # ワークフローYAMLの表示
lrail wf <name> variants                            # バリアント一覧
lrail wf <name> merge <variant> [--backup <name>]   # バリアントをベースにマージ
lrail wf <name> list [--status <status>]            # インスタンス一覧
lrail wf <name> promote                             # フェーズ昇格の分析

# インスタンス実行
lrail <id> start                                    # 実行開始
lrail <id> next --result '<json>'                   # ステップ結果の送信
lrail <id> status                                   # 進捗確認
lrail <id> query [--step <stepId>]                  # インスタンス状態の照会
lrail <id> reset <step-id>                          # ステップのリセット
lrail <id> log [step-id] [-f]                       # 監査ログの表示
lrail <id> bash '<command>'                         # ポリシープロキシ経由のコマンド実行
lrail <id> summary                                  # ワークフロー概要と警告
lrail <id> policy generate                          # trailからポリシーを生成

# バリアント管理
lrail wf <name> save-variant <v> --yaml '<content>'  # バリアントYAMLの保存
```

---

## Claude Codeプラグイン

Claude Codeプラグインとしてインストールすれば、CLIを直接操作する必要はありません。

| スキル | 説明 |
|---|---|
| `/llm-rail:init` | プロジェクトにLLM Railをセットアップします |
| `/llm-rail:design` | 自然言語でタスクを説明すると、検証済みのYAMLワークフローを生成します |
| `/llm-rail:build` | ビルトインのメタワークフローを使ってワークフローを生成・最適化します |
| `/llm-rail:run` | エンドツーエンドで実行 — 1つのエージェントが全ステップを順次実行します |
| `/llm-rail:review` | 試行実行＋分析 — 問題検出、修正提案、ポリシー生成 |
| `/llm-rail:status` | 実行中のワークフローの状態を確認します |
| `/llm-rail:optimize` | 既存ワークフローを最適化します（ベースライン、3段階の最適化、3ティア検証） |

### 自動ワークフロー生成

YAMLを手書きしたくないですか？ フレームワークに任せましょう：

- **`/llm-rail:build`** — 自然言語でタスクを説明してください。フレームワークが実現可能性を分析し、ワークフローを生成し、検証し、テスト実行まで自動で行います。
- **`/llm-rail:optimize`** — 既存のワークフローを受け取り、7段階の最適化パイプラインを実行します：ベースライン測定 → programmatic比率の改善 → 実行時間の短縮 → 検証失敗の削減 → 3ティアモデル検証 → 総合レポート。結果はバリアントファイルとして保存され、オリジナルは変更しません。

これらのメタワークフローは、LLM Rail自身を使ってLLM Railワークフローを構築・改善します — フレームワークのセルフホスティングです。

### `/llm-rail:run`の実行フロー

```
オーケストレーター（メインエージェント）
  │
  ├── ワークフロー検証 → インスタンス作成
  │
  └── インスタンス全体に1つのエージェントをspawn
        │
        ├── start → [programmaticステップの自動実行] → agenticステップのプロンプト
        ├── 作業 → next → [programmaticステップの自動実行] → agenticステップのプロンプト
        ├── 作業 → next → ...
        │
        └── ワークフロー完了。全ステップ検証済み。完全な監査ログ。
```

1つのエージェント、1つのインスタンス、最初から最後まで。各ステップは狭く検証されたスコープを受け取ります。最小限のコンテキスト、最小限のコスト。

---

<p align="center">
  <strong>安全なAI = モデルに良い振る舞いをお願いすることではなく、悪いことが起こり得ない構造を作ることです。</strong>
  <br>
  レールを定義しましょう。安価なモデルをその上で走らせましょう — 高速に、安全に、透明に。
</p>
