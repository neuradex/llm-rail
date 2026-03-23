<p align="center">
  <img src="https://img.shields.io/npm/v/llm-rail?style=flat-square&color=blue" alt="npm" />
  <img src="https://img.shields.io/badge/Claude_Code-plugin-blueviolet?style=flat-square" alt="Claude Code plugin" />
  <img src="https://img.shields.io/badge/license-MIT-green?style=flat-square" alt="license" />
</p>

<p align="center">
  <strong>AIエージェントのための構造的安全性。</strong>
</p>

<p align="center">
  <a href="#問題">問題</a> ·
  <a href="#仕組み">仕組み</a> ·
  <a href="#セキュリティモデル">セキュリティ</a> ·
  <a href="#はじめに">はじめに</a> ·
  <a href="#claude-codeプラグイン">プラグイン</a> ·
  <a href="./CONTRIBUTING.ja.md">コントリビューション</a>
</p>

<p align="center">
  <a href="../README.md">English</a> ·
  <a href="./README.ko.md">한국어</a> ·
  <strong>日本語</strong>
</p>

> **ベータ版 (0.2.x)** — 現在開発が活発に進行中です。API、CLIコマンド、ワークフロースキーマは予告なく変更される場合があります。安定性が必要な場合はバージョンを固定してください。

---

LLMエージェントはステップを飛ばし、データをでっち上げ、実行すべきでないコマンドを実行します。**LLM Railはこれらの失敗を構造的に不可能にします** — モデルに注意を求めるのではなく、悪いことが起こり得ない実行構造を構築します。

既存のエージェントフレームワークはオーケストレーションを扱いますが、安全性はプロンプトに委ねています。「注意して。」「間違えないで。」これは**ダッシュボードに貼ったステッカー**にすぎません。LLM Railは異なるアプローチを取ります：**フレームワークレベルの構造的安全性**です。

| レイヤー | 強制する内容 |
|---|---|
| **ワークフロー** | タスクを検証可能なステップに分解します。各ステップは狭いコンテキストで実行されるため、OpusではなくHaikuで十分です。 |
| **ポリシー** | すべてのコマンドがbashプロキシ（`lrail <id> bash`）を通過します。IAMスタイルのallow/denyルール。明示的に許可されたことだけが実行可能です。 |
| **監査** | すべてのアクション、コマンド、ポリシー判定がインスタンスごとに記録されます。完全なトレーサビリティを提供します。 |

AIエージェントが複雑なコードレビューに失敗しましたか？ 検証可能な3ステップに分割して、それぞれHaikuで実行してみてください。総コストは$2から$0.08に下がります。すべての出力が検証され、完全な監査ログが残ります。

---

## 問題

LLMには**最新性バイアス（recency bias）**があります — コンテキストが長くなるほど、元の指示をより多く忘れてしまいます（[Peysakhovich & Lerer 2023](https://arxiv.org/abs/2310.01427)、[Liu et al. 2023](https://arxiv.org/abs/2307.03172)）。これが複雑なエージェントタスクの根本的な失敗パターンです。

LangChainやCrewAIのような既存フレームワークはエージェントに*何を*するかは伝えますが、*どこまでやっていいか*は制御しません。オーケストレーションは扱いますが、フレームワークレベルの**実行制御と監査**は持っていません。LLM Railがこのギャップを埋めます。

LLM Railは**各ステップのコンテキストを小さく集中的に保つ**ことで、最新性バイアスの問題を解決します：

- 各ステップは`context_in`で必要なデータだけを受け取る、クリーンなエージェントを使用します
- 前のステップからのコンテキスト汚染がありません
- エージェントが賢い必要はありません — 狭い指示を正確に実行するだけで十分です

これが**HaikuがOpusを代替できる**理由です。モデルの能力ではなく、スコープの問題です。小さなコンテキストの小さなモデルは、大きなコンテキストに埋もれた大きなモデルに勝ります。

ワークフローエンジンが — LLMではなく — 進捗を管理するので、**数百ステップのワークフローでも一つ残らずすべて実行されます。** 長いコンテキストのLLMエージェントは必然的にステップを飛ばしますが、ワークフローエンジンは決して忘れません。

エンタープライズへの回答：**「制御できますか？」** — フレームワークレベルでポリシーを強制します。**「追跡できますか？」** — 完全な監査ログ。**「複雑なプロセスを処理できますか？」** — エンジンが全ステップの完了を保証します。すべてプロンプトレベルの約束ではなく、構造的に回答します。

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

## セキュリティモデル

LLM Railは**構造的な安全性**を提供します — プロンプトレベルの「注意してください」という警告ではありません。

ポリシー適用は**2つのレイヤー**で動作します。プロジェクトポリシー（`.llm-rail/policy.yml`）はプロジェクト全体のすべてのコマンドに適用されます。ワークフローポリシー（workflow YAMLの`policy:`）はその上にワークフローごとのルールを追加します。

```
┌─ プロジェクトポリシー (.llm-rail/policy.yml) ────────────────┐
│                                                               │
│  メインエージェント（フック）    サブエージェント（プロキシ）   │
│  ┌──────────────────┐          ┌──────────────────┐          │
│  │ PreToolUseフック   │          │ lrail <id> bash   │          │
│  │ → ポリシー評価    │          │ → ポリシー評価    │          │
│  │ → コマンドログ    │          │ → ワークフローポリシー │      │
│  └──────────────────┘          │ → コマンドログ    │          │
│                                 └──────────────────┘          │
└───────────────────────────────────────────────────────────────┘
```

メインエージェントのコマンドは**PreToolUseフック**でインターセプトされます — すべてのBash呼び出しが実行前にプロジェクトポリシーでチェックされます。サブエージェントのコマンドは`lrail <id> bash`を経由し、プロジェクトポリシーとワークフローポリシーの両方がチェックされます。すべてのコマンドはグローバルコマンド履歴（`lrail log`）に記録されます。

### 構造的な強制

Custom agentの`allowed-tools`を`Bash(lrail *)`に制限すると、**lrail bashプロキシ経由のコマンドのみ実行可能**になります — 直接のシェルアクセスは不可。これにより、ポリシーレイヤーがプロンプト依存ではなく構造的に強制されます。

| | Custom Agent（例：`step-runner`） | General-Purpose Agent |
|---|---|---|
| ツール制限（`allowed-tools`） | 可能 — ホワイトリストのみ許可 | 不可 — 全ツール利用可能 |
| Bash制限 | `Bash(lrail *)` — プロキシのみ | 制限なし |
| ポリシー適用 | 構造的（バイパス不可） | フックベース（プロジェクトポリシー） |
| WebSearch / WebFetch | 利用不可 | 利用可能 |
| プロジェクトポリシー | 適用（プロキシ経由） | 適用（PreToolUseフック経由） |

### 2つのポリシーレイヤー

**プロジェクトポリシー**（`.llm-rail/policy.yml`）— すべてのソースからのコマンドに適用：

```yaml
# .llm-rail/policy.yml
mode: enforce
default: allow
rules:
  - effect: deny
    commands: ["rm -rf *", "sudo *"]
```

**ワークフローポリシー**（workflow YAMLの`policy:`）— プロジェクトポリシーの上にワークフローごとの追加ルール：

```yaml
policy:
  mode: enforce
  rules:
    - effect: allow
      commands: ["curl -s https://api.example.com/*", "jq *"]
    - effect: deny
      commands: ["curl *", "rm *", "sudo *"]
```

どのURLにアクセスできるか、どのバイナリを実行できるか、どの引数が許可されるかを、フレームワークレベルで**ドメイン単位で制御**できます。

### 監査ログ

すべてのコマンドはソース追跡付きでグローバルコマンド履歴に記録されます：

```bash
lrail log                # ソースタグが色分けされた表示
lrail log --raw          # マシンパース用TSV出力
lrail log -f             # フォローモード
```

インスタンスごとのポリシー判定は`policy.jsonl`にも記録されます。`trail`モード（全許可）でもすべてのアクションが記録され、事後レビューが可能です。

### 制御を失わないウェブアクセス

制限のない`WebFetch`/`WebSearch`の代わりに、bashプロキシ経由の`curl`を使用します：

```yaml
- id: search
  type: programmatic
  actions:
    - shell: "curl -s https://google.serper.dev/search -H 'X-API-KEY: {{serper_key}}' -d '{\"q\": \"{{query}}\"}'"
      extract: { results: "organic" }
```

Programmaticステップは自動的にプロキシを経由します。Agenticステップでは、エージェントが`lrail <id> bash 'curl ...'`を呼び出します — 同じポリシー、同じ監査。

### 推奨構成

構造的な安全性を最大化するには：
1. **Custom agent**を使用し、`allowed-tools: Bash(lrail *), Read, Glob, Grep`に制限します
2. **プロジェクトポリシー**（`.llm-rail/policy.yml`）で危険なコマンドをブロックします
3. **ワークフローポリシー**を**enforceモード**に設定し、明示的な許可リストを作成します
4. `WebFetch`/`WebSearch`の代わりに、bashプロキシ経由の`curl`でウェブにアクセスします
5. 監査ログをレビューします：`lrail log`（グローバル）および`policy.jsonl`（インスタンスごと）

> **この領域は現在活発に開発中です。** 構造的セキュリティモデルを強化する方法を継続的に模索しています。貢献やアイデアを歓迎します。[Contributing](./CONTRIBUTING.ja.md)をご参照ください。

---

## はじめに

### インストール

```bash
npm install llm-rail
```

### Claude Codeプラグインとして

```bash
# マーケットプレイスの追加
/plugin marketplace add neuradex/llm-rail

# プラグインのインストール
/plugin install llm-rail@llm-rail
```

プロジェクト内で`/llm-rail:init`を実行すると、ワークフローのセットアップと`CLAUDE.md`への登録が完了します。

### CLIリファレンス

```bash
# グローバル
lrail docs [topic]                                    # ドキュメントの閲覧
lrail log [-n <count>] [-f] [--raw]                   # コマンド履歴の表示
lrail policy eval --command '<cmd>'                   # プロジェクトポリシーの評価

# ワークフロー管理
lrail wf list                                         # 全ワークフロー一覧
lrail wf instances [--status <status>]                # 全インスタンス一覧
lrail wf <name> create [--variant <v>] [--param k=v]  # インスタンス作成
lrail wf <name> validate [--variant <v>]              # ワークフローYAMLの検証
lrail wf <name> show [--variant <v>]                  # ワークフローYAMLの表示
lrail wf <name> summary [--variant <v>] [--param k=v] # ワークフロー概要と警告
lrail wf <name> variants                              # バリアント一覧
lrail wf <name> merge <variant> [--backup <name>]     # バリアントをベースにマージ
lrail wf <name> list [--status <status>]              # インスタンス一覧
lrail wf <name> promote                               # フェーズ昇格の分析
lrail wf <name> policy check --command '<cmd>'        # ポリシーのドライランチェック

# インスタンス実行
lrail <id> start                                      # 実行開始
lrail <id> next --result '<json>'                     # ステップ結果の送信
lrail <id> status                                     # 進捗確認
lrail <id> query [--step <stepId>]                    # インスタンス状態の照会
lrail <id> reset <step-id>                            # ステップのリセット
lrail <id> log [step-id] [-f]                         # 監査ログの表示
lrail <id> bash '<command>'                           # ポリシープロキシ経由のコマンド実行
lrail <id> policy generate                            # trailからポリシーを生成

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
  <strong>プロンプトレベルの安全性はダッシュボードに貼ったステッカーです。構造的安全性はシートベルトです。</strong>
  <br>
  LLM Railはシートベルトを作ります。
</p>
