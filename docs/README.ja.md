<!-- AGENT NOTE: このファイルを変更した場合は、../README.md（英語）と docs/README.ko.md（韓国語）も更新してください。 -->

<p align="center">
  <img src="https://img.shields.io/npm/v/llm-rail?style=flat-square&color=blue" alt="npm" />
  <img src="https://img.shields.io/badge/Claude_Code-plugin-blueviolet?style=flat-square" alt="Claude Code plugin" />
  <img src="https://img.shields.io/badge/license-MIT-green?style=flat-square" alt="license" />
</p>

<h1 align="center">LLM Rail</h1>

<p align="center">
  <strong>AIエージェントのための統合ガードレール。</strong>
  <br>
  構造的安全性。ワークフロー制御。完全な監査。
</p>

<p align="center">
  <a href="#インストールして忘れる">インストールして忘れる</a> ·
  <a href="#どのように保護するか">どのように保護するか</a> ·
  <a href="#ワークフローエンジン">ワークフローエンジン</a> ·
  <a href="#セキュリティアーキテクチャ">セキュリティ</a> ·
  <a href="#はじめに">はじめに</a> ·
  <a href="../CONTRIBUTING.md">コントリビューション</a>
</p>

<p align="center">
  <a href="../README.md">English</a> ·
  <a href="./README.ko.md">한국어</a> ·
  <strong>日本語</strong>
</p>

> **ベータ版 (0.x.x)** — 現在開発が活発に進行中です。APIやスキーマは変更される場合があります。安定性が必要な場合はバージョンを固定してください。

---

あなたのAIエージェントがプロジェクトで`rm -rf`を実行しました。またはAPIキーを出力に漏洩させました。またはmainにforce-pushしました。

注意するように伝えました。エージェントは無視しました — コンテキストが長くなるとLLMはそうなるものです。プロンプトレベルの安全性は提案にすぎません。エージェントは提案に従いません。

**LLM Railは安全性を構造的に強制します。** プロンプトではなく、すべてのコマンドが実行される前にインターセプトするフック、実行すべきでないものをブロックするポリシー、そして実行されたすべてを記録する監査ログによって。

2つのレベルで動作します：

- **即時保護** — プラグインをインストールすれば、すべてのClaude Codeセッションが保護されます。危険なコマンドがブロックされ、シークレットがリダクトされ、すべてが記録されます。
- **ワークフロー制御** — 複雑なタスクのために、各ステップが必要なコンテキストだけを受け取り、独自のポリシー下で実行され、検証をパスしないと次に進めない検証済みステップに分解します。

両レベルは同じポリシーエンジン、同じ監査インフラ、同じセキュリティモデルを共有します。日常的に設定したガードレールがワークフローも保護します。

```bash
# セットアップ完了。
/plugin marketplace add neuradex/llm-rail
/plugin install llm-rail@llm-rail
```

---

## インストールして忘れる

次のClaude Codeセッションで、`lrail.yml`が合理的なデフォルトで自動生成されます。この1ファイルがすべてを処理します：

```yaml
# lrail.yml — 自動生成、いつでも編集可能
visible: false          # エージェントがこのファイルを読み取り・変更できません

policy:
  mode: enforce
  default: allow        # deny-listアプローチ：特定のコマンドだけをブロック
  rules:
    - effect: deny
      commands:
        - "rm -rf *"                             # 再帰強制削除
        - regex: "rm\\s+-r\\s"                   # rm -r（再帰削除）
        - "sudo *"                               # 権限昇格
        - "git push --force *"                   # 強制プッシュ
        - regex: "git\\s+reset\\s+--hard"        # ハードリセット
        - regex: "git\\s+clean\\s+(-\\w*f)"      # git clean（未追跡ファイル削除）
        - regex: "git\\s+checkout\\s+--\\s+\\."   # git checkout -- .（全変更を復元）
        - regex: "curl.*\\|\\s*(bash|sh)"        # シェルへのパイプ
        - regex: "npm\\s+(uninstall|remove)\\s+.*llm-rail"  # 自己保護
        - regex: "lrail\\.yml"                   # この設定を保護
```

ホームディレクトリに置けば配下のすべてのプロジェクトに適用されます。特定のプロジェクトに置けば、そのディレクトリツリーでグローバル設定をオーバーライドします。cwdから上位に辿って最も近い`lrail.yml`が適用されます — `.gitignore`と同じ仕組みです。

**ファイル1つ。セットアップゼロ。毎セッション保護。**

---

## どのように保護するか

### ポリシー：エージェントができることを制御

エージェントが実行するすべてのBashコマンドはPreToolUseフックによってインターセプトされ、ポリシールールに対してチェックされてから実行されます。拒否されたコマンドは決して実行されません。

シンプルなルールにはグロブパターンを使います。フラグの並べ替え、絶対パスのトリック、サブコマンドのバリエーションを捕捉する必要があるときは正規表現を使います：

```yaml
rules:
  - effect: deny
    commands:
      - "sudo *"                                    # グロブ — sudoをブロック
      - regex: "rm\\s+(-\\w*r\\w*\\s+)*-\\w*f"     # 正規表現 — rm -rf、rm -r -f、rm -frなどを捕捉
      - regex: "git\\s+push\\s+.*(--force|\\s-f)"   # 正規表現 — すべてのforce-pushバリエーションを捕捉
```

`rm -rf`がブロックされていることを知ったエージェントは`rm -r -f`や`/bin/rm -rf`を試すかもしれません。グロブパターンはこれを見逃します。正規表現は見逃しません。

### シークレット：見ることなく使う

エージェントは外部サービスを呼び出すためにAPIキーが必要です。しかし実際の値を見たり、出力に表示すべきではありません。

```yaml
env:
  secret_files: [.env, .env.local]
```

この1行で3つのことが処理されます：

1. **注入** — `.env`ファイルのシークレット値がエージェントのサブプロセス環境に注入されます
2. **リダクト** — シークレット値を含むすべての出力は、エージェントが見る前に`[REDACTED]`に置換されます
3. **ブロック** — Read、Grepフックがエージェントの`.env`ファイルへの直接アクセスを阻止します

エージェントが`curl -H "Authorization: Bearer $API_KEY" ...`を書けば正常に動作します。しかし`$API_KEY`が実際に何なのかは決して知ることができません。

### 監査：すべてが記録されます

フック、プロキシ、CLI — すべてのソースからのすべてのコマンドが、タイムスタンプ、ソースタグ、ポリシー判定とともに1つのコマンドログに記録されます：

```bash
lrail log              # 最近のコマンド
lrail log -n 50        # 直近50件
lrail log -f           # リアルタイムフォロー
lrail log --raw        # マシンリーダブルなTSV
```

拒否されたコマンドも記録されます。エージェントが何を試み、何がブロックされたかを正確に確認できます。

### 自己保護：エージェントがルールを変更できません

`visible: false`（デフォルト）は、エージェントがどのツールでも`lrail.yml`を読めないことを意味します — Read、Edit、Write、Grep、Bashすべて。どんなルールが存在するか知らないため、ゲーミングができません。

エージェントがルールを見て行動を適応できるようにするには（「これは拒否されるな、別の方法を試そう」）、`visible: true`に設定してください。これは意図的な選択であり、デフォルトではありません。

---

## ワークフローエンジン

ガードレールは悪いアクションを防ぎます。しかし複雑なタスクが失敗する理由は別にあります：LLMには**最新性バイアス（recency bias）**があります。コンテキストが長くなるほど、元の指示をより多く忘れます。200ステップのタスクでは、エージェントは必然的にステップを飛ばし、データをでっち上げ、計画から逸脱します。

ワークフローエンジンは、**各ステップが必要なデータだけを受け取るクリーンで狭いコンテキスト**を持つステップに作業を分解することでこの問題を解決します。10Kトークンの集中的な入力を受け取るステップは、100Kトークンの蓄積された履歴に埋もれたエージェントよりも優れた出力を生み出します。

これは直接的なコスト効果をもたらします：コンテキストが十分に狭ければ、**HaikuがOpusと同じ品質**をコストのわずかな割合で生み出します。モデルが賢い必要はありません — 集中していればいいのです。LLM Railは集中を構造的にします。

```yaml
name: code-review
steps:
  - id: fetch-diff
    type: programmatic
    actions:
      - shell: "git diff {{base_branch}}...HEAD"
        extract: { diff: "." }

  - id: review
    description: "diffの問題点をレビュー"
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

`fetch-diff`はシェルコマンドとして実行されます — LLMなし、トークンなし、ミリ秒。`review`は`context_in`を通じて必要なdiffだけを正確に受け取り、`required_output`に宣言された出力だけを生成し、`validation`をパスしないとワークフローが進みません。

### 2つのステップタイプ、1つのワークフロー

| | Programmatic | Agentic |
|---|---|---|
| 実行 | CLIが直接実行 | LLMエージェントが作業 |
| コスト | トークンゼロ | 最小（スコープが限定的） |
| 速度 | ミリ秒 | 秒 |
| 使用場面 | 決定的な操作（取得、フィルタ、送信） | 判断が必要な場面（分析、レビュー、作成） |

混在させることが鍵です。データはprogrammaticで取得し、エージェントで分析し、結果はprogrammaticで送信します。決定的な部分はLLMが関与しないため、ハルシネーションが構造的に不可能です。

### 検証ゲート

各ステップの出力は2つのティアのチェックを通過します：

- **validation** — ステップが完了する前に実行されます。不適切な出力を即座に拒否します。エージェントはエラーメッセージを受け取りリトライします。
- **assertions** — ステップが完了した後（後続アクションを含む）に実行されます。失敗時にステップを差し戻します。エージェントが自動的にリトライします。

```yaml
validation:
  - field: score
    op: between
    value: [0, 100]
  - field: sources
    op: each_has
    value: url
    message: "すべてのソースにURLが必要です"
assertions:
  - field: sources
    op: verify_source          # URLを取得し、データが実際に存在するか確認
    value: { field: "snippet", sample_size: 3 }
```

22の組み込み演算子が型チェック、範囲、配列検証、ユニーク性、捏造防止（`verify_source`はURLを取得し、引用されたデータが実際にページ上に存在するか確認）をカバーします。カスタム検証には`script`演算子でシェルコマンドを検証ゲートとして実行できます。

### ワークフローごとのポリシー

`lrail.yml`のプロジェクトレベルのポリシーはすべてをグローバルに保護します。ワークフローはその上に追加の制限を重ねることができます：

```yaml
policy:
  mode: enforce
  rules:
    - effect: allow
      commands: ["curl -s https://api.example.com/*", "jq *"]
    - effect: deny
      commands: ["curl *", "rm *"]
```

コードレビューのワークフローは`git diff`と`jq`を許可できます。データ収集のワークフローは特定のAPIエンドポイントを許可できます。各ワークフローは必要な権限だけを正確に受け取ります。

### ライフサイクルとバリアント

ワークフローはフェーズを経て成熟します：`draft` → `dev` → `stable`。draftでは自由に実験します。devでは検証を強化し、agenticステップを可能な限りprogrammaticに変換します。stableではポリシーがenforceモードである必要があります。

複数の設計アプローチがバリアントとして共存できます — 異なるステップ構造、異なるモデル、異なるデータソース — そして優秀なバリアントをベースにマージします：

```bash
lrail wf code-review variants           # バリアント一覧
lrail wf code-review merge api-driven   # 優秀なバリアントをマージ
lrail wf code-review promote            # 次のフェーズへの準備を確認
```

### 完全な監査証跡

すべてのワークフローインスタンスが完全な履歴を記録します：

```
.llm-rail/{workflow}/{instance}/
  ├── state.yaml      # 現在のインスタンス状態
  ├── audit.jsonl      # 全ライフサイクルイベント（ステップ開始、完了、拒否、リセット）
  └── proxy.jsonl     # 全コマンド実行とポリシー判定
```

グローバルの`lrail log`と合わせると完全な全体像が得られます：エージェントが何をしたか、何が許可されたか、何がブロックされたか、そしてなぜ。

---

## セキュリティアーキテクチャ

LLM Railのすべての保護機能 — ポリシー、シークレット、監査、自己保護 — はスタンドアロン使用とワークフロー実行の両方をカバーする1つのアーキテクチャに収束します：

```
┌─ プロジェクトポリシー (lrail.yml) ───────────────────────┐
│                                                           │
│  メインエージェント（フック）    サブエージェント（プロキシ）│
│  ┌──────────────────┐          ┌──────────────────┐      │
│  │ PreToolUseフック   │          │ lrail <id> bash   │      │
│  │ → ポリシー評価    │          │ → プロジェクトポリシー│    │
│  │ → シークレットリダクト│       │ → ワークフローポリシー│    │
│  │ → コマンドログ    │          │ → シークレットリダクト│    │
│  └──────────────────┘          │ → コマンドログ    │      │
│                                 └──────────────────┘      │
└───────────────────────────────────────────────────────────┘
```

| レイヤー | 強制する内容 | 方法 |
|---|---|---|
| **Bashフック** | どのコマンドが実行可能か | PreToolUseがすべてのBash呼び出しをインターセプトし、ポリシー評価後にexit 2でブロック |
| **ファイルフック** | どのファイルにアクセス可能か | Read/Grepフックがシークレットファイルをブロック、ガードフックが`lrail.yml`をブロック |
| **設定の可視性** | エージェントがルールを知っているか | `visible: false`がすべてのツールから設定を隠蔽 |
| **Bashプロキシ** | ワークフロー固有の権限 | `lrail <id> bash`がプロジェクトポリシーの上にワークフローポリシーを追加 |
| **シークレット仲介** | 認証情報の露出 | サブプロセスenvに注入、すべての出力からリダクト |
| **監査ログ** | アカウンタビリティ | すべてのコマンド、すべての判定、すべてのソース — 記録 |

フックプロトコルは**exit 2**（ブロッキングエラー）を使用します。Claude Codeの許可リストをオーバーライドし、`bypassPermissions`を含むすべての権限モードで機能します。エージェントが無視できる提案ではありません — 構造的なゲートです。

### カスタムエージェントのための構造的強制

最大限の隔離のために、エージェントのツールを`allowed-tools`で`Bash(lrail *)`に制限してください。エージェントはプロキシ経由でのみコマンドを実行できます — 直接のシェルアクセスは不可。ポリシー強制が困難なのではなく、構造的にバイパス不可能になります。

---

## はじめに

### Claude Codeプラグイン（推奨）

```bash
/plugin marketplace add neuradex/llm-rail
/plugin install llm-rail@llm-rail
```

新しいセッションを開始してください。保護が適用されます。

### CLIツールとして

```bash
npm install llm-rail
lrail init
```

### CLIリファレンス

```bash
# ガードレール
lrail init                                            # 初期化（プラグインインストール時は自動）
lrail policy eval --command '<cmd>'                   # ポリシーに対してコマンドをテスト
lrail log [-n <count>] [-f] [--raw]                   # コマンド履歴
lrail bash '<command>'                                # グローバルプロキシ経由で実行

# ワークフロー管理
lrail wf list                                         # ワークフロー一覧
lrail wf <name> create [--variant <v>] [--param k=v]  # インスタンス作成
lrail wf <name> validate [--variant <v>]              # YAMLの検証
lrail wf <name> promote                               # 昇格準備の確認

# インスタンス実行
lrail <id> start                                      # 実行開始
lrail <id> next --result '<json>'                     # ステップ結果の送信
lrail <id> status                                     # 進捗確認
lrail <id> bash '<command>'                           # プロキシ経由で実行
lrail <id> policy generate                            # trailからポリシーを生成
```

---

## Claude Codeプラグイン

| スキル | 説明 |
|---|---|
| `/llm-rail:design` | タスクを説明 → 検証済みワークフローを生成 |
| `/llm-rail:build` | ワークフローを自動で生成、最適化、テスト |
| `/llm-rail:run` | ワークフローをエンドツーエンドで実行 |
| `/llm-rail:review` | 試行実行 + 分析 — 問題検出、修正提案 |
| `/llm-rail:optimize` | 7段階の最適化パイプラインでバリアントを出力 |

フレームワークが自身のワークフローを構築・改善します — セルフホスティングです。

---

<p align="center">
  <strong>プロンプトレベルの安全性はダッシュボードに貼ったステッカーです。構造的安全性はシートベルトです。</strong>
  <br>
  LLM Railはシートベルトを作ります。
</p>
