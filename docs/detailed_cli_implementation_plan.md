# CLI アプリケーション詳細実装計画

## 検討事項と詳細計画

### 1. コアロジックの特定とCLI依存性の分離

- **API連携ロジック (`src/api`)**:  この部分はCLIアプリでも**ほぼそのまま**再利用可能です。`ApiHandler` インターフェースと各プロバイダーハンドラー (`AnthropicHandler`, `OpenAiHandler` など) は、CLI 環境に直接依存していません。設定 (APIキーなど) のCLIからの受け渡し方法を検討する必要があります。
- **コアアプリケーションロジック (`src/core`)**:  `Cline` クラスは、アプリケーションの中心的なロジックを担っていますが、現在の実装は VS Code 拡張機能として動作することを前提としています。**CLIアプリケーションとして `Cline` クラスを独立させるためには、以下の修正が必要です。**
    - **不要な依存性の分離**:
        - 現在の `Cline` クラスは、VS Code 拡張機能固有の機能に依存している可能性があります。CLI アプリケーションには不要なこれらの依存関係を分離する必要があります。
        - 具体的には、`Cline` クラスから CLI アプリケーションに不要な部分を抽出し、**インターフェース** (`ClineInterface` など) として定義します。
        - `Cline` クラスは、このインターフェースにのみ依存するように変更します。
    - **`Cline` クラスの分割とCLI実装**:
        - `Cline` クラスを**インターフェース** (`ClineInterface`) と**CLI実装クラス** (`CliCline`) に分割します。
        - `CliCline` クラスは、CLI アプリケーションとして動作する `Cline` の具体的な実装を担い、`ClineInterface` を実装します。
        - `CliCline` は、CLI 環境に特化した処理 (入出力、ツール実行、ファイルシステムアクセスなど) を実装し、CLI 環境以外の依存性を持たないようにします。
        - これにより、コアロジックは `ClineInterface` を通じて抽象化され、CLI アプリケーションとして独立して動作可能になります。
- **共有ユーティリティ (`src/shared`, `src/utils`)**:  これらのユーティリティ関数は**そのまま**再利用可能です。
- **MCP連携 (`src/services/mcp`)**:  MCP連携機能はCLIアプリでも**有用**です。MCPサーバーとの通信ロジックは再利用可能です。MCP設定は、CLI引数 `--mcp-server-config` で設定ファイルパスを指定するか、環境変数で設定することを検討します。
- **ブラウザ連携 (`src/services/browser`)**:  CLI アプリケーションでは**ブラウザ連携機能は不要**です。以下のものを削除します。
    1. `src/services/browser` ディレクトリを**削除**します。
        - `src/services/browser` ディレクトリ
        - `src/services/browser/browser_action.ts`
        - `src/services/browser/BrowserSession.ts`
        - `src/services/browser/UrlContentFetcher.ts`
    2. `ApiConfiguration` からブラウザ関連の設定 (`browserSettings`) を**削除**します。
        - `src/shared/BrowserSettings.ts` ファイルを**削除**します。
        - `src/shared/Api.ts` の `ApiConfiguration` インターフェースから `browserSettings?: BrowserSettings;` を**削除**します。
    3. `Cline` クラス (`src/core/Cline.ts`) から以下のプロパティとメソッドを**削除**します。
        - `private browserSession: BrowserSession | undefined;` プロパティを**削除**します。
        - `async browserAction(args: BrowserActionToolArgs): Promise<string | ErrorResponse>` メソッドを**削除**します。
        - `private async launchBrowser(): Promise<void>` メソッドを**削除**します。
        - `private async navigateToUrl(url: string): Promise<void>` メソッドを**削除**します。
        - `constructor` から `this.browserSession = new BrowserSession(this.logger);` の初期化処理を**削除**します。
    4. `SYSTEM_PROMPT` (`src/core/prompts/system.ts`) からブラウザ関連の記述を**削除**します。
        - `BROWSER_TOOL_DESCRIPTION` 定数を**削除**します。
        - `SYSTEM_PROMPT` 変数から `\${BROWSER_TOOL_DESCRIPTION}` の記述を**削除**します。
    5. ツール自動承認設定 (`AutoApprovalSettings` - `src/shared/AutoApprovalSettings.ts`) からブラウザ関連の設定 (`browser_action`) を**削除**します。
        - `AutoApprovalSettings` インターフェースから `browser_action: boolean;` を**削除**します。
    6. `ClineProvider` (`src/core/webview/ClineProvider.ts`) からブラウザ関連の処理を**削除**します。
        - `handleBrowserActionTool` メソッドを**削除**します。
        - `postBrowserActionResponse` メソッドを**削除**します。
        - `postLaunchBrowser` メソッドを**削除**します。
        - `postNavigateToUrl` メソッドを**削除**します。
        - `cleanupBrowserSession` メソッドを**削除**します。
        - `dispose` メソッドから `this.cleanupBrowserSession();` の呼び出しを**削除**します。
        - `constructor` から `this.browserSession = new BrowserSession(this.logger);` の初期化処理を**削除**します。
        - `_onDidDispose` メソッドから `this.cleanupBrowserSession();` の呼び出しを**削除**します。

### 2. CLI依存性の分離の詳細

- **UI要素の置換**:
    1. **ユーザーインタラクション**:  `ask` メソッドを CLI 環境に合わせて再実装します。`readline` モジュール等を用いて、コマンドラインプロンプトからの入力を受け付けるように変更します。`say` メソッドは、`console.log` などで標準出力にテキストを書き出すように変更します。
    2. **差分表示**:  CLI アプリケーションでは、VS Code のようなGUI差分表示は不要です。`replace_in_file` ツール実行後、`diff` コマンドを `child_process` で実行し、結果を標準出力に表示する関数 (`displayDiff` など) を `CliCline` に実装します。Node.js の `diff` ライブラリの利用も検討します。
- **UI要素の置換**:  `CliCline` クラス (`src/lib/cline.ts`) で以下のメソッドを**書き換え**ます。
    1. `async ask(prompt: string): Promise<string>` メソッドを**書き換え**ます。
        - `readline.question` を使用して、コマンドラインプロンプトに `prompt` を表示し、ユーザーからの入力を取得するように実装します。
    2. `say(message: string): void` メソッドを**書き換え**ます。
        - `console.log(message)` を使用して、`message` を標準出力に表示するように実装します。
    3. `private async displayDiff(filePath: string, originalContent: string, modifiedContent: string): Promise<void>` メソッドを**新規作成**します。
        - `diff` ライブラリ (`import { diff } from 'diff';`) または `child_process.exec('diff ...')` を使用して、`originalContent` と `modifiedContent` の差分を計算し、標準出力に表示するように実装します。
        - 差分表示のフォーマットは、`git diff` の出力に**類似**した形式 (unified diff format) を採用します。
        - 色分け表示は、`chalk` などのライブラリ (`import chalk from 'chalk';`) を用いて**実装を検討**します (必須ではありません)。


- **ファイルシステムアクセスの置換**:  `vscode.workspace.fs` を Node.js の `fs` モジュールに置き換えます。`fs` モジュールを使用するようにコードを修正します。
- **不要な機能の削除**:  `integrations` ディレクトリ以下の `checkpoints`, `debug`, `diagnostics`, `editor`, `notifications`, `theme`, `workspace`  は、CLI アプリケーションでは**基本的に不要**と判断し、削除します。
    - ただし、`terminal`  (`TerminalManager`, `TerminalProcess`, `TerminalRegistry`) は、CLI アプリケーションでも**再利用可能**です。`execute_command` ツール実行に利用します。
    - `misc` 内の汎用的な機能 (Markdownエクスポート, テキスト抽出, ファイルオープン) は、CLI アプリケーションでも**再利用可能**です。

### 3. CLIエントリポイント (`src/cli.ts`) の詳細

- **コマンドライン引数**:  `yargs` を採用し、以下の引数を定義します。
    1. `--task <string>` (または `-t <string>`):  AI に実行させるタスク指示 (必須)
    2. `--api-provider <string>`:  API プロバイダー (anthropic, openai, etc.) (オプション、デフォルトは anthropic)
    3. `--api-key <string>`:  API キー (オプション、環境変数から取得も検討)
    4. `--model <string>`:  モデル名 (オプション、デフォルトモデルを設定)
    5. `--output-diff`:  差分出力を有効にするフラグ (オプション)
    6. `--auto-approve`:  ツール自動承認を有効にするフラグ (オプション)
    7. `--mcp-server-config <path>`: MCP サーバー設定ファイルパス (オプション)
    8. `--log-level <level>`: ログレベル (オプション、デフォルトは info)
    9. `--log-file <path>`: ログファイルパス (オプション、デフォルトは標準出力)
- **コアロジック初期化**:  `CliCline` クラスのインスタンスを生成し、コマンドライン引数で設定された API 設定、タスク指示などを渡します。
- **CLIベースの入出力**:
    1. 初期段階では、`readline` でユーザーからの指示入力を受け付けるプロンプトを実装します (デバッグ用、最終的には削除)。
    2. `console.log` で AI の応答、ツール実行結果、エラーメッセージなどを標準出力に表示します。
    3. 差分出力は、`diff` コマンドまたはライブラリで生成したテキストを `console.log` で出力します。
    - **エラーハンドリング**: CLI アプリケーションでのエラーハンドリングについて検討します。
        1. API 呼び出しエラー、ツール実行エラー、その他のエラーが発生した場合、エラーメッセージを `console.error` で標準エラー出力に出力します。
        2. エラーメッセージは、ユーザーが問題を特定しやすくするために、**詳細かつ明確**な内容とします。
        3. 必要に応じて、エラーコードやリトライ方法などをエラーメッセージに含めることを検討します。
- **CLI環境でのツール実行**:
    1. `execute_command` ツールは、`child_process.exec` または `child_process.spawn` でコマンドを実行し、出力を取得します。
    2. 他のツール (`read_file`, `write_to_file`, `search_files`, `list_files`, `list_code_definition_names`, `use_mcp_tool`, `access_mcp_resource`) は、VS Code API 依存を排除した実装 (`fs` モジュール, MCP SDK, ripgrep サービスなど) を再利用します。
    3. ツール承認は、`--auto-approve` フラグが指定された場合は自動承認とします。
        - CLI アプリケーションでは**ツール承認プロンプトは不要**と判断し、`--auto-approve` フラグが**常に有効** (自動承認) となるように実装を簡略化します。
    - **ロギング**: CLI アプリケーションでのロギングについて検討します。
        1. `src/services/logging/Logger.ts` を再利用し、ログレベルを CLI 引数 (`--log-level <level>`) で設定できるようにします。
        2. ログ出力先は、標準出力またはファイル (`--log-file <path>`) を選択できるようにします。
        3. デフォルトのログレベルは `info` とし、`debug` レベルも必要に応じて利用できるようにします。

### 4. コードベースのリファクタリングの詳細

- **ディレクトリ構成**:
    ```
    src/
    ├── lib/              # CLI アプリケーションのコアロジック (VS Code 非依存)
    │   ├── cline.ts      # ClineInterface, ClineImpl, CliCline (CLI実装)
    │   ├── api/          # API 関連 (handlers, transform)
    │   ├── core/         # core ロジック (assistant-message, mentions, prompts, sliding-window)
    │   └── services/      # services (auth, browser (CLI実装検討), glob, logging, mcp, ripgrep, tree-sitter)
    ├── cli.ts            # CLI アプリケーションのエントリーポイント
    ├── extension.ts      # VS Code 拡張機能のエントリーポイント (現状維持)  <- CLIアプリでは削除
    ├── shared/
    └── utils/
    ```
- **インターフェース定義**:  `ClineInterface` を `src/lib/cline.ts` に定義し、`ClineImpl` は削除、`CliCline` が実装します。ツール実行関連のインターフェース (`ToolExecutorInterface` など) の定義も検討します。
- **依存性注入**:  コンストラクタインジェクションなどを活用し、`CliCline` クラスの依存関係を明示的に管理します。DI コンテナライブラリの導入は、現時点では**オーバースペック**と判断し、手動 DI で進めます。

### 5. CLIアプリケーションのビルドの詳細

1. `tsconfig.json`:  `compilerOptions.outDir` を `build` ディレクトリ、`compilerOptions.rootDir` を `src` ディレクトリに設定します。CLI アプリケーション用の `tsconfig.cli.json` を作成し、`cli.ts` のみをビルド対象とすることも検討します。**今回は単一の tsconfig.json で対応**します。
2. `package.json`:
    ```json
    {
      "bin": {
        "cline-cli": "build/cli.js"  // CLI 実行可能ファイル
      },
      "scripts": {
        "build": "tsc && node -e \\"require('fs').chmodSync('build/cli.js', '755')\\"", // ビルドスクリプトを更新
        "build:cli": "tsc -p tsconfig.cli.json", // CLI アプリ専用ビルドスクリプト (必要に応じて) <- CLIアプリでは不要
        "dev": "vscode-test --extensionDevelopmentPath=. test/",  // <- CLIアプリでは不要
        "lint": "eslint src --ext ts",
        "watch": "tsc -w" // ビルドスクリプトを更新
      },
      "devDependencies": { ... },
      "dependencies": {
        "yargs": "^17.7.2" // yargs を dependencies に追加
      }
    }
    ```
3. ビルドスクリプト (`build`) を修正し、`tsc` コマンドで CLI アプリケーション (`src/cli.ts`) をビルドした後、実行可能属性を付与するようにします。

### 6. CLIアプリケーションのテストの詳細

- **テスト項目**:
    1. コマンドライン引数 (`yargs`) のテスト:  `yargs` の API を利用して、引数解析のテストコードを `src/test/cli_args.test.ts` などに記述します。
    2. CLI 実行テスト:  `child_process.execSync` などを用いて、CLI アプリケーションを実際に実行し、標準出力、差分出力、エラー出力を検証する統合テストを `src/test/cli.test.ts` などに記述します。
    3. モック API サーバーを用いたAPI連携テスト:  `nock` などのライブラリを用いて、API リクエストをモックし、API 連携ロジックのテストを `src/test/api.test.ts` などに記述します。

## 実装スケジュール (概算)

1. **コアロジック特定とCLI依存性分離**: 3日
2. **CLIエントリポイント作成**: 2日
3. **コードベースリファクタリング**: 3日
4. **CLIアプリケーションビルド**: 1日
5. **CLIアプリケーションテスト**: 3日

合計: 12日 (約2週間)

## 実装後の展望

1. **VS Code 拡張機能との連携**:  CLI アプリケーションを VS Code 拡張機能から呼び出す機能 (`execute_command` ツールで `cline-cli` コマンドを実行するなど) を検討します。これにより、VS Code から CLI アプリケーションの機能を利用できるようになり、より柔軟なワークフローが実現できます。 **<- CLIアプリ単独のため、この項目は削除**
2. **CI/CDパイプラインへの統合**:  CLI アプリケーションを CI/CD パイプラインに統合し、自動ビルド、テスト、デプロイを可能にすることを検討します。
3. **パッケージマネージャーへの登録**:  CLI アプリケーションを npm や yarn などのパッケージマネージャーに登録し、`npm install -g cline-cli` などでグローバルにインストールできるようにすることを検討します。
4. **ドキュメント整備**:  CLI アプリケーションのドキュメント (README, ヘルプメッセージ, etc.) を整備し、ユーザーが CLI アプリケーションを容易に利用できるようにします。
5. **機能拡張**:  CLI アプリケーションに、VS Code 拡張機能にはない独自の機能 (例:  バッチ処理,  高度なファイル操作,  外部サービス連携) を追加することを検討します。

## 今後のステップ

1. この詳細実装計画に基づき、**1. コアロジックの特定とCLI依存性の分離** から着手します。具体的には、`Cline` クラスのインターフェース (`ClineInterface`) 定義、CLI実装クラス (`CliCline`) のスケルトンコード作成、不要な依存性分離を行います。
2. 実装を進捗に合わせて計画を適宜修正していきます。
