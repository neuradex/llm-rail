# llm-rail

LLM エージェントの作業を **YAML ワークフロー定義 → 決定論的ステップ実行** で制御する CLI ツール。

エージェントが「次に何をするか」「何を出力すべきか」を明確に指示し、各ステップの出力をバリデーションして品質を担保する。ワークフロー全体の進行状態と監査ログを自動管理。

## コンセプト

```
┌─────────────┐     create      ┌──────────────┐     start      ┌────────────┐
│ workflow.yml │ ──────────────> │   Instance   │ ─────────────> │  Step 1    │
│  (定義)       │                │  (.llm-rail/)│                │ in_progress│
└─────────────┘                 └──────────────┘                └─────┬──────┘
                                                                      │ next --result '{...}'
                                                                      ▼
                                                          ┌───────────────────┐
                                                          │  Validate output  │
                                                          │  ✓ required fields│
                                                          │  ✓ type / range   │
                                                          └────────┬──────────┘
                                                           OK │         │ NG
                                                              ▼         ▼
                                                        Step 2      REJECTED
                                                       in_progress   (retry)
```

1. **Workflow 定義** — YAML でステップ順序・依存関係・必須出力・バリデーションルール・Tips を宣言
2. **Instance** — ワークフローの実行単位。状態は `.llm-rail/` に YAML で永続化
3. **Validator** — 各ステップの出力を `required_output` + `validation` ルールで検証。不合格なら reject して再提出を要求
4. **Audit Log** — 全イベントを `.llm-rail/logs/<id>.jsonl` に JSONL で記録

## インストール

```bash
npm install
npm run build
```

グローバルにリンクする場合:

```bash
npm link
```

## 使い方

### 1. ワークフローを作成

```bash
# workflows/ 配下の YAML を読み込んでインスタンスを生成
llm-rail create code-review
# => 0318-143022  (インスタンス ID が出力される)
```

### 2. ワークフローを開始

```bash
llm-rail 0318-143022 start
# => Step 1/3: コードベース分析
#    Required output fields: file_list, complexity_score
#    >>> NEXT ACTION: コードベース分析
#        llm-rail 0318-143022 next --result '{"file_list":"...","complexity_score":"..."}'
```

### 3. ステップの結果を提出

```bash
llm-rail 0318-143022 next --result '{"file_list":["src/main.ts"],"complexity_score":5}'
# => 検証OK → 次のステップへ自動遷移
# => 検証NG → SUBMISSION REJECTED + エラー詳細 + リトライ指示
```

### 4. 進行状況を確認

```bash
llm-rail 0318-143022 status
# => Workflow: code-review (0318-143022)
#    Status: in_progress
#    Steps:
#      [x] 1. analyze - コードベース分析 (completed)
#      [>] 2. review - レビューコメント作成 (in_progress)
#      [ ] 3. summary - レビューサマリー作成 (pending)
```

## ワークフロー定義 (YAML)

```yaml
name: code-review
steps:
  - id: analyze
    description: コードベース分析
    required_output:
      - file_list
      - complexity_score
    validation:
      - field: file_list
        op: type
        value: array
      - field: complexity_score
        op: min
        value: 1
      - field: complexity_score
        op: max
        value: 10
    tips:
      - 変更のあったファイルだけでなく影響範囲も含めろ

  - id: review
    description: レビューコメント作成
    depends_on: analyze
    required_output:
      - comments
      - severity_counts
```

### バリデーション演算子

| op | 説明 | 対象 |
|---|---|---|
| `exists` | フィールドが存在するか | any |
| `type` | 型チェック (`string`, `number`, `array`, etc.) | any |
| `min_length` | 最小長 (文字列 or 配列) | string / array |
| `min` | 最小値 | number |
| `max` | 最大値 | number |

### ステップ間依存

`depends_on` で先行ステップの完了を前提条件にできる。循環依存はワークフロー作成時に検出される。

### Tips

各ステップに `tips` を定義すると、ステップ開始時にランダムに 2 つ選ばれてエージェントに提示される。

## プロジェクト構成

```
src/
├── cli.ts              # エントリポイント (CLI パーサー)
├── types.ts            # 型定義
├── util.ts             # YAML I/O, ID生成, ユーティリティ
├── engine/
│   ├── workflow.ts     # ワークフロー定義の読み込み・検証
│   ├── state.ts        # インスタンス状態の CRUD
│   ├── validator.ts    # ステップ出力のバリデーション
│   ├── tip-pool.ts     # Tips のランダム選出
│   └── output.ts       # CLI 出力フォーマッタ
├── commands/
│   ├── create.ts       # create コマンド
│   ├── start.ts        # start コマンド
│   ├── next.ts         # next コマンド
│   └── status.ts       # status コマンド
└── audit/
    └── logger.ts       # 監査ログ (JSONL)
```

## 開発

```bash
# 開発モードで実行
npm run dev -- create code-review

# テスト
npm test

# ビルド
npm run build
```

## ライセンス

Private
