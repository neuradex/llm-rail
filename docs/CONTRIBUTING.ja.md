# コントリビューションガイド

> [English](./CONTRIBUTING.md) · [한국어](./CONTRIBUTING.ko.md) · **日本語**

LLM Railへの関心をお寄せいただきありがとうございます。このガイドでは、開発環境のセットアップ、変更の作成、コントリビューションの提出手順をご案内します。

## 開発環境のセットアップ

```bash
git clone https://github.com/neuradex/llm-rail.git
cd llm-rail
npm install
npm run build
npm test
```

ライブリロードでの開発:

```bash
npm run dev -- docs              # 開発モードでCLIを実行
npx tsx src/cli.ts wf list       # ソースから直接実行
```

## プロジェクト構成

```
src/           # TypeScriptソース
  cli.ts       # CLIエントリポイント
  types.ts     # 型定義
  engine/      # コアエンジン (ワークフロー、状態、バリデーション、ポリシー、アクション)
  commands/    # CLIコマンドハンドラー
  audit/       # 監査ログ
learn/         # ドキュメント (単一の信頼できる情報源 — `lrail docs`で提供)
agents/        # エージェント定義 (役割 + lrail docs参照)
skills/        # スキル定義 (行動ワークフロー + lrail docs参照)
builtins/      # ビルトインメタワークフロー
test/          # テスト (node:test)
```

## リファレンスドキュメント

スキーマの詳細、バリデーション演算子、ライフサイクルフックなどの技術リファレンスは `learn/` にあり、`lrail docs <topic>` でアクセスできます。内容を複製せず、常に `lrail docs` で参照してください。

主要トピック:

```bash
lrail docs concepts/step-types      # ステップタイプ (agentic / programmatic)
lrail docs concepts/validation      # バリデーション演算子
lrail docs concepts/actions         # アクションシステム
lrail docs concepts/policy          # ポリシー適用
lrail docs workflow/execution       # 実行手順
```

## 変更の作成

1. リポジトリをフォークし、フィーチャーブランチを作成します
2. テストとともに変更を作成します
3. `npm test` で検証します
4. `main` ブランチに対してPull Requestを提出します

### ドキュメントのメンテナンス

ソースコード変更時はドキュメントを同期してください:

| 変更箇所 | 更新対象 |
|---|---|
| CLIコマンド | `learn/workflow/execution.md`, `learn/workflow/first-run.md` |
| バリデーション演算子 | `learn/concepts/validation.md` |
| ステップタイプの動作 | `learn/concepts/step-types.md` |
| ポリシーの動作 | `learn/concepts/policy.md` |
| アクションの動作 | `learn/concepts/actions.md` |
| 型定義 | `agents/workflow-designer.md` スキーマ参照 |

**エージェントやスキルに概念説明を追加しないでください。** `learn/` に記載し、`lrail docs` で参照してください。

### コードコンベンション

- ESモジュールベースのTypeScript (`"type": "module"`)
- `js-yaml` 以外の外部ランタイム依存関係なし
- 関数はプレーンオブジェクトを返す — データ構造にクラスを使用しない
- CLI出力は `engine/output.ts` のフォーマッティングヘルパーを使用

### テスト

Node.jsビルトインテストランナー (`node:test`) を使用:

```bash
npm test                           # 全テスト実行
node --import tsx --test test/variant.test.ts   # 特定テストの実行
```

テストは `before`/`after` フックで一時ディレクトリを作成し、分離を確保します。

## コントリビューションを歓迎する分野

以下の分野でのコントリビューションを積極的に募集しています:

- **セキュリティモデル** — 構造的強制の強化、新しいアイソレーションパターンの探求
- **バリデーション演算子** — 一般的なユースケース向けの新しい演算子
- **プログラマティックステップパターン** — `shell:`、`js:` 以外の新しいアクションプリミティブ

## ライセンス

MIT — [LICENSE](../LICENSE) を参照
