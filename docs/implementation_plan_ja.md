# VS Code拡張機能用CLIアプリケーション 実装計画 (CLI単独、Gemini優先)

## 目標
VS Code拡張機能と同様の機能を提供するCLIアプリケーションを、`src`ディレクトリのコードを再利用せずに、`cli-src`ディレクトリに独立して作成する。初期段階では、Gemini AIプロバイダーのみをサポートする。

## 実装アプローチ
`cli-src`ディレクトリを新規作成し、そこにCLIアプリケーションをゼロから実装する。`src`ディレクトリの既存コードは直接再利用しないが、機能と実装の詳細を理解するための参考として利用する。CLIアプリケーションは独立して動作するように設計し、初期段階ではGemini AIプロバイダーとの統合に焦点を当てる。

## CLIアプリケーションの構造
- `cli-src/cli.ts`: CLIアプリケーションのエントリーポイント。コマンドライン引数、コマンドルーティング、アプリケーション全体のフローを処理する。
- `cli-src/commands/`: CLIアプリケーションの各種コマンドを整理するディレクトリ。各コマンドは個別のファイルに配置する。
    - `cli-src/commands/chat.ts`: チャットセッションを開始するコマンド (`cline chat`)。チャット固有のロジック、チャットコマンドの引数解析、Gemini AIプロバイダーとのインタラクションを処理する。（参考: チャットセッションの開始とメッセージ処理ロジックについては `src/extension.ts`, `src/core/webview/ClineProvider.ts`）
    - `cli-src/commands/code.ts`: コード関連機能 (コード生成、リファクタリングなど) のコマンド (`cline code`)。コード固有のロジック、コードコマンドの引数解析、コード操作機能を処理する (初期段階では実装されない可能性がある)。（参考: コード関連コマンドの処理については `src/extension.ts`, `src/core/webview/ClineProvider.ts`）
    - `cli-src/providers/`: AIプロバイダー統合を処理するディレクトリ。
        - `cli-src/providers/gemini.ts`: Gemini AIプロバイダー固有の実装。APIインタラクション、レスポンス処理などを含む。（参考: Gemini APIのインタラクションとリクエスト/レスポンスのフォーマットについては `src/api/providers/gemini.ts`, `src/api/index.ts`）
    - ... (必要に応じて他のコマンド/プロバイダーを追加): CLIアプリケーションの拡張に伴い、新しいコマンドファイルやプロバイダー統合が追加される。

## CLIコマンドとオプション (詳細、Geminiに焦点)
- `cline chat`: 対話型チャットセッションを開始する。
    - **詳細オプション:**
        - `--model <model>` または `-m <model>`: 使用するGeminiモデルを指定する。例: `gemini-pro`, `gemini-ultra`。指定しない場合は、デフォルトのGeminiモデル (`gemini-pro`) が使用される。（参考: モデルオプションとデフォルトモデルについては `src/shared/ChatSettings.ts`）
        - `--context <path>` または `-c <path>`: チャットセッションのコンテキストをファイルまたはディレクトリから指定する。CLIは、指定されたファイルまたはディレクトリの内容を読み取り、チャットのコンテキストとして含める。（参考: コンテキスト処理ロジックについては `src/core/Cline.ts`）
- `cline code`: コードファイルの編集を含む、コード関連の操作を実行する。
    - **詳細オプション:**
        - `--generate <language>`: 特定のプログラミング言語でコードを生成する。ユーザーは、コード生成のためのプロンプトまたは指示も提供する必要がある (将来の実装)。
        - `--refactor <file>`: 指定されたファイルのコードをリファクタリングする。ユーザーは、指示または実行するリファクタリングの種類を指定する必要がある (将来の実装)。
        - `--write <path> --content <content>`: 指定されたパスに新しいファイルを作成し、指定されたコンテンツを書き込む。既存のファイルは上書きされる。
        - `--replace <path> --search <search_content> --replace_content <replace_content>`: 指定されたパスのファイル内で、最初に出現する `search_content` を `replace_content` で置換する。

## ユーザー入力と出力 (詳細)
- **入力:**
    - コマンドライン引数: CLIアプリケーションへの主要な入力方法。コマンド、オプション、ファイルパスなどを含む。引数解析には `commander` ライブラリを使用する。（参考: `cli-src/cli.ts` および `commander` のドキュメント）
    - 標準入力 (stdin): 対話型コマンド (`chat` など) では、ユーザーはstdinを介してチャットメッセージを提供できる。（参考: Node.js `process.stdin`）
- **出力:**
    - コンソール出力 (stdout): ユーザーへの主要な出力方法。
        - チャット応答、コード生成結果、コマンド実行フィードバックなどのプレーンテキスト出力。
        - 可読性を向上させ、重要な情報 (エラー、警告、コマンド名、Geminiの応答など) を強調するために `chalk` を使用することを検討する。（参考: `chalk` ライブラリのドキュメント）
    - 標準エラー出力 (stderr): エラーメッセージとデバッグ情報を表示するために使用する。（参考: Node.js `console.error`）

## エラー処理とロギング (詳細)
- **エラー処理:**
    - 潜在的な例外を処理し、アプリケーションのクラッシュを防ぐために、try-catchブロックを実装する。（参考: 標準的なJavaScriptの try-catch）
    - エラーが発生した場合、ユーザーに有益なエラーメッセージを提供し、問題の解決方法を指示する。
    - ユーザーエラー (無効な引数など) とシステムエラー (API接続の問題、Gemini APIエラーなど) を区別する。
- **ロギング:**
    - 基本的なロギングにはシンプルなロギングメカニズム (`console.log` など) を使用し、より高度なロギングが必要な場合は (`winston` や `pino` などのライブラリ) を検討する。
    - 開発とトラブルシューティングを支援するために、アプリケーションイベント、エラー、およびデバッグ情報をログに記録する。
    - ログの冗長性を制御するために、異なるログレベル (debug, info, warning, error など) のオプションを検討する。

## 詳細な手順 (Geminiに焦点)
1. **CLIプロジェクトのセットアップ:** (完了済み)
    - `cli-src` ディレクトリが存在し、必要なファイルと依存関係 (`package.json`, `tsconfig.json`, `cli.ts`, `typescript`, `ts-node`, `commander`, `@types/node`, `chalk`, `dotenv`) がインストールされていることを確認する。

2. **引数解析とコマンド構造の実装:** (`cli.ts` の修正、参考: `cli-src/cli.ts` および `commander` のドキュメント)
    - `cli-src/cli.ts` を修正して以下を行う:
        - `chat` コマンドから `--provider` オプションを削除する。
        - `chat` コマンドの `--model` および `--context` オプションを維持する。
        - `cline`, `chat`, `code` コマンドの説明を、Geminiに焦点を当てたCLI機能に合わせて更新する。
        - `chat` および `code` コマンドの基本的なアクションハンドラーを維持し、最初はコンソールにオプションを記録する。これらのアクションハンドラーは、後のステップでコマンドロジックを実装するために拡張される。

3. **Geminiプロバイダーの統合の実装:** (`cli-src/providers/gemini.ts` の作成、参考: `src/api/providers/gemini.ts`, `src/api/index.ts`)
    - `cli-src/providers` ディレクトリを作成する。
    - `cli-src/providers/gemini.ts` を作成する。
    - `gemini.ts` に、基本的なGemini APIインタラクションを実装する:
        - **`initGeminiClient(apiKey: string)` 関数:** この関数は、指定されたAPIキーを使用してGemini APIクライアントを初期化する。当面の間、APIキーはプレースホルダーまたはテスト用にハードコード化することができる。将来的には、APIキーは環境変数または設定ファイルから読み込まれるようにする。（参考: `@google/generative-ai` を使用したGemini APIクライアントの初期化については `src/api/providers/gemini.ts`）
        - **`sendChatMessage(client: GeminiAPIClient, model: string, message: string, context?: string)` 関数:** この関数は、Gemini APIクライアント、モデル名、ユーザーメッセージ、およびオプションのコンテキストを引数として取る。Gemini APIにチャットメッセージを送信し、応答を返す。初期段階では、この関数はプレースホルダー応答を返すか、モック応答をログに記録して、初期開発中に実際のAPI呼び出しを避けることができる。（参考: APIリクエストの構造とレスポンスの解析については `src/api/providers/gemini.ts` および `src/api/index.ts`）

4. **コア `chat` コマンドロジックの実装 (Gemini):** (`cli-src/commands/chat.ts` の修正、参考: `src/extension.ts`, `src/core/webview/ClineProvider.ts`)
    - `cli-src/commands` ディレクトリが存在しない場合は作成する。
    - `cli-src/commands/chat.ts` を作成する。
    - `chat.ts` に、`chat` コマンドのロジックを実装する:
        - `cli-src/providers/gemini.ts` から Geminiプロバイダー関数をインポートする。
        - `chat` コマンドのアクションハンドラーで以下を行う:
            - `commander` を使用して `--model` および `--context` オプションを解析する。
            - `process.stdin` を使用してstdinからユーザーのチャットメッセージを取得する。
            - `initGeminiClient()` を呼び出してGemini APIクライアントを初期化する (APIキーは当面プレースホルダー)。
            - `sendChatMessage()` を呼び出して、ユーザーメッセージをGemini APIに送信し、応答を取得する。
            - `console.log` を使用してGeminiの応答をコンソールに表示し、可読性を高めるために `chalk` を使用してスタイルを適用する。

5. **`chat` コマンドのユーザー入出力の実装 (Gemini):** (`cli-src/commands/chat.ts` の修正、参考: `src/core/Cline.ts`, Node.js `process.stdin`, `process.stdout`)
    - `cli-src/commands/chat.ts` を修正して以下を行う:
        - **コンテキストのロード:** `--context` オプションが指定されている場合は、指定されたファイルまたはディレクトリからコンテキストを読み込むロジックを実装する。当面の間、Node.js `fs` モジュールを使用して基本的なファイル読み込みを実装する。（参考: コンテキスト処理については `src/core/Cline.ts`、Node.js `fs` モジュールのドキュメント）
        - **対話型チャットループ:** `readline` モジュールまたは同様のアプローチを使用して対話型ループを実装し、以下を行う:
            - `process.stdout.write` または `console.log` を使用して、ユーザーにチャットメッセージの入力を促すプロンプトを表示する。
            - `process.stdin` を使用してstdinからユーザー入力を読み取る。
            - `sendChatMessage()` を使用してメッセージをGeminiに送信する。
            - スタイルを適用したGeminiの応答をコンソールに表示する。
            - ユーザーが終了するまで (例: `exit`、`quit` と入力するか、Ctrl+C を押す) ループを繰り返す。

6. **エラー処理と基本的なロギングの実装 (Gemini):** (`cli-src/providers/gemini.ts` および `cli-src/commands/chat.ts` の修正、参考: 標準的なJavaScriptの try-catch, Node.js `console.error`, `console.log`)
    - Gemini APIエラー (APIキーが無効、ネットワークエラー、モデルエラーなど) を処理するために、`gemini.ts` の `sendChatMessage()` 関数に try-catch ブロックを追加する。
    - コンテキストのロード、Gemini API呼び出し、または応答処理中のエラーを処理するために、`chat.ts` コマンドハンドラーに try-catch ブロックを追加する。
    - エラーが発生した場合、ユーザーフレンドリーなエラーメッセージを `console.error` を使用してstderrに出力する。
    - デバッグ目的で、APIリクエスト (メッセージ内容、モデル)、APIレスポンス (ステータスコード、応答時間)、および発生したエラーをログに記録するために `console.log` を使用する。

7. **テストとリファイン (Gemini):** (CLIを実行してテスト、参考: テストのベストプラクティス)
    - `cli-src` ディレクトリで `npm run build` を使用してCLIアプリケーションをビルドする。
    - `cli-src/build` ディレクトリから `node cli.js chat --model <gemini-model> --context <context-path>` を使用してCLIアプリケーションを実行する。
    - さまざまなGeminiモデル (`gemini-pro`, `gemini-ultra`)、コンテキスト入力 (テキストファイル、ディレクトリ)、およびチャットインタラクションをテストする。
    - テストとユーザーフィードバックに基づいて、チャットコマンドフロー、ユーザープロンプト、Gemini応答表示 (`chalk` によるスタイリング)、およびエラーメッセージをリファインする。

8. **基本的な `code` コマンドロジックの実装:** (当面はプレースホルダー、`cli-src/commands/code.ts` を修正)
    - `cli-src/commands/code.ts` が存在しない場合は作成する。
    - `code.ts` に、`cline code` が実行されたときに "code command not yet implemented" をコンソールにログ出力する基本的なアクションハンドラーを実装する。このコマンドは、将来のイテレーションで拡張できる。

9. **CLI使用方法のドキュメント化 (Geminiに焦点):** (`cli-src` の `README.md` を更新、参考: Markdown構文、ドキュメント作成のベストプラクティス)
    - `cli-src` ディレクトリに `README.md` ファイルを作成または更新する。
    - CLIアプリケーションのインストール、ビルド、および実行方法をドキュメント化する。
    - `chat` コマンドについて、以下を含む詳細なドキュメントを作成する:
        - コマンド構文: `cline chat [options]`
        - オプション: `--model`, `--context` (およびそれらの説明)
        - 使用例: `cline chat --model gemini-pro`, `cline chat --model gemini-ultra --context ./docs`
        - 期待される入力と出力。
    - `code` コマンドを将来の機能として簡単に言及する。

## 今後の検討事項
- より多くのAIプロバイダーのサポートを追加する (例: OpenAI, Anthropic)。
- `code` コマンドのフル機能を実装する (コード生成、リファクタリング、コード解説など)。
- APIキー、デフォルトモデル、その他の設定を保存するための設定ファイル (`cline.config.json` など) を実装する。
- エラー処理、ロギング (ファイルへのロギングなど)、およびユーザーフィードバック (進捗インジケーター、より有益なメッセージなど) を改善する。
- CLIアプリケーションをスタンドアロン実行可能ファイルまたはnpmパッケージとしてパッケージ化して配布する。
