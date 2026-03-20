# コントリビューションガイド

> [English](./CONTRIBUTING.md) · [한국어](./CONTRIBUTING.ko.md) · [日本語](./CONTRIBUTING.ja.md)

## プロジェクト構成

```
src/
├── cli.ts                # CLI エントリポイント
├── types.ts              # 型定義 (StepDef, ActionDef, PolicyDef など)
├── util.ts               # YAML I/O, ID生成, ユーティリティ
├── engine/
│   ├── workflow.ts       # ワークフロー定義の読み込み・スキーマ検証
│   ├── state.ts          # インスタンス状態の CRUD (.llm-rail/{workflow}/{instance}/)
│   ├── validator.ts      # ステップ出力の検証 (21演算子)
│   ├── context.ts        # ステップ間コンテキスト解決・テンプレート展開
│   ├── dependency.ts     # ステップ間依存関係の解決
│   ├── hooks.ts          # ライフサイクルフック (gate / event)
│   ├── actions.ts        # アクション実行器 (template, stdin, extract)
│   ├── runner.ts         # プログラマティックステップの自動実行 (advanceThrough)
│   ├── policy.ts         # ポリシー評価 + トレイルロギング
│   ├── tip-pool.ts       # Tips のランダム選出
│   └── output.ts         # CLI 出力フォーマッタ
├── commands/
│   ├── create.ts         ├── start.ts
│   ├── next.ts           ├── status.ts
│   ├── query.ts          ├── reset.ts
│   ├── list.ts           ├── validate.ts
│   ├── bash.ts           └── policy.ts
└── audit/
    └── logger.ts         # 監査ログ (JSONL) + instanceDir ヘルパー
```

## 開発

```bash
npm install                          # 依存関係のインストール
npm run build                        # ビルド
npm test                             # テスト実行
npm run dev -- create code-review    # 開発モード
```

## CLI リファレンス

```
llm-rail create <workflow> [--param k=v]                ワークフロー定義からインスタンスを作成
llm-rail <id> start                                     次の待機中ステップを開始
llm-rail <id> next --result '<json>'                    ステップ出力を提出 (検証あり)
llm-rail <id> bash '<command>'                          ポリシー適用プロキシ経由でコマンドを実行
llm-rail <id> status                                    インスタンスの進捗を表示
llm-rail <id> query [--step <step-id>]                  ステップ詳細を照会
llm-rail <id> reset <step-id>                           ステップをリセットして再実行
llm-rail validate <workflow>                            ワークフローYAMLスキーマを検証
llm-rail list [--status <status>]                       全インスタンスを一覧表示
llm-rail policy check <workflow> --command '<cmd>'      ポリシーチェックのドライラン
llm-rail policy generate <id> --workflow <name>         トレイルログから許可リストを生成
```

## ワークフロースキーマ

### トップレベル

| フィールド | 型 | 必須 | 説明 |
|---|---|---|---|
| `name` | string | ○ | ワークフロー識別子 |
| `version` | string | × | Semverバージョン |
| `description` | string | × | ワークフローの説明 |
| `params` | object | × | 入力パラメータ (type, required, default, description, validation) |
| `context` | object | × | 共有コンテキスト |
| `policy` | PolicyDef | × | コマンド実行ポリシー (trail/enforce) |
| `steps` | StepDef[] | ○ | 順序付きステップ定義 |

### ステップフィールド

| フィールド | 型 | 必須 | 説明 |
|---|---|---|---|
| `id` | string | ○ | 一意のステップ識別子 |
| `type` | string | × | `"agentic"` (デフォルト) または `"programmatic"` |
| `description` | string | agentic のみ | `{{param}}` 展開対応 |
| `depends_on` | string \| string[] | × | 先行ステップID |
| `required_output` | string[] | agentic のみ | エージェントが必ず生成すべきフィールド |
| `actions` | ActionDef[] | programmatic 必須 | 実行するシェルコマンド |
| `validation` | Rule[] | × | 構造バリデーションルール |
| `assertions` | Rule[] | × | ビジネスロジックアサーション |
| `context_in` | object | × | 明示的データフロー: `ローカル名: "{stepId.field}"` |
| `tips` | string[] | × | 実行ヒント (ステップごとに2つランダム表示) |
| `meta` | object | × | フック用の任意メタデータ |

### ActionDef

| フィールド | 型 | 必須 | 説明 |
|---|---|---|---|
| `run` | string | ○ | シェルコマンド。`{{field}}` テンプレート展開対応。 |
| `extract` | object | × | stdout JSONから抽出する `targetKey: sourceKey` マッピング。 |

### PolicyDef

| フィールド | 型 | 必須 | 説明 |
|---|---|---|---|
| `mode` | string | ○ | `"trail"` (ログのみ) または `"enforce"` (deny-firstルール) |
| `rules` | PolicyRule[] | enforce のみ | `{ effect: "allow"\|"deny", commands: string[] }` の配列 |

### テンプレート構文

- `{{param}}` — description および action `run` フィールドでのパラメータ展開
- `{stepId.field}` — `context_in`でのステップ出力参照

## バリデーション演算子

`validation`と`assertions`ルールで使用できる21の組み込み演算子:

| 演算子 | 説明 | 対象 |
|---|---|---|
| `exists` | フィールドが存在するか | any |
| `not_empty` | 空でないか | string / array / object |
| `type` | 型チェック (`string`, `number`, `boolean`, `array`, `object`) | any |
| `min_length` | 最小長 | string / array |
| `max_length` | 最大長 | string / array |
| `length` | 完全一致の長さ | string / array |
| `min` | 最小値 | number |
| `max` | 最大値 | number |
| `between` | 範囲 `[min, max]` | number |
| `eq` | 完全一致 | any |
| `neq` | 不一致 | any |
| `gt` | より大きい | number |
| `gte` | 以上 | number |
| `lt` | より小さい | number |
| `lte` | 以下 | number |
| `contains` | 値を含む | string / array |
| `not_contains` | 値を含まない | string / array |
| `matches` | 正規表現マッチ | string |
| `one_of` | 許可値リスト内 | any |
| `each_has` | 配列の各要素が指定キーを持つ | array |

全ルールに`message`フィールドでカスタムエラーメッセージを指定可能。

- **`validation`** — 構造チェック (型、長さ、空チェック)。「データの形は正しいか？」
- **`assertions`** — ビジネスロジックチェック (値の範囲、許可値)。「データは妥当か？」

## ライフサイクルフック

ワークフロー・ステップのライフサイクルで発火するフック:

| フック | タイプ | 説明 |
|---|---|---|
| `step:before_start` | gate | ステップの開始をブロック可能 |
| `step:started` | event | ステップが`in_progress`に遷移した後に発火 |
| `step:rejected` | event | バリデーション失敗時に発火 |
| `step:before_complete` | gate | ステップの完了をブロック可能 |
| `step:completed` | event | ステップ完了後に発火 |
| `step:reset` | event | ステップリセット時に発火 |
| `workflow:created` | event | インスタンス作成時に発火 |
| `workflow:completed` | event | 全ステップ完了時に発火 |
| `workflow:error` | event | ワークフローエラー発生時に発火 |
| `action:before_run` | event | アクション実行前に発火 |
| `action:completed` | event | アクション完了後に発火 |
| `action:failed` | event | アクション失敗時に発火 |
| `policy:denied` | event | ポリシーがコマンドをブロックした時に発火 |

Gateフックは`{ allow: boolean, message?: string }`を返す。

## インスタンスディレクトリ構造

全インスタンスデータは統合ディレクトリに保存:

```
.llm-rail/{workflow-name}/{instance-id}/
  ├── state.yaml      # インスタンス状態 (steps, context, status)
  ├── audit.jsonl      # ライフサイクルイベントログ
  └── policy.jsonl     # コマンド実行ログ (bash proxy)
```

## ライセンス

Private
