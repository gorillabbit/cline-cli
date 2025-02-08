## 処理フローの説明

このCLIツールは、以下のフローでリクエストを処理します。

1.  `src/index.ts`の`main`関数がエントリーポイントです。 コマンドライン引数からワークスペースフォルダと指示を取得し、`startTask`を呼び出します。
2.  `src/lifecycle.ts`の`startTask`は、`say`を呼び出し、次に`initiateTaskLoop`を呼び出します。
3.  `initiateTaskLoop`は、ループ内で`processClineRequests`を呼び出します。
4.  `src/tools/recursivelyMakeClineRequests.ts`の`processClineRequests`がコアロジックです。 ユーザーコンテンツを処理し、コンテキストをロードし、APIリクエストを行い、レスポンスを処理します。

`processClineRequests`関数の詳細な内訳は次のとおりです。

1.  **初期化：**
    *   この関数は、`initialUserContent`（`ContentBlock`オブジェクトの配列）とブール値`includeFileDetails`を入力として受け取ります。
    *   `globalStateManager`を初期化し、現在の状態を取得します。
2.  **ユーザーコンテンツのループ処理：**
    *   関数は、`userContent`配列にコンテンツがある限り継続する`while`ループに入ります。
3.  **前処理：**
    *   **中断チェック：** タスクが中断されたかどうかを確認します。 中断された場合は、エラーをスローします。
    *   **制限チェック：** `checkLimits`を呼び出して、連続する間違いがないか確認し、必要に応じてユーザーにガイダンスを求めます。
    *   **APIリクエストの準備：**
        *   `formatRequest`を使用して、`userContent`をリクエストテキストにフォーマットします。
        *   `say("api_req_started", ...)`を使用してAPIリクエストの開始をログに記録し、Clineメッセージを更新します。
        *   `CheckpointTracker`を初期化します。
    *   **コンテキストのロード：**
        *   `loadContext`を呼び出して、環境コンテキスト（ファイルの詳細など）をロードし、`userContent`に追加します。
        *   `userContent`をAPI会話履歴に追加します。
        *   最後のリクエストメッセージを更新します。
        *   Clineメッセージを保存します。
    *   **ストリーミング状態のリセット：**
        *   さまざまなストリーミング関連の状態変数をリセットします。
4.  **APIリクエストのストリーミング：**
    *   `processApiStream`を呼び出して、APIリクエストを実行し、レスポンスストリームを処理します。
    *   `processApiStream`は、`attemptApiRequest`を呼び出してAPIリクエストを開始します。
    *   レスポンスストリームは、チャンクごとに処理されます。
    *   各チャンクについて：
        *   チャンクが「usage」チャンクの場合、トークンの使用状況情報を更新します。
        *   チャンクが「text」チャンクの場合、テキストを`assistantMessage`に追加し、`parseAssistantMessage`を使用してメッセージを解析し、`presentAssistantMessage`を呼び出してメッセージをユーザーに表示します。
        *   ループは、中断条件（タスクの中断、ツールの拒否、ツールの既に使用）を確認します。
    *   `processApiStream`は、`assistantMessage`、トークンの使用状況、およびエラーを返します。
5.  **後処理：**
    *   ストリームエラーが発生した場合、`handleStreamAbort`を呼び出してエラーを処理し、ループを終了します。
    *   アシスタントのレスポンスが空の場合、`handleEmptyAssistantResponse`を呼び出してループを終了します。
    *   アシスタントメッセージをAPI会話履歴に追加します。
    *   最後のAPIリクエストメッセージをトークンの使用状況情報で更新します。
    *   Clineメッセージを保存します。
    *   アシスタントのレスポンスにツールの使用が含まれていない場合、`updateUserContentNoTool`を呼び出してユーザーに通知し、ミスカウントをインクリメントします。
    *   `finalizePartialBlocks`を呼び出して、アシスタントメッセージ内の部分的なブロックをすべて完了します。
    *   次のイテレーションのために`userContent`を更新します。

このプロセスには、いくつかのツールが含まれています。

*   `loadContext`: 環境コンテキストをロードします。具体的には、`getEnvironmentDetails`関数を呼び出して環境の詳細を取得し、`listFiles`関数を使用してファイルシステムを探索し、ファイルとディレクトリのリストを生成します。この情報は、AIモデルがファイルの内容や構造を理解するのに役立ちます。
*   `attemptApiRequest`: APIリクエストを行います。ファイルの内容や変更指示をAPIに送信し、AIモデルからのレスポンスを受け取ります。`processApiStream`関数内で使用されます。
*   `presentAssistantMessage`: アシスタントメッセージをユーザーに表示します。これには、ファイルへの変更指示や、`executeCommandTool`を使用して実行するコマンドが含まれる場合があります。
*   `executeCommandTool`: コマンドを実行します。ファイル操作コマンド（例：`git add`、`git commit`、`patch`など）を実行し、その結果をユーザーにストリーミングします。ユーザーは、コマンドの実行中にフィードバックを提供できます。

関連する主要なファイルは次のとおりです。

*   `src/index.ts`: CLIツールのエントリポイント。
*   `src/lifecycle.ts`: `startTask`および`initiateTaskLoop`関数が含まれています。
*   `src/tools/recursivelyMakeClineRequests.ts`: リクエストを処理するためのコアロジックである`processClineRequests`関数が含まれています。
*   `src/tools/loadContext.ts`: 環境コンテキストをロードするためのロジックが含まれています。
*   `src/services/glob/list-files.ts`: ファイルシステムを探索するためのロジックが含まれています。
*   `src/tools/executeCommandTool.ts`: コマンドを実行するためのロジックが含まれています。
