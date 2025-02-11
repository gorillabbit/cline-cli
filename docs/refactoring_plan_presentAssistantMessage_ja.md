# `presentAssistantMessage.ts` リファクタリング計画

**全体目標:** `presentAssistantMessage.ts` ファイルの複雑さを軽減し、可読性、保守性、およびテスト容易性を向上させる。フォーマットなどロジックに影響がない部分は無視してロジックの改善に注力する。改善の手法としてはできるだけファイル全体を修正する

**リファクタリング手順 (優先度順):**

1.  **状態管理のクラス化 (段階的導入):**
    *   現状、`presentAssistantMessage` 関数内で複数の状態変数 (`state.presentAssistantMessageLocked`, `state.presentAssistantMessageHasPendingUpdates`, `state.currentStreamingContentIndex` など) が直接操作されている。
    *   これらの状態変数を管理するための専用の `PresentAssistantMessageState` クラスを作成する。
    *   クラスのプロパティとして状態変数を保持し、状態更新メソッドを提供する (例: `lock()`, `unlock()`, `incrementIndex()`)。
    *   **重要:** 初期段階では、`PresentAssistantMessageState` のメソッド内で、`globalStateManager.state` の対応する変数も同時に更新する。これにより、既存のコードへの影響を最小限に抑えつつ、段階的な移行を可能にする。
    *   例：
        ```typescript
        class PresentAssistantMessageState {
          locked: boolean = false;
          hasPendingUpdates: boolean = false;
          currentStreamingContentIndex: number = 0;
          // ... その他の状態変数

          lock() {
            this.locked = true;
            globalStateManager.state.presentAssistantMessageLocked = true; // 同期
          }

          unlock() {
            this.locked = false;
            globalStateManager.state.presentAssistantMessageLocked = false; // 同期
          }

          // ... その他の状態更新メソッド
        }

        // presentAssistantMessage 関数内
        const presentAssistantMessageState = new PresentAssistantMessageState();
        // ... presentAssistantMessageState.lock() などで状態にアクセス
        ```

2.  **ツール処理の戦略化:**
    *   現状、`switch` 文で各ツール (`execute_command`, `read_file` など) の処理を分岐している。
    *   各ツールに対応する処理を `ToolHandler` インターフェースを実装するクラスとして定義する (Strategy パターン)。
        ```typescript
        interface ToolHandler {
          execute(block: any): Promise<void>;
        }

        class ExecuteCommandHandler implements ToolHandler {
          async execute(block: any): Promise<void> {
            // execute_command ツール固有の処理
          }
        }

        class ReadFileHandler implements ToolHandler {
          async execute(block: any): Promise<void> {
            // read_file ツール固有の処理
          }
        }
        // ... 他のツールのハンドラクラス
        ```
    *   `toolHandlers` マップ (辞書) にツール名と対応するハンドラクラスのインスタンスを登録する。
        ```typescript
        const toolHandlers: Record<string, ToolHandler> = {
          execute_command: new ExecuteCommandHandler(),
          read_file: new ReadFileHandler(),
          // ... 他のツール
        };
        ```
    *   `presentAssistantMessage` 関数内では、`toolHandlers[block.name].execute(block)` のようにして、対応するハンドラの `execute` メソッドを呼び出す。

3.  **小さな関数の抽出 (再整理):**
    *   上記の状態管理とツール処理のリファクタリングを行った上で、`presentAssistantMessage` 関数をさらに小さな関数に分割する。
    *   `processTextBlock(block)`: テキストブロックの表示 (部分的なテキストの処理も含む)。
    *   `processToolUseBlock(block)`: ツール使用ブロックの処理 (ハンドラの呼び出し、部分的なブロックの処理)。
    *   `handleToolResult(content)`: ツール結果の `userMessageContent` への追加。
    *   `handleToolError(action, error)`: エラー処理 (ログ記録、ユーザーへの表示、ツール結果への追加)。
    *   `removePartialTag(tag, text)`: 部分的な XML タグの削除 (正規表現を改善)。

4.  **エラー処理の改善:**
    *   `handleToolError` 関数をより汎用的にし、エラーメッセージの生成と整形も担当させる。
    *   必要に応じて、カスタムエラー型を導入する。

5.  **Diff 処理の抽象化:** (変更なし)

6.  **部分ブロック処理の簡素化:**
    *   `processTextBlock` と `processToolUseBlock` 内で、部分的なブロックの処理ロジックを整理し、重複を排除する。

7.  **コメントの改善:**
    *   JSDoc コメントを充実させ、各関数、クラス、インターフェースの役割、引数、戻り値を明確に記述する。
    *   コード内の複雑な部分には、適宜コメントを追加する。

8.  **型安全性の向上:**
    *   `any` の使用を避け、可能な限り具体的な型 (インターフェース) を定義する。
        *   各ツールのパラメータ (`block.params`) に対して、専用のインターフェースを定義する。
    *   型アサーション (`as`) の使用を最小限に抑え、型ガードや `instanceof` チェックを活用する。

9.  **ロギング制御:** (変更なし)

10. **テスト容易性の向上:**
    *   状態管理とツール処理をクラスに分離することで、単体テストが容易になる。
    *   小さな関数に分割することで、各関数のテストが容易になる。
    *   モック (テスト用の代替オブジェクト) を使用して、外部依存関係 (ファイルシステム、API など) を排除したテストを可能にする。

**ドキュメント:**

このリファクタリング計画は、随時更新される。各ステップが実装されるにつれて、変更を反映するようにドキュメントを更新する。また、リファクタリングの決定を説明するために、コードにコメントを追加する。

**影響範囲:**

今回のリファクタリングによる影響範囲は以下の通りです。

*   **`presentAssistantMessage.ts`:** 大幅な変更が加えられます。状態管理、ツール処理、および関数分割のリファクタリングが行われます。
*   **`recursivelyMakeClineRequests.ts`:** `presentAssistantMessage` の状態管理方法の変更に伴い、`PresentAssistantMessageState` クラスのメソッドを使用するように更新する必要があります。初期段階では、`globalStateManager` と `PresentAssistantMessageState` の両方を更新します。
*   **`globalState.ts`:** `PresentAssistantMessageState` クラスを導入し、初期状態では `presentAssistantMessage` 関連の変数を両方の場所 (グローバルステートと新しいクラス) で管理します。
*   **その他のファイル:** `globalStateManager` を使用しているすべてのファイルを段階的に `PresentAssistantMessageState` クラス (または将来的に導入するファサード) を使用するように移行します。

**段階的移行:**

1.  `PresentAssistantMessageState` クラスを作成し、`presentAssistantMessage.ts` をこのクラスを使用するように変更する。ただし、状態変数は `globalStateManager.state` にも同期させる。
2.  `recursivelyMakeClineRequests.ts` を `PresentAssistantMessageState` クラスを使用するように変更する (ただし、`globalStateManager.state` への同期は維持)。
3.  他のファイルを一つずつ、`PresentAssistantMessageState` クラス (またはファサード) を使用するように変更していく。
4.  すべてのファイルが移行されたら、`globalStateManager.state` から `presentAssistantMessage` 関連の変数を削除する。
5. **ファサード導入(オプション):** より複雑な状態管理が必要になった場合に備え、状態へのアクセスを一元化するファサードの導入を検討する。
