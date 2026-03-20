<p align="center">
  <img src="https://img.shields.io/npm/v/llm-rail?style=flat-square&color=blue" alt="npm" />
  <img src="https://img.shields.io/badge/Claude_Code-plugin-blueviolet?style=flat-square" alt="Claude Code plugin" />
  <img src="https://img.shields.io/badge/license-private-lightgrey?style=flat-square" alt="license" />
</p>

<p align="center">
  <strong>LLMエージェントのための決定論的ワークフロー制御。</strong>
</p>

<p align="center">
  <a href="#はじめに">はじめに</a> ·
  <a href="#仕組み">仕組み</a> ·
  <a href="#claude-codeプラグイン">プラグイン</a> ·
  <a href="./CONTRIBUTING.ja.md">コントリビューション</a>
</p>

<p align="center">
  <a href="../README.md">English</a> ·
  <a href="./README.ko.md">한국어</a> ·
  <strong>日本語</strong>
</p>

---

<br>

LLMエージェントは複雑なタスクで崩壊する。ステップを飛ばし、出力をでっち上げ、より大きなモデルを投入するほどコストだけが膨らむ — 成功の保証もなく。

**llm-rail** は複雑なタスクを小さく検証可能なステップに分解する。各ステップは高速で安価なモデルが安定的に処理できるほどシンプルになる。

<br>

<div align="center">

```
 ┌──────────────────┐          ┌──────────────────┐          ┌──────────────────┐
 │  複雑なタスク      │          │  YAMLワークフロー  │          │  ステップごと実行  │
 │  Opusで失敗       │  ─────▶ │  検証ゲート付き     │  ─────▶ │  Haikuで実行     │
 │  $$$  不安定      │          │                    │          │  ¢    安定的     │
 └──────────────────┘          └──────────────────┘          └──────────────────┘
```

</div>

<br>

| | |
|---|---|
| **課題** | LLMエージェントにマルチステップのコードレビューを依頼した。セキュリティ分析を飛ばし、複雑度スコアを捏造し、トークン代$2を請求してきた。 |
| **解決** | レビューを検証可能な3ステップに定義する。各ステップは必ず生成すべき出力を宣言する。検証ゲートが出力を確認してから次へ進む。失敗したらリトライ — ゴミを次に渡さない。 |
| **結果** | 各ステップはHaikuで十分。総コスト: $0.08。全出力検証済み。完全な監査証跡。 |

<br>

## 仕組み

ワークフローをYAMLで定義する。各ステップは必須出力と検証ルールを宣言する。

```yaml
steps:
  - id: analyze
    description: "{{target}} のコードベース分析"
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
        message: 全コメントにファイルパスが必須
```

エージェントがステップごとに実行する。各ゲートでllm-railがルールに従い出力を検証する。**不良な出力はリジェクトされ、次には進まない。**

<br>

> **21の組み込み検証演算子** — 型チェック、範囲制約、正規表現マッチ、配列要素アサーションなど。構造バリデーションとビジネスロジックアサーションは分離され、それぞれカスタムエラーメッセージに対応。

<br>

## はじめに

```bash
npm install llm-rail
```

```bash
# ワークフローインスタンスを作成
llm-rail create code-review --param target=src/

# start → 検証 → 次のステップ、の繰り返し
llm-rail 0321-143022 start
llm-rail 0321-143022 next --result '{"file_list":["src/main.ts"],"complexity_score":5}'

# 進捗確認
llm-rail 0321-143022 status
```

<br>

## Claude Codeプラグイン

Claude Codeプラグインとしてインストールすれば、CLIを直接操作する必要がない。

```bash
claude install llm-rail
```

| スキル | 説明 |
|---|---|
| `/llm-rail:init` | プロジェクトにllm-railをセットアップ |
| `/llm-rail:design` | 自然言語でタスクを説明 → 検証可能なYAMLワークフローを生成 |
| `/llm-rail:run` | エンドツーエンド実行 — 各ステップをHaikuに自動委任 |
| `/llm-rail:audit` | 既存ワークフローの品質改善を分析 |
| `/llm-rail:status` | 実行中のワークフローの状態を確認 |

### `/llm-rail:run` の実行フロー

```
オーケストレーター（メインエージェント）
  │
  ├── ワークフロー検証 → インスタンス作成
  │
  ├── Step 1 → Haikuエージェント起動 → start → 作業 → next ✓
  ├── Step 2 → Haikuエージェント起動 → start → 作業 → next ✓
  ├── Step 3 → Haikuエージェント起動 → start → 作業 → next ✓
  │
  └── 完了。全ステップ検証済み。完全な監査ログ。
```

各step-runnerエージェントは **start**（タスクを読む）と **next**（結果を提出）の2コマンドだけを知っている。最小コンテキスト、最小コスト。

<br>

---

<p align="center">
  <strong>高価なモデルで複雑なタスクを失敗させるのをやめろ。</strong>
  <br>
  ステップを定義し。出力を検証し。安価なモデルに委任せよ。
</p>
