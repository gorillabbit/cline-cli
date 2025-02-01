# CLI アプリケーション詳細実装計画

## 検討事項と詳細計画

### 1. コアロジックの特定とVS Code依存性の分離

- **API連携ロジック (`src/api`)**:  この部分はCLIアプリでも**ほぼそのまま**再利用可能です。`ApiHandler` インターフェースと各プロバイダーハンドラー (`AnthropicHandler`, `OpenAiHandler` など) は、VS Code API に直接依存していません。設定 (APIキーなど) のCLIからの受け渡し方法を検討する必要があります。
- **コアアプリケーションロジック (`src/core`)**:  `Cline` クラスは、VS Code 拡張機能の中心的なロジックを担っていますが、Webview や VS Code API との直接的な依存関係があります。
    - `ClineProvider` への依存を分離する必要があります。`Cline` クラスを**インターフェース** (`ClineInterface` など) と実装クラス (`ClineImpl` など) に分割し、`ClineImpl` は `ClineInterface` に依存するように変更します。
    - CLI アプリケーション用の新しい実装クラス (`CliCline` など) を作成し、`ClineInterface` を実装します。`CliCline` は、CLI 環境に特化した処理 (入出力、ツール実行など) を実装します。
- **共有ユーティリティ (`src/shared`, `src/utils`)**:  これらのユーティリティ関数は**そのまま**再利用可能です。
- **MCP連携 (`src/services/mcp`)**:  MCP連携機能はCLIアプリでも**有用**です。MCPサーバーとの通信ロジックは再利用可能です。MCP設定は、CLI引数 `--mcp-server-config` で設定ファイルパスを指定するか、環境変数で設定することを検討します。
- **ブラウザ連携 (`src/services/browser`)**:  CLI アプリケーションでは**ブラウザ連携機能は不要**です。
    - `src/services/browser` ディレクトリおよび関連するコード (`browser_action` ツール, `BrowserSession`, `UrlContentFetcher` など) を削除します。
    - `ApiConfiguration` からブラウザ関連の設定 (`browserSettings`) を削除します。
    - `Cline` クラスから `browserSession` プロパティとブラウザ関連のメソッド (`browserAction`, `launchBrowser`, `navigateToUrl` など) を削除します。
    - `SYSTEM_PROMPT` からブラウザ関連の記述を削除します。
    - ツール自動承認設定 (`AutoApprovalSettings`) からブラウザ関連の設定 (`browser_action`) を削除します。
    - ` ClineProvider` からブラウザ関連の処理を削除します。

### 2. VS Code依存性の分離の詳細

- **UI要素の置換**:
    - **ユーザーインタラクション**:  `ask` メソッドを CLI 環境に合わせて再実装します。`readline` モジュール等を用いて、コマンドラインプロンプトからの入力を受け付けるように変更します。`say` メソッドは、`console.log` などで標準出力にテキストを書き出すように変更します。
    - **差分表示**:  `DiffViewProvider` は CLI アプリケーションでは不要です。`replace_in_file` ツール実行後、`diff` コマンドを `child_process` で実行し、結果を標準出力に表示する関数 (`displayDiff` など) を `CliCline` に実装します。Node.js の `diff` ライブラリの利用も検討します。
- **ファイルシステムアクセスの置換**:  `vscode.workspace.fs` を `fs` モジュールに置き換える作業は比較的 straightforward です。`fs` モジュールを使用するようにコードを修正します。
- **VS Code統合機能の削除**:  `integrations` ディレクトリ以下の `checkpoints`, `debug`, `diagnostics`, `editor`, `notifications`, `theme`, `workspace`  は、CLI アプリケーションでは**基本的に不要**と判断し、削除または `#ifdef` で CLIビルドから除外します。
    - ただし、`terminal`  (`TerminalManager`, `TerminalProcess`, `TerminalRegistry`) は、CLI アプリケーションでも**再利用可能**です。`execute_command` ツール実行に利用します。
    - `misc` 内の汎用的な機能 (Markdownエクスポート, テキスト抽出, ファイルオープン) は、CLI アプリケーションでも**再利用可能**です。

### 3. CLIエントリポイント (`src/cli.ts`) の詳細

- **コマンドライン引数**:  `yargs` を採用し、以下の引数を定義します。
    - `--task <string>` (または `-t <string>`):  AI に実行させるタスク指示 (必須)
    - `--api-provider <string>`:  API プロバイダー (anthropic, openai, etc.) (オプション、デフォルトは anthropic)
    - `--api-key <string>`:  API キー (オプション、環境変数から取得も検討)
    - `--model <string>`:  モデル名 (オプション、デフォルトモデルを設定)
    - `--output-diff`:  差分出力を有効にするフラグ (オプション)
    - `--auto-approve`:  ツール自動承認を有効にするフラグ (オプション)
    - `--mcp-server-config <path>`: MCP サーバー設定ファイルパス (オプション)
    - `--log-level <level>`: ログレベル (オプション、デフォルトは info)
    - `--log-file <path>`: ログファイルパス (オプション、デフォルトは標準出力)
- **コアロジック初期化**:  `CliCline` クラスのインスタンスを生成し、コマンドライン引数で設定された API 設定、タスク指示などを渡します。VS Code 拡張機能コンテキストは不要になります。
- **CLIベースの入出力**:
    - 初期段階では、`readline` でユーザーからの指示入力を受け付けるプロンプトを実装します (デバッグ用、最終的には削除)。
    - `console.log` で AI の応答、ツール実行結果、エラーメッセージなどを標準出力に表示します。
    - 差分出力は、`diff` コマンドまたはライブラリで生成したテキストを `console.log` で出力します。
    - **エラーハンドリング**: CLI アプリケーションでのエラーハンドリングについて検討します。
        - API 呼び出しエラー、ツール実行エラー、その他のエラーが発生した場合、エラーメッセージを `console.error` で標準エラー出力に出力します。
        - エラーメッセージは、ユーザーが問題を特定しやすくするために、**詳細かつ明確**な内容とします。
        - 必要に応じて、エラーコードやリトライ方法などをエラーメッセージに含めることを検討します。
- **CLI環境でのツール実行**:
    - `execute_command` ツールは、`child_process.exec` または `child_process.spawn` でコマンドを実行し、出力を取得します。
    - 他のツール (`read_file`, `write_to_file`, `search_files`, `list_files`, `list_code_definition_names`, `use_mcp_tool`, `access_mcp_resource`) は、VS Code API 依存を排除した実装 (`fs` モジュール, MCP SDK, ripgrep サービスなど) を再利用します。
    - ツール承認は、`--auto-approve` フラグが指定された場合は自動承認とします。
        - CLI アプリケーションでは**ツール承認プロンプトは不要**と判断し、`--auto-approve` フラグが**常に有効** (自動承認) となるように実装を簡略化します。
    - **ロギング**: CLI アプリケーションでのロギングについて検討します。
        - `src/services/logging/Logger.ts` を再利用し、ログレベルを CLI 引数 (`--log-level <level>`) で設定できるようにします。
        - ログ出力先は、標準出力またはファイル (`--log-file <path>`) を選択できるようにします。
        - デフォルトのログレベルは `info` とし、`debug` レベルも必要に応じて利用できるようにします。

### 4. コードベースのリファクタリングの詳細

- **コマンドライン引数**:  `yargs` を採用し、以下の引数を定義します。
    - `--task <string>` (または `-t <string>`):  AI に実行させるタスク指示 (必須)
    - `--api-provider <string>`:  API プロバイダー (anthropic, openai, etc.) (オプション、デフォルトは anthropic)
    - `--api-key <string>`:  API キー (オプション、環境変数から取得も検討)
    - `--model <string>`:  モデル名 (オプション、デフォルトモデルを設定)
    - `--output-diff`:  差分出力を有効にするフラグ (オプション)
    - `--auto-approve`:  ツール自動承認を有効にするフラグ (オプション)
    - `--mcp-server-config <path>`: MCP サーバー設定ファイルパス (オプション)
- **コアロジック初期化**:  `CliCline` クラスのインスタンスを生成し、コマンドライン引数で設定された API 設定、タスク指示などを渡します。VS Code 拡張機能コンテキストは不要になります。
- **CLIベースの入出力**:
    - 初期段階では、`readline` でユーザーからの指示入力を受け付けるプロンプトを実装します (デバッグ用、最終的には削除)。
    - `console.log` で AI の応答、ツール実行結果、エラーメッセージなどを標準出力に表示します。
    - 差分出力は、`diff` コマンドまたはライブラリで生成したテキストを `console.log` で出力します。
    - **エラーハンドリング**: CLI アプリケーションでのエラーハンドリングについて検討します。
        - API 呼び出しエラー、ツール実行エラー、その他のエラーが発生した場合、エラーメッセージを `console.error` で標準エラー出力に出力します。
        - エラーメッセージは、ユーザーが問題を特定しやすくするために、**詳細かつ明確**な内容とします。
        - 必要に応じて、エラーコードやリトライ方法などをエラーメッセージに含めることを検討します。
- **CLI環境でのツール実行**:
    - `execute_command` ツールは、`child_process.exec` または `child_process.spawn` でコマンドを実行し、出力を取得します。
    - 他のツール (`read_file`, `write_to_file`, `search_files`, `list_files`, `list_code_definition_names`, `use_mcp_tool`, `access_mcp_resource`) は、VS Code API 依存を排除した実装 (`fs` モジュール, MCP SDK, ripgrep サービスなど) を再利用します。
    - ツール承認は、`--auto-approve` フラグが指定された場合は自動承認とします。
        - CLI アプリケーションでは**ツール承認プロンプトは不要**と判断し、`--auto-approve` フラグが**常に有効** (自動承認) となるように実装を簡略化します。

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
    ├── extension.ts      # VS Code 拡張機能のエントリーポイント (現状維持)
    ├── shared/
    └── utils/
    ```
- **インターフェース定義**:  `ClineInterface` を `src/lib/cline.ts` に定義し、`ClineImpl` と `CliCline` が実装します。ツール実行関連のインターフェース (`ToolExecutorInterface` など) の定義も検討します。
- **依存性注入**:  コンストラクタインジェクションなどを活用し、`Cline` クラス (および `CliCline`) の依存関係を明示的に管理します。DI コンテナライブラリの導入は、現時点では**オーバースペック**と判断し、手動 DI で進めます。

### 5. CLIアプリケーションのビルドの詳細

- `tsconfig.json`:  `compilerOptions.outDir` を `build` ディレクトリ、`compilerOptions.rootDir` を `src` ディレクトリに設定します。CLI アプリケーション用の `tsconfig.cli.json` を作成し、`extension.ts` と `cli.ts` で異なる設定 (module, target など) を指定することも検討します。**今回は単一の tsconfig.json で対応**します。
- `package.json`:
    ```json
    {
      "bin": {
        "cline-cli": "build/cli.js"  // CLI 実行可能ファイル
      },
      "scripts": {
        "build": "tsc && node -e \\"require('fs').chmodSync('build/cli.js', '755')\\"", // ビルドスクリプトを更新
        "build:cli": "tsc -p tsconfig.cli.json", // CLI アプリ専用ビルドスクリプト (必要に応じて)
        "dev": "vscode-test --extensionDevelopmentPath=. test/",
        "lint": "eslint src --ext ts",
        "watch": "tsc -w"
      },
      "devDependencies": { ... },
      "dependencies": {
        "yargs": "^17.7.2" // yargs を dependencies に追加
      }
    }
    ```
- ビルドスクリプト (`build`) を修正し、`tsc` コマンドで CLI アプリケーション (`src/cli.ts`) をビルドした後、実行可能属性を付与するようにします。

### 6. CLIアプリケーションのテストの詳細

- **テスト項目**:
    - コマンドライン引数 (`yargs`) のテスト:  `yargs` の API を利用して、引数解析のテストコードを `src/test/cli_args.test.ts` などに記述します。
    - CLI 実行テスト:  `child_process.execSync` などを用いて、CLI アプリケーションを実際に実行し、標準出力、差分出力、エラー出力を検証する統合テストを `src/test/cli.test.ts` などに記述します。
    - モック API サーバーを用いたAPI連携テスト:  `nock` などのライブラリを用いて、API リクエストをモックし、API 連携ロジックのテストを `src/test/api.test.ts` などに記述します。

## 実装スケジュール (概算)

1. **コアロジック特定とVS Code依存性分離**: 3日
2. **CLIエントリポイント作成**: 2日
3. **コードベースリファクタリング**: 3日
4. **CLIアプリケーションビルド**: 1日
5. **CLIアプリケーションテスト**: 3日

合計: 12日 (約2週間)

## 実装後の展望

CLI アプリケーションが完成した後、以下の展望が考えられます。

- **VS Code 拡張機能との連携**:  CLI アプリケーションを VS Code 拡張機能から呼び出す機能 (`execute_command` ツールで `cline-cli` コマンドを実行するなど) を検討します。これにより、VS Code から CLI アプリケーションの機能を利用できるようになり、より柔軟なワークフローが実現できます。
- **CI/CDパイプラインへの統合**:  CLI アプリケーションを CI/CD パイプラインに統合し、自動ビルド、テスト、デプロイを可能にすることを検討します。
- **パッケージマネージャーへの登録**:  CLI アプリケーションを npm や yarn などのパッケージマネージャーに登録し、`npm install -g cline-cli` などでグローバルにインストールできるようにすることを検討します。
- **ドキュメント整備**:  CLI アプリケーションのドキュメント (README, ヘルプメッセージ, etc.) を整備し、ユーザーが CLI アプリケーションを容易に利用できるようにします。
- **機能拡張**:  CLI アプリケーションに、VS Code 拡張機能にはない独自の機能 (例:  バッチ処理,  高度なファイル操作,  外部サービス連携) を追加することを検討します。

## 今後のステップ

この詳細実装計画に基づき、**1. コアロジックの特定とVS Code依存性の分離** から着手します。具体的には、`Cline` クラスのインターフェース (`ClineInterface`) 定義、実装クラス (`ClineImpl`, `CliCline`) のスケルトンコード作成、`ClineProvider` への依存性分離を行います。実装を進捗に合わせて計画を適宜修正していきます。