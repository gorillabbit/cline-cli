# Cline-CLI

Clineからフォークした、AIエージェントのためのCLIアプリケーション

## 特徴

*   CLIベースで動作
*   オリジナルのClineと比較してロジックを簡略化
*   ストリーミングではなく、完全なレスポンスを待機
*   人間によるフィードバックや確認を不要
*   AIエージェント向けに設計
*   会話履歴をSQLiteに保存

## インストール

```bash
npm install
npm run compile
```

## 使い方

```bash
npx node build/index.js /path/to/your/project "your prompt" gemini
```

*   `/path/to/your/project`: プロジェクトのパス
*   `"your prompt"`: AIエージェントへのプロンプト
*   `gemini`: 使用するAIプロバイダー

## 貢献

貢献は大歓迎です！

*   GitHub Issuesで問題を報告
*   新しい機能やバグ修正のプルリクエストを送信
*   プロジェクトのコードスタイルに従う

## ライセンス

MIT License

## 連絡先

modsyoukaizenryoku@gmail.com

## クレジット

take

## プロジェクトのステータス

開発中
