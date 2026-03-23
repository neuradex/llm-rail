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
  <a href="#ポリシーとシークレット">ポリシーとシークレット</a> ·
  <a href="#ワークフローエンジン">ワークフローエンジン</a> ·
  <a href="#セキュリティモデル">セキュリティ</a> ·
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

プロンプトレベルの安全性（「注意してください」）は機能しません。コンテキストが長くなるほどエージェントは指示を無視します。**構造的な強制が必要です。**

LLM Railは2つのレベルで動作します：

- **即時保護** — プラグインをインストールするだけで、ポリシー強制・シークレット保護・コマンド監査が自動的に開始されます
- **ワークフロー制御** — 複雑なタスクを検証されたステップに分解し、各ステップのコンテキストと権限を制御します

```bash
# プラグインをインストール。それだけです。
/plugin marketplace add neuradex/llm-rail
/plugin install llm-rail@llm-rail
```

次のセッションから、すべてのClaude Codeコマンドが保護されます。設定は不要です。

---

## インストールして忘れる

LLM Railはインストールした瞬間から動作します。次のClaude Codeセッションで：

1. `lrail.yml`が合理的なデフォルトで自動生成されます
2. 危険なコマンドがブロックされます（`rm -rf`、`sudo`、`git push --force`、...）
3. エージェントが実行するすべてのコマンドが記録されます
4. 設定ファイル自体がエージェントの改ざんから保護されます

**ファイル1つ。セットアップゼロ。毎セッション保護。**

```yaml
# lrail.yml — 自動生成、いつでも編集可能
visible: false          # エージェントがこのファイルを読み取り・変更できません

policy:
  mode: enforce
  default: allow        # deny-listアプローチ：特定のコマンドだけをブロック
  rules:
    - effect: deny
      commands:
        - "rm -rf *"
        - "sudo *"
        - "chmod 777 *"
        - "git push --force *"
        - "git reset --hard *"
        - regex: "curl.*\\|\\s*(bash|sh)"   # シェルへのパイプ
        - regex: "lrail\\.yml"              # この設定を保護
```

ホームディレクトリに`lrail.yml`を1つ置けば — 配下のすべてのプロジェクトに適用されます。

---

## ポリシーとシークレット

### ポリシー強制

シンプルなルールにはグロブパターン。精密さが必要なときは正規表現：

```yaml
rules:
  - effect: deny
    commands:
      - "sudo *"                                    # グロブ — シンプル
      - regex: "rm\\s+(-\\w*r\\w*\\s+)*-\\w*f"     # 正規表現 — rm -r -f、rm -rfなどを捕捉
      - regex: "git\\s+push\\s+.*(--force|\\s-f)"   # 正規表現 — すべてのforce-pushバリエーションを捕捉
```

エージェントがフラグの順序を変えたり絶対パスを使っても、正規表現ルールをバイパスすることはできません。

### シークレット保護

`.env`ファイルを指定するだけ。シークレットが自動注入・自動リダクトされます：

```yaml
env:
  secret_files: [.env, .env.local]
```

- エージェントが`curl -H "Authorization: Bearer $API_KEY" ...`を実行 — 正常に動作
- ただし`$API_KEY`の値はエージェント出力に**一切表示されません** — `[REDACTED]`に置換
- エージェントが`cat .env`やシークレットファイルの`grep`はできません — フックがブロック

### コマンド監査

すべてのコマンドが記録されます。エージェントが実際に何をしたか確認できます：

```bash
lrail log              # 最近のコマンド
lrail log -n 50        # 直近50件
lrail log -f           # リアルタイムフォロー
lrail log --raw        # マシンリーダブルなTSV
```

### 設定の自己保護

デフォルトではエージェントが`lrail.yml`を読み取り・編集・書き込みすることはできません。自分を制約するルールを削除することはできません。

エージェントが設定を読んで適応できるようにするには、`visible: true`を設定してください（例：「このコマンドは拒否されるな、別の方法を試そう」）：

```yaml
visible: true   # エージェントがこの設定を読み取り・変更できます
```

---

## ワークフローエンジン

ガードレール以上のものが必要なタスクに — 複雑な作業を検証されたステップに分解し、各ステップのコンテキスト、権限、出力を制御します。

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

### なぜ重要か

LLMには**最新性バイアス（recency bias）**があります — コンテキストが長くなるほど、より多くのことを忘れます。200ステップのタスクでは、エージェントは必然的にステップを飛ばします。ワークフローエンジンは決して忘れません。

各ステップは必要なデータだけを含む**狭いコンテキスト**を受け取ります。小さなモデル、小さなコンテキスト、正確な出力。**HaikuがOpusを代替します。**コストは$2から$0.08に下がります。

### ステップタイプ

| | Programmatic | Agentic |
|---|---|---|
| 実行 | CLIが直接実行 | LLMエージェントが作業 |
| コスト | トークンゼロ | 最小（スコープが限定的） |
| 速度 | ミリ秒 | 秒 |
| 使用場面 | 決定的な操作 | 判断が必要な場面 |

1つのワークフロー内で混在させて使用できます。データはprogrammaticで取得し、エージェントで分析し、結果はprogrammaticで送信します。

### 検証ゲート

22の組み込み演算子。2つのティア：

- **validation** — 完了前のガード。ステップが完了する前に不適切な出力を拒否します。
- **assertions** — 完了後のチェック。失敗時にステップを差し戻し、エージェントが自動的にリトライします。

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
    op: verify_source          # URLを取得し、データの存在を確認
    value: { field: "snippet", sample_size: 3 }
```

`script`演算子でシェルベースのカスタム検証も可能です — スクリプト化できるあらゆるチェックを実行できます。

### ワークフローごとのポリシー

プロジェクトレベルのポリシーはすべてを保護します。ワークフローレベルのポリシーはタスクごとの制限を追加します：

```yaml
policy:
  mode: enforce
  rules:
    - effect: allow
      commands: ["curl -s https://api.example.com/*", "jq *"]
    - effect: deny
      commands: ["curl *", "rm *"]
```

許可した特定のAPIエンドポイントだけがアクセス可能。それ以外はすべて拒否。

### ライフサイクルとバリアント

ワークフローはフェーズを経て成熟します：`draft` → `dev` → `stable`

複数の設計アプローチがバリアントとして共存し、比較後、勝者がベースにマージされます：

```bash
lrail wf code-review variants           # バリアント一覧
lrail wf code-review merge api-driven   # 優秀なバリアントをマージ
lrail wf code-review promote            # 次のフェーズへの準備を確認
```

### 監査証跡

すべてのイベントがインスタンスごとに記録されます：

```
.llm-rail/{workflow}/{instance}/
  ├── state.yaml      # インスタンス状態
  ├── audit.jsonl      # 全ライフサイクルイベント
  └── proxy.jsonl     # 全コマンド実行 + ポリシー判定
```

---

## セキュリティモデル

LLM Railは安全性を**構造的に**強制します — プロンプトではなく。

```
┌─ プロジェクトポリシー (lrail.yml) ───────────────────────┐
│                                                           │
│  メインエージェント（フック）    サブエージェント（プロキシ）│
│  ┌──────────────────┐          ┌──────────────────┐      │
│  │ PreToolUseフック   │          │ lrail <id> bash   │      │
│  │ → ポリシー評価    │          │ → プロジェクトポリシー│    │
│  │ → コマンドログ    │          │ → ワークフローポリシー│    │
│  └──────────────────┘          │ → コマンドログ    │      │
│                                 └──────────────────┘      │
└───────────────────────────────────────────────────────────┘
```

| レイヤー | 強制方法 |
|---|---|
| **Bash** | PreToolUseフックがすべてのコマンドをポリシーに対してチェック |
| **Read/Edit/Write** | フックがシークレットファイルと`lrail.yml`を保護 |
| **Config** | `visible: false`でエージェントのルール閲覧をブロック |
| **Bash（プロキシ）** | `lrail <id> bash`がワークフローレベルのポリシーを追加 |
| **シークレット** | 自動注入、自動リダクト、ファイルアクセスのブロック |

フックプロトコルは**exit 2**（ブロッキングエラー）を使用します — Claude Codeの許可リストをオーバーライドし、`bypassPermissions`を含むすべての権限モードで機能します。

### カスタムエージェントのための構造的強制

エージェントを`Bash(lrail *)`の`allowed-tools`に制限してください。プロキシ経由でのみ実行可能になります — 直接のシェルアクセスは不可。ポリシーが構造的にバイパス不可能になります。

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
