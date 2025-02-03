import Anthropic from "@anthropic-ai/sdk"
import pWaitFor from "p-wait-for"
import { formatResponse } from "../prompts/responses.js"
import { findLastIndex } from "../shared/array.js"
import { serializeError } from "serialize-error"
import { parseAssistantMessage } from "../assistant-message/parse-assistant-message.js"
import { ask } from "../chat.js"
import { globalStateManager } from "../globalState.js"
import CheckpointTracker from "../integrations/checkpoints/CheckpointTracker.js"
import { formatContentBlockToMarkdown } from "../integrations/misc/export-markdown.js"
import { abortTask } from "../lifecycle.js"
import { showSystemNotification } from "../notifications/index.js"
import { getTaskWithId, initClineWithHistoryItem } from "../taskHistory.js"
import { say, addToApiConversationHistory, saveClineMessages } from "../tasks.js"
import { UserContent, ClineApiReqInfo, ClineApiReqCancelReason } from "../types.js"
import { calculateApiCost } from "../utils/cost.js"
import { attemptApiRequest } from "./attemptApiRequest.js"
import { loadContext } from "./loadContext.js"
import { presentAssistantMessage } from "./presentAssistantMessage.js"
import { apiStateManager } from "../apiState.js"
import { buildApiHandler } from "../api/index.js"


/**
 * 再帰的にCline APIリクエストを行い、ユーザーコンテンツとツールのやりとりを処理します。
 * この関数はClineのリクエストループの中心であり、APIコールや状態管理、
 * アシスタントメッセージの表示などを扱います。また、エラー状況や自動承認設定、
 * 途中での割り込みシナリオにも対応します。
 *
 * @param {UserContent} userContent - 処理するユーザーコンテンツ（ContentBlockの配列で表現）
 * @param {boolean} [includeFileDetails=false] - 環境コンテキストにファイルの詳細を含めるかどうか。
 *                                               大規模プロジェクトではコストが高くなる可能性があります。
 * @returns {Promise<boolean>} - ループを終了すべき場合はtrueが返されます。現在の実装では、明示的にエラーやユーザー操作により
 *                               終了されない限りループは継続するため、常にfalseを返すことを想定しています。
 */
export const recursivelyMakeClineRequests = async (
    userContent: UserContent,
    includeFileDetails: boolean = false,
): Promise<boolean> =>  {
    console.log("recursivelyMakeClineRequests開始") // 実行開始のログ
    if (globalStateManager.getState().abort) {
        console.log("recursivelyMakeClineRequests: Clineインスタンスが中断されました。") // 中断が検出された
        throw new Error("Clineインスタンスが中断されました")
    }

    // 連続ミス回数が上限を超えているかをチェック
    if (globalStateManager.getState().consecutiveMistakeCount >= 3) {
        console.log("recursivelyMakeClineRequests: 連続ミス回数の上限に達しました。") // ミス上限に到達
        if (globalStateManager.getState().autoApprovalSettings.enabled && globalStateManager.getState().autoApprovalSettings.enableNotifications) {
            showSystemNotification({
                subtitle: "エラー",
                message: "Clineが問題を抱えています。タスクを続行しますか？",
            })
        }
        // ユーザーにタスク継続の意思を確認
        const apiState = buildApiHandler(apiStateManager.getState())
        const { response, text, images } = await ask(
            "mistake_limit_reached",
            apiState.getModel().id.includes("claude")
                ? `これは思考プロセスの失敗やツール使用の問題を示している可能性があります。ユーザーからのガイダンスで回避できる場合があります（例: 「タスクを小さいステップに分解してみて」など）。`
                : "Clineは複雑なプロンプトと反復的なタスク実行を行います。モデルが対応困難な場合があります。より高性能なClaude 3.5 Sonnetの使用が推奨されます。",
        )
        if (response === "messageResponse") {
            userContent.push(
                ...[
                    {
                        type: "text",
                        text: formatResponse.tooManyMistakes(text),
                    } as Anthropic.Messages.TextBlockParam,
                    ...formatResponse.imageBlocks(images),
                ],
            )
        }
        globalStateManager.updateState({
            consecutiveMistakeCount: 0, // ミス回数をリセット
        })
        console.log("recursivelyMakeClineRequests: ミス回数をリセットしました。") // リセットログ
    }

    // 自動承認されたリクエスト数が上限を超えているかをチェック
    if (
        globalStateManager.getState().autoApprovalSettings.enabled &&
        globalStateManager.getState().consecutiveAutoApprovedRequestsCount >= globalStateManager.getState().autoApprovalSettings.maxRequests
    ) {
        console.log("recursivelyMakeClineRequests: 自動承認リクエストの上限に達しました。") // 自動承認上限に到達
        if (globalStateManager.getState().autoApprovalSettings.enableNotifications) {
            showSystemNotification({
                subtitle: "最大リクエスト数に到達",
                message: `Clineはすでに ${globalStateManager.getState().autoApprovalSettings.maxRequests.toString()} 回のAPIリクエストを自動承認しました。`,
            })
        }
        // 自動承認リクエスト数のリセットと続行の意思を確認
        await ask(
            "auto_approval_max_req_reached",
            `Clineは既に ${globalStateManager.getState().autoApprovalSettings.maxRequests.toString()} 回のAPIリクエストを自動承認しました。カウントをリセットしてタスクを続行しますか？`,
        )
        globalStateManager.updateState({
            consecutiveAutoApprovedRequestsCount: 0, // 自動承認リクエスト数をリセット
        })
        console.log("recursivelyMakeClineRequests: 自動承認リクエスト数をリセットしました。")
    }

    // 直近のAPIリクエストのインデックスを取得（トークン使用量を把握し、履歴をトリムするかなどの判定に使用）
    const previousApiReqIndex = findLastIndex(globalStateManager.getState().clineMessages, (m) => m.say === "api_req_started")

    // APIリクエストを開始する。まずはユーザーにローディングを示すためのプレースホルダーメッセージを表示
    // 大規模プロジェクトの場合、詳細情報の取得は高コストなので、プレースホルダーメッセージを使う
    await say(
        "api_req_started",
        JSON.stringify({
            request: userContent.map((block) => formatContentBlockToMarkdown(block)).join("\n\n") + "\n\nLoading...",
        })
    )
    console.log("recursivelyMakeClineRequests: APIリクエスト開始（プレースホルダーメッセージ表示）。")

    // チェックポイントトラッカーが未初期化であれば初期化
    if (!globalStateManager.getState().checkpointTracker) {
        console.log("recursivelyMakeClineRequests: チェックポイントトラッカーを初期化します。")
        try {
            globalStateManager.updateState({
                checkpointTracker: await CheckpointTracker.create(globalStateManager.getState().taskId),
                checkpointTrackerErrorMessage: undefined,
            })
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : "不明なエラー"
            console.error("recursivelyMakeClineRequests: チェックポイントトラッカーの初期化に失敗:", errorMessage)
            globalStateManager.updateState({
                checkpointTrackerErrorMessage: errorMessage,
            })
        }
    }

    // コンテキスト情報（ファイルシステム、開いているファイルなど）を読み込む
    const [parsedUserContent, environmentDetails] = await loadContext(userContent, includeFileDetails)
    userContent = parsedUserContent
    // 環境情報をユーザーコンテンツにテキストブロックとして追加
    userContent.push({ type: "text", text: environmentDetails })
    console.log("recursivelyMakeClineRequests: コンテキストを読み込み、ユーザーコンテンツに追加しました。")

    await addToApiConversationHistory({
        role: "user",
        content: userContent,
    })
    console.log("recursivelyMakeClineRequests: ユーザーコンテンツをAPI会話履歴に追加しました。")

    // プレースホルダーで作成したAPIリクエストメッセージを、実際のリクエスト内容に更新
    const messages = globalStateManager.getState().clineMessages
    const lastApiReqIndex = findLastIndex(messages, (m) => m.say === "api_req_started")
    messages[lastApiReqIndex].text = JSON.stringify({
        request: userContent.map((block) => formatContentBlockToMarkdown(block)).join("\n\n"),
    } satisfies ClineApiReqInfo)
    await saveClineMessages()
    console.log("recursivelyMakeClineRequests: プレースホルダーAPIリクエストメッセージを実際の内容に更新しました。")

    try {
        let cacheWriteTokens = 0
        let cacheReadTokens = 0
        let inputTokens = 0
        let outputTokens = 0
        let totalCost: number | undefined

        // APIリクエストメッセージをトークン使用量やコスト、キャンセル理由で更新する関数
        const updateApiReqMsg = (cancelReason?: ClineApiReqCancelReason, streamingFailedMessage?: string) => {
            const apiState = buildApiHandler(apiStateManager.getState())
            const message = globalStateManager.getState().clineMessages
            message[lastApiReqIndex].text = JSON.stringify({
                ...JSON.parse(message[lastApiReqIndex].text || "{}"),
                tokensIn: inputTokens,
                tokensOut: outputTokens,
                cacheWrites: cacheWriteTokens,
                cacheReads: cacheReadTokens,
                cost:
                    totalCost ??
                    calculateApiCost(apiState.getModel().info, inputTokens, outputTokens, cacheWriteTokens, cacheReadTokens),
                cancelReason,
                streamingFailedMessage,
            } satisfies ClineApiReqInfo)
            globalStateManager.updateState({clineMessages: message})
            console.log("recursivelyMakeClineRequests: APIリクエストメッセージにトークン使用量・コストを反映しました。")
        }

        // ストリームを中断するための関数
        const abortStream = async (cancelReason: ClineApiReqCancelReason, streamingFailedMessage?: string) => {
            // 最後のメッセージがpartialの場合、それを完了扱いにする
            const lastMessage = messages.at(-1)
            if (lastMessage && lastMessage.partial) {
                lastMessage.partial = false
                console.log("recursivelyMakeClineRequests: partialメッセージを完了扱いに更新しました。")
            }

            // タスク再開用に、アシスタントへレスポンス中断を通知
            await addToApiConversationHistory({
                role: "assistant",
                content: [
                    {
                        type: "text",
                        text:
                            assistantMessage +
                            `\n\n[${
                                cancelReason === "streaming_failed"
                                    ? "APIエラーによるレスポンス中断"
                                    : "ユーザーによるレスポンス中断"
                            }]`,
                    },
                ],
            })
            console.log("recursivelyMakeClineRequests: ストリーム中断をアシスタントに通知しました。")

            // キャンセル理由とコストをAPIリクエストメッセージに更新
            updateApiReqMsg(cancelReason, streamingFailedMessage)
            await saveClineMessages()
            console.log("recursivelyMakeClineRequests: ストリーム中断の詳細をAPIリクエストメッセージに更新しました。")

            // ストリームの中断が完了したことを示すフラグを立てる
            globalStateManager.updateState({
                didFinishAbortingStream: true,
            })
        }

        // ストリーミングに関連するステートをリセット
        globalStateManager.updateState({
            assistantMessageContent : [],
            didCompleteReadingStream : false,
            userMessageContent : [],
            userMessageContentReady : false,
            didRejectTool : false,
            didAlreadyUseTool : false,
            presentAssistantMessageLocked : false,
            presentAssistantMessageHasPendingUpdates : false,
            didAutomaticallyRetryFailedApiRequest : false,
            currentStreamingContentIndex: 0,
        })
       
        console.log("recursivelyMakeClineRequests: ストリーミング関連の状態をリセットしました。")

        // APIリクエストを行い、ストリームを取得
        const stream = attemptApiRequest(previousApiReqIndex)
        let assistantMessage = ""
        globalStateManager.updateState({
            isStreaming: true,
        })
        console.log("recursivelyMakeClineRequests: APIリクエストのストリームを開始しました。")
        try {
            // ストリームのチャンクを処理
            for await (const chunk of stream) {
                switch (chunk.type) {
                    case "usage":
                        // トークン使用量とコストを更新
                        inputTokens += chunk.inputTokens
                        outputTokens += chunk.outputTokens
                        cacheWriteTokens += chunk.cacheWriteTokens ?? 0
                        cacheReadTokens += chunk.cacheReadTokens ?? 0
                        totalCost = chunk.totalCost
                        break
                    case "text":
                        // テキストチャンクをアシスタントメッセージに追加
                        assistantMessage += chunk.text
                        // アシスタントメッセージをパースしてコンテンツブロックに変換
                        const prevLength = globalStateManager.getState().assistantMessageContent.length
                        globalStateManager.updateState({
                            assistantMessageContent: parseAssistantMessage(assistantMessage),
                        })
                        if (globalStateManager.getState().assistantMessageContent.length > prevLength) {
                            // 新しいコンテンツが追加されたので、userMessageContentReadyを一旦falseに戻す
                            globalStateManager.updateState({
                                userMessageContentReady: false,
                            })
                        }
                        // ユーザーに内容を表示
                        presentAssistantMessage()
                        break
                }

                // 中断条件の確認
                if (globalStateManager.getState().abort) {
                    console.log("recursivelyMakeClineRequests: Clineインスタンスの中断フラグによりストリームを中断します。")
                    if (!globalStateManager.getState().abandoned) {
                        // このインスタンスが実質破棄されていない場合のみ、正常に中断処理を行う
                        await abortStream("user_cancelled")
                    }
                    break // ストリームを終了
                }

                // ユーザーがツールを拒否したかどうか
                if (globalStateManager.getState().didRejectTool) {
                    console.log("recursivelyMakeClineRequests: ユーザーがツールを拒否したためストリームを中断します。")
                    assistantMessage += "\n\n[ユーザーのフィードバックによるレスポンス中断]"
                    break
                }

                // すでにツールが使用済みであるかどうか
                if (globalStateManager.getState().didAlreadyUseTool) {
                    console.log("recursivelyMakeClineRequests: ツールが既に使用されたためストリームを中断します。")
                    assistantMessage +=
                        "\n\n[ツール使用結果によりレスポンス中断。1回のレスポンスで使用できるツールは1つだけで、かつメッセージの最後に配置してください。]"
                    break
                }
            }
        } catch (error) {
            // abandonedがtrueの場合（extensionがClineインスタンスの中断完了を待機していない状態）、
            // forループ内の処理でabortがthrowされる場合などがある
            if (!globalStateManager.getState().abandoned) {
                console.error("recursivelyMakeClineRequests: ストリーム処理中にエラーが発生:", error)
                abortTask() // ストリーム失敗時、ツール使用の途中などでタスク状態が不確定になるので、タスク中断へ移行
                await abortStream("streaming_failed", error.message ?? JSON.stringify(serializeError(error), null, 2))
                const history = await getTaskWithId(globalStateManager.getState().taskId)
                if (history) {
                    initClineWithHistoryItem(history.historyItem)
                }
            }
        } finally {
            globalStateManager.updateState({
                isStreaming: false,
            })
            console.log("recursivelyMakeClineRequests: ストリーミングが終了しました。（finallyブロック）")
        }

        // ストリーミング中にClineインスタンスが中断されたか確認
        if (globalStateManager.getState().abort) {
            console.log("recursivelyMakeClineRequests: ストリーミング後にClineインスタンスが中断されました。")
            throw new Error("Clineインスタンスが中断されました")
        }
        globalStateManager.updateState({
            didCompleteReadingStream: true,
        })

        // すべてのpartialブロックを完了扱いにする
        const partialBlocks = globalStateManager.getState().assistantMessageContent.filter((block) => block.partial)
        globalStateManager.updateState({
            assistantMessageContent: globalStateManager.getState().assistantMessageContent.map((block) => {
                block.partial = false
                return block
            }),
        })
        if (partialBlocks.length > 0) {
            presentAssistantMessage() // 最後のpartialメッセージの更新処理
        }
        console.log("recursivelyMakeClineRequests: partialブロックを完了扱いにし、表示を更新しました。")

        updateApiReqMsg()
        await saveClineMessages()
        console.log("recursivelyMakeClineRequests: APIリクエストメッセージを更新し、メッセージを保存しました。")

        // API会話履歴への追加
        // ユーザーがいつでも終了する可能性があるため、ツール使用前にアシスタントのレスポンスをファイルに保存しておく
        let didEndLoop = false
        console.log("assistantMessage",assistantMessage, globalStateManager.getState())
        if (assistantMessage.length > 0) {
            await addToApiConversationHistory({
                role: "assistant",
                content: [{ type: "text", text: assistantMessage }],
            })

            // モデルがツールを使用したかどうかを確認
            const didToolUse = globalStateManager.getState().assistantMessageContent.some((block) => block.type === "tool_use")

            if (!didToolUse) {
                // 通常はツール使用が必須のリクエスト
                const userMessageContent = globalStateManager.getState().userMessageContent
                console.log("recursivelyMakeClineRequests: ユーザーメッセージを更新します。",userMessageContent)
                console.log("新userMessageContent",[...userMessageContent,
                    {
                        type: "text",
                        text: formatResponse.noToolsUsed(),
                    },
                ])
                globalStateManager.updateState({
                    userMessageContent:[...userMessageContent,
                        {
                            type: "text",
                            text: formatResponse.noToolsUsed(),
                        },
                    ],
                    consecutiveMistakeCount: globalStateManager.getState().consecutiveMistakeCount + 1,
                })
            }

            console.log(globalStateManager.getState().userMessageContent, "recursivelyMakeClineRequests: ユーザーメッセージを更新しました。")

            const recDidEndLoop: boolean = await recursivelyMakeClineRequests(globalStateManager.getState().userMessageContent)
            didEndLoop = recDidEndLoop
        } else {
            // assistant_responsesが空の場合、モデルからテキストもツールも何も返ってこなかったことを意味するためエラー扱い
            await say(
                "error",
                "予期しないAPIレスポンス: モデルがアシスタントメッセージを返しませんでした。APIまたはモデル出力に問題がある可能性があります。"
            )
            await addToApiConversationHistory({
                role: "assistant",
                content: [
                    {
                        type: "text",
                        text: "失敗: レスポンスが提供されませんでした。",
                    },
                ],
            })
        }

        console.log("recursivelyMakeClineRequests終了") // 実行終了のログ
        return didEndLoop // 現在は常にfalseが期待される
    } catch (error) {
        // 通常はattemptApiRequestでのみエラーが発生し、そこでaskを呼び出してリトライや中断が行われるため、
        // ここまでエラーが来ることは稀。来た場合はこのインスタンスを終了させる。
        console.error("recursivelyMakeClineRequests: エラーが発生しました:", error)
        return true
    }
}
