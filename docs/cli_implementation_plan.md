# CLINE-cli 実装計画 (詳細版)

CLINE-cliに必要な機能をリストアップした `docs/cli_features_list.md` を元に、機能を上から順番に実装していく詳細な計画をまとめました。各ステップで参照する `src` コード、作成するファイル、処理内容を記載し、大きなステップごとにファイルを分割して記述します。また、それぞれの参考箇所と、それの `cli-src` での記述においてVSCode拡張機能からCLIアプリに変わることで記述が変わる箇所も追記します。

`src`コードは変更しません。

## 実装順序

1.  **段階的な複雑なソフトウェア開発タスクの実行**
2.  **ファイルの作成と編集**
3.  **大規模プロジェクトの探索**
4.  **ターミナルコマンドの実行**
5.  **ファイル構造、ソースコードAST解析、正規表現検索、関連ファイル読込**
6.  **大規模プロジェクトのコンテキスト管理**
7.  **リンター/コンパイラーエラーの監視と修正**
8.  **ターミナル出力の監視と対応**
9.  **多様なAPIとモデルの利用**
10. **トークンとAPI使用コストの追跡**
11. **ターミナルでのコマンド実行機能全般**
12. **MCPカスタムツール機能全般**
13. **コンテキスト付与機能: `@file`, `@folder`**
14. **Model Context Protocol (MCP) によるツール拡張**

## 各機能の詳細実装計画

### 1. 段階的な複雑なソフトウェア開発タスクの実行

*   **概要:** ユーザーからの複雑な要求を理解し、複数のステップに分解して実行する機能。
*   **参照コード (`src`):**
    *   `src/core/Cline.ts`:  Clineのコアロジック、タスク実行フローの管理。タスクのステップ分解、ステップ実行のオーケストレーションを担っています。
    *   `src/core/assistant-message/`: アシスタントからのメッセージ解析、ステップ分解に関連する処理。特に `parse-assistant-message.ts` は、アシスタントのメッセージから意図を解釈し、ステップに変換するロジックを含んでいます。
*   **`cli-src` での変更点:**
    *   `src/core/Cline.ts` は、VSCode APIに依存する部分 (エディタ操作、Webview通信など) を抽象化する必要があります。`cli-src/core/TaskRunner.ts` は、これらの抽象化されたインターフェースを利用し、CLI環境に特化したタスク実行フローを実装します。
    *   `src/core/assistant-message/` のメッセージ解析ロジックは、基本的には `cli-src` でも再利用可能ですが、出力形式 (Markdown -> CLIテキスト) などを考慮した調整が必要になる場合があります。
*   **ファイル:**
    *   `cli-src/core/TaskRunner.ts` (新規作成):  CLI環境でのタスク実行を管理するクラス。`src/core/Cline.ts` のCLI版として、タスクの開始、ステップの逐次実行、状態管理、ユーザーインタラクション (CLIプロンプト) を実装します。
    *   `cli-src/core/StepExecutor.ts` (新規作成): 各ステップを実行するロジックを実装するインターフェースと実装クラス。`src/core/Cline.ts` 内のステップ実行ロジックを参考に、CLI環境に合わせたExecutorを実装します。
*   **処理内容:**
    1.  **`cli-src/core/TaskRunner.ts`**:
        *   `runTask(taskDescription: string)` メソッド:  ユーザーからのタスク記述を受け取り、ステップ実行を開始します。`src/core/Cline.ts` の `run` メソッドに相当しますが、CLI入力 (例: `readline`) を使用してタスク記述を受け取るように変更します。
        *   タスクの状態管理 (初期状態、実行中、完了、エラーなど) を実装。`src/core/Cline.ts` の `state` を参考に、CLI環境での状態管理を実装します。
        *   `StepExecutor` を利用して各ステップを実行し、状態を更新します。`src/core/Cline.ts` の `_executeTaskStep` メソッドを参考に、CLI版のステップ実行ロジックを実装します。
        *   ユーザーへの進捗報告、承認フローを実装 (CLIプロンプトでのインタラクション)。VSCodeのGUI通知の代わりに、CLIプロンプトで質問や承認を求め、ユーザーの入力を `readline` で受け取るようにします。
    2.  **`cli-src/core/StepExecutor.ts`**:
        *   `executeStep(step: Step)` メソッド (インターフェース): 各ステップの実行ロジックを定義するインターフェース。`src/core/Cline.ts` の `executeStep` メソッドを参考に、CLI版インターフェースを定義します。
        *   `DefaultStepExecutor` (実装クラス):  基本的なステップ実行ロジック (例: ファイル操作、コマンド実行など) を実装。`src/core/Cline.ts` の `DefaultStepExecutor` を参考に、CLI版実装を行います。
        *   ステップの種類に応じて異なるExecutorを実装 (例: `FileEditStepExecutor`, `CommandStepExecutor`)。`src/core/Cline.ts` にある各ステップ Executor (例: `FileEditStepExecutor`, `CommandStepExecutor`) を参考に、CLI版を実装します。
    3.  **ステップ分解ロジック**:
        *   `src/core/Cline.ts` のロジックを参考に、CLI環境に合わせたステップ分解ロジックを実装。`src/core/Cline.ts` の `_createInitialPlan` メソッド、`_refinePlan` メソッドなどを参考に、CLI版のステップ分解ロジックを実装します。
        *   初期段階ではシンプルなステップ分解ルール (例: ファイル操作、コマンド実行をステップとして認識) から開始。

### 2. ファイルの作成と編集

*   **概要:**  ユーザーの指示に基づき、新しいファイルを作成したり、既存のファイルの内容を編集したりする機能。
*   **参照コード (`src`):**
    *   `src/services/fs/`: ファイルシステム操作関連の処理 (ファイル読み書き、存在確認など)。`fs.ts` はファイル操作の基本的なAPIを提供します。
    *   `src/core/Cline.ts`: `write_to_file`, `replace_in_file` ツールの利用箇所。`_executeTaskStep` メソッド内で、これらのツールを呼び出してファイル操作を実行しています。
*   **`cli-src` での変更点:**
    *   `src/services/fs/` のファイルシステム操作APIは、Node.jsの `fs` モジュールをラップしているため、`cli-src` でもほぼそのまま再利用可能です。
    *   `cli-src/tools/fs.ts` は、`write_to_file`, `replace_in_file` ツールを直接呼び出すのではなく、`src/services/fs/` のAPIを間接的に利用する形になる可能性があります。これは、CLI環境ではバックエンドサービス (tools) が必ずしも必要ではないためです。
    *   ユーザーへの承認フロー、フィードバック表示は、CLIプロンプトで行うように変更します。
*   **ファイル:**
    *   `cli-src/tools/fs.ts` (新規作成):  CLI環境でファイル作成・編集ツールを実装します。`src/core/Cline.ts` の `_executeTaskStep` メソッド内での `write_to_file`, `replace_in_file` ツールの呼び出しを参考に、CLI版ツールを実装します。
*   **処理内容:**
    1.  **`cli-src/tools/fs.ts`**:
        *   `writeFile(path: string, content: string)` 関数:  `src/services/fs/` のAPI (`fs.writeFile`) を利用して、ファイルを作成または上書きします。`src/core/Cline.ts` の `_writeFile` メソッドを参考に、CLI版を実装します。
        *   `replaceInFile(path: string, diff: string)` 関数:  `src/services/fs/` のAPI (`fs.readFile`, `fs.writeFile`) とdiff解析ライブラリ (`src/core/assistant-message/diff.ts` など) を利用して、ファイルの一部を置換します。`src/core/Cline.ts` の `_replaceInFile` メソッドを参考に、CLI版を実装します。
        *   ツール呼び出し前にユーザーに承認を求める処理を実装 (CLIプロンプト)。`src/core/Cline.ts` の `_confirmAction` メソッドを参考に、CLIプロンプトで承認を求める処理を実装します。
        *   ツール実行結果をユーザーにフィードバックする処理を実装 (CLIメッセージ)。VSCodeの通知の代わりに、`console.log` などでCLIメッセージを表示します。
    2.  **`cli-src/core/StepExecutor.ts`**:
        *   `FileEditStepExecutor` (新規作成):  `StepExecutor` インターフェースの実装クラス。`src/core/Cline.ts` の `FileEditStepExecutor` を参考に、CLI版を実装します。
        *   `executeStep(step: FileEditStep)` メソッド:  ファイル作成・編集ステップを実行します。`cli-src/tools/fs.ts` のツールを利用してファイル操作を実行します。`src/core/Cline.ts` の `FileEditStepExecutor.executeStep` メソッドを参考に、CLI版を実装します。
        *   ファイル操作の結果をステップの状態として管理します。`src/core/Cline.ts` のステップ状態管理を参考に、CLI版を実装します。

### 3. 大規模プロジェクトの探索

*   **概要:**  大規模なプロジェクトのファイル構造を把握し、必要なファイルや情報を効率的に見つけ出す機能。
*   **参照コード (`src`):**
    *   `src/services/glob/list-files.ts`:  `list_files` ツールの実装。Node.jsの `glob` パッケージと `fs.promises.readdir` を利用してファイルリストを取得しています。
    *   `src/core/Cline.ts`:  プロジェクト探索、ファイルリスト表示に関連する処理。`_executeTaskStep` メソッド内で `list_files` ツールを呼び出し、ファイルリストを取得・表示しています。
*   **`cli-src` での変更点:**
    *   `src/services/glob/list-files.ts` のファイルリスト取得ロジックは、`cli-src` でもほぼそのまま再利用可能です。
    *   `cli-src/tools/projectExplorer.ts` は、`list_files` ツールを直接呼び出すのではなく、`src/services/glob/list-files.ts` のAPIを直接利用する形になる可能性があります。
    *   ファイルツリー表示UI (`cli-src/ui/ProjectTreeView.ts`) は、VSCodeのTreeView APIの代わりに、CLIテキストベースのUIを実装する必要があります。カーソル操作、ディレクトリの展開・折りたたみなど、CLI環境での操作性を考慮したUI設計が重要になります。
*   **ファイル:**
    *   `cli-src/tools/projectExplorer.ts` (新規作成):  CLI環境でのプロジェクト探索ツールを実装します。`src/core/Cline.ts` の `_executeTaskStep` メソッド内での `list_files` ツールの呼び出しを参考に、CLI版ツールを実装します。
    *   `cli-src/ui/ProjectTreeView.ts` (新規作成):  CLI環境でのファイルツリー表示UIを実装します。VSCodeのTreeViewのようなGUIベースのUIではなく、テキストベースでファイルツリーを表現し、CLI上で操作できるUIを設計・実装します。
*   **処理内容:**
    1.  **`cli-src/tools/projectExplorer.ts`**:
        *   `listProjectFiles(path: string, recursive: boolean)` 関数:  `src/services/glob/list-files.ts` のAPI (`listFiles`) を利用して、プロジェクトのファイルリストを取得します。`src/core/Cline.ts` の `_listProjectFiles` メソッドを参考に、CLI版を実装します。
        *   ファイルリストを解析し、ディレクトリ構造をツリー形式のテキストデータに変換する処理。取得したファイルリストを元に、インデントや記号 (`-`, `+`) を用いて階層構造を表現するテキストデータを作成します。
    2.  **`cli-src/ui/ProjectTreeView.ts`**:
        *   `renderTreeView(treeData: TreeNode)` 関数:  ツリー形式のテキストデータをCLI上に表示します。`console.log` を利用してテキストデータを出力し、ANSIエスケープコード (chalk, kleur など) を利用して色分けや装飾を行うことを検討します。
        *   カーソル移動、ディレクトリ展開・折りたたみなどの基本的なUI操作を実装 (CLIキー入力処理)。Node.js の `process.stdin` をraw modeで読み込み、キー入力を解析してカーソル移動やディレクトリ操作を実装します。ディレクトリの展開・折りたたみ状態は、TreeNodeデータに保持し、再描画時に状態を反映させます。
    3.  **`cli-src/core/TaskRunner.ts`**:
        *   プロジェクト探索ステップ (`ProjectExploreStep` など) を定義。ステップの定義は `src/core/Cline.ts` のステップ定義 (`ProjectExploreStep` など) を参考にします。
        *   `DefaultStepExecutor` または専用の `ProjectExploreStepExecutor` でステップを実行。ステップ実行ロジックは `src/core/Cline.ts` の `DefaultStepExecutor` や `ProjectExploreStepExecutor` を参考に、CLI版を実装します。
        *   `cli-src/tools/projectExplorer.ts` と `cli-src/ui/ProjectTreeView.ts` を連携させてファイルツリーを表示。ステップ実行後、`cli-src/ui/ProjectTreeView.ts` を利用してファイルツリーをCLIに表示し、ユーザーが操作できるようにします。

### 4. ターミナルコマンドの実行

*   **概要:**  ユーザーの指示に基づき、ターミナルコマンドを実行し、その結果をCLINE-cliで確認できる機能。
*   **参照コード (`src`):**
    *   `src/services/ripgrep/index.ts`:  `execute_command` ツールの実装 (バックエンド側の処理)。`child_process.spawn` を利用してコマンドを実行し、標準出力・標準エラー出力を取得しています。
    *   `src/core/Cline.ts`:  `execute_command` ツールの利用箇所、ターミナル出力処理。`_executeTaskStep` メソッド内で `execute_command` ツールを呼び出し、ターミナル出力を処理・表示しています。
*   **`cli-src` での変更点:**
    *   `src/services/ripgrep/index.ts` のコマンド実行ロジックは、`cli-src` でもほぼそのまま再利用可能です。
    *   `cli-src/tools/terminal.ts` は、`execute_command` ツールを直接呼び出すのではなく、`src/services/ripgrep/index.ts` のAPIを直接利用する形になる可能性があります。
    *   ターミナル出力表示UI (`cli-src/ui/TerminalView.ts`) は、VSCodeのTerminal APIの代わりに、CLIテキストベースのUIを実装する必要があります。リアルタイム出力、スクロール、色分け表示など、CLI環境でのターミナル表示を考慮したUI設計が重要になります。
*   **ファイル:**
    *   `cli-src/tools/terminal.ts` (新規作成):  CLI環境でターミナルコマンド実行ツールを実装します。`src/core/Cline.ts` の `_executeTaskStep` メソッド内での `execute_command` ツールの呼び出しを参考に、CLI版ツールを実装します。
    *   `cli-src/ui/TerminalView.ts` (新規作成):  CLI環境でのターミナル出力表示UIを実装します。VSCodeのTerminalのようなGUIベースのUIではなく、テキストベースでターミナル出力を表示し、必要に応じてスクロールできるUIを設計・実装します。
*   **処理内容:**
    1.  **`cli-src/tools/terminal.ts`**:
        *   `executeCommand(command: string)` 関数:  `src/services/ripgrep/index.ts` のAPI (`executeCommand`) を利用して、コマンドを実行します。`src/core/Cline.ts` の `_executeCommand` メソッドを参考に、CLI版を実装します。
        *   コマンド実行前にユーザーに承認を求める処理を実装 (CLIプロンプト)。`src/core/Cline.ts` の `_confirmAction` メソッドを参考に、CLIプロンプトで承認を求める処理を実装します。
        *   コマンド実行結果 (標準出力、標準エラー出力) を取得し、`cli-src/ui/TerminalView.ts` に渡します。`src/services/ripgrep/index.ts` の `executeCommand` の戻り値を参考に、CLI版での出力取得処理を実装します。
    2.  **`cli-src/ui/TerminalView.ts`**:
        *   `renderTerminalOutput(output: string)` 関数:  ターミナル出力をCLI上に表示します。`console.log` を利用してテキストデータを出力し、リアルタイム表示 (逐次出力)、スクロール機能、ANSIエスケープコードによる色分け表示などを実装します。
    3.  **`cli-src/core/StepExecutor.ts`**:
        *   `CommandStepExecutor` (新規作成):  `StepExecutor` インターフェースの実装クラス。`src/core/Cline.ts` の `CommandStepExecutor` を参考に、CLI版を実装します。
        *   `executeStep(step: CommandStep)` メソッド:  コマンド実行ステップを実行します。`cli-src/tools/terminal.ts` のツールを利用してコマンドを実行します。`src/core/Cline.ts` の `CommandStepExecutor.executeStep` メソッドを参考に、CLI版を実装します。
        *   ターミナル出力をステップの状態として管理し、必要に応じて `cli-src/ui/TerminalView.ts` に表示します。ステップ状態管理は `src/core/Cline.ts` のステップ状態管理を参考にします。

### 5. ファイル構造、ソースコードAST解析、正規表現検索、関連ファイル読込

*   **概要:**  プロジェクトのコンテキストを理解するために必要な情報収集機能群。
*   **参照コード (`src`):**
    *   `src/services/tree-sitter/`:  AST解析 (`list_code_definition_names` ツール関連)。`tree-sitter` ライブラリを利用してAST解析を行っています。
    *   `src/services/ripgrep/index.ts`:  正規表現検索 (`search_files` ツール関連)。`ripgrep-wrapper` を利用して高速なファイル検索を実現しています。
    *   `src/services/fs/`:  ファイル読込 (`read_file` ツール関連)。`fs.promises.readFile` を利用してファイル内容を非同期に読み込んでいます。
    *   `src/core/Cline.ts`:  コンテキスト情報収集ロジック。`_executeTaskStep` メソッド内で、これらのツールを組み合わせてコンテキスト情報を収集しています。
*   **`cli-src` での変更点:**
    *   `src/services/tree-sitter/`, `src/services/ripgrep/index.ts`, `src/services/fs/` の各サービスは、Node.js環境で動作するため、`cli-src` でもほぼそのまま再利用可能です。
    *   `cli-src/tools/contextInfo.ts` は、これらのサービスAPIを直接利用して、コンテキスト情報収集ツールを実装します。
    *   ユーザーへの承認フロー、情報表示は、CLIプロンプトで行うように変更します。
*   **ファイル:**
    *   `cli-src/tools/contextInfo.ts` (新規作成):  コンテキスト情報収集ツール群 (AST解析、検索、ファイル読込) を実装します。`src/core/Cline.ts` の `_executeTaskStep` メソッド内での各ツール呼び出しを参考に、CLI版ツールを実装します。
*   **処理内容:**
    1.  **`cli-src/tools/contextInfo.ts`**:
        *   `listCodeDefinitions(path: string)` 関数:  `src/services/tree-sitter/` のAPI (`listCodeDefinitionNames`) を利用して、コード定義リストを取得します。`src/core/Cline.ts` の `_listCodeDefinitionNames` メソッドを参考に、CLI版を実装します。
        *   `searchFiles(path: string, regex: string, filePattern?: string)` 関数:  `src/services/ripgrep/index.ts` のAPI (`searchFiles`) を利用して、ファイル検索を実行します。`src/core/Cline.ts` の `_searchFiles` メソッドを参考に、CLI版を実装します。
        *   `readFileContent(path: string)` 関数:  `src/services/fs/` のAPI (`fs.readFile`) を利用して、ファイル内容を読み込みます。`src/core/Cline.ts` の `_readFile` メソッドを参考に、CLI版を実装します。
        *   各ツール呼び出し前にユーザーに承認を求める処理を実装 (必要に応じて)。`src/core/Cline.ts` の `_confirmAction` メソッドを参考に、CLIプロンプトで承認を求める処理を実装します。
        *   ツール実行結果を整形し、`cli-src/core/TaskRunner.ts` に渡します。ツール実行結果の整形は、CLIでの表示を考慮してテキストベースで行うようにします。
    2.  **`cli-src/core/StepExecutor.ts`**:
        *   コンテキスト情報収集ステップ (`ContextInfoStep` など) を定義。ステップ定義は `src/core/Cline.ts` のステップ定義 (`ContextInfoStep` など) を参考にします。
        *   `DefaultStepExecutor` または専用の `ContextInfoStepExecutor` でステップを実行。ステップ実行ロジックは `src/core/Cline.ts` の `DefaultStepExecutor` や `ContextInfoStepExecutor` を参考に、CLI版を実装します。
        *   `cli-src/tools/contextInfo.ts` のツールを利用して情報収集。ステップ実行時に、`cli-src/tools/contextInfo.ts` の各関数を呼び出して情報収集を行います。
        *   収集した情報をステップの状態として管理し、コンテキスト管理機能に渡します。ステップ状態管理、コンテキスト管理機能との連携は、`src/core/Cline.ts` を参考にCLI版を実装します。

### 以降の機能

6.  **大規模プロジェクトのコンテキスト管理**
7.  **リンター/コンパイラーエラーの監視と修正**
8.  **ターミナル出力の監視と対応**
9.  **多様なAPIとモデルの利用**
10. **トークンとAPI使用コストの追跡**
11. **ターミナルでのコマンド実行機能全般**
12. **MCPカスタムツール機能全般**
13. **コンテキスト付与機能: `@file`, `@folder`**
14. **Model Context Protocol (MCP) によるツール拡張**

上記と同様に、各機能について「概要」「参照コード」「`cli-src` での変更点」「ファイル」「処理内容」を詳細に記述していきます。各機能の実装ステップ、ファイル構成、処理ロジック、VSCode拡張機能からの変更点を具体的にすることで、開発の見通しを立てやすくし、スムーズな実装を目指します。

---
