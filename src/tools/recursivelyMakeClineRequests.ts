import { formatResponse } from "../prompts/responses.js"
import { findLastIndex } from "../shared/array.js"
import { parseAssistantMessage } from "../assistant-message/parse-assistant-message.js"
import { globalStateManager } from "../globalState.js"
import CheckpointTracker from "../integrations/checkpoints/CheckpointTracker.js"
import { formatContentBlockToMarkdown } from "../integrations/misc/export-markdown.js"
import { say, addToApiConversationHistory } from "../tasks.js"
import { UserContent, ClineApiReqInfo, ClineApiReqCancelReason } from "../types.js"
import { attemptApiRequest } from "./attemptApiRequest.js"
import { loadContext } from "./loadContext.js"
import { presentAssistantMessage } from "./presentAssistantMessage.js"
import { Say } from "../database.js"

/**
 * APIリクエストの流れを「ユーザーコンテンツがなくなるまで」ループで処理する簡潔な実装例
 * @param initialUserContent ユーザーコンテンツ（ContentBlockの配列）
 * @param includeFileDetails 環境コンテキストにファイルの詳細を含めるかどうか
 * @returns ユーザー側の中断等で早期終了した場合は true、通常は false を返す
 */
export const processClineRequests = async (
	initialUserContent: UserContent,
	includeFileDetails: boolean = false,
): Promise<boolean> => {
	let userContent = initialUserContent
	const state = globalStateManager.state
	let didProcessAssistantMessage = false

	// ユーザーコンテンツが存在する限りループ
	while (userContent.length > 0) {
		// Added check for task completion
		if (state.taskCompleted) {
			return true
		}
		// ── 前処理: 中断チェック＆各種リミットの確認 ──
		if (state.abort) {
			throw new Error("Cline instance aborted")
		}
		await checkLimits(userContent)

		// ── APIリクエストの準備 ──
		const requestText = formatRequest(userContent)
		await say(Say.API_REQ_STARTED, JSON.stringify({ request: requestText + "\\n\\nLoading..." }))
		await initCheckpointTracker()

		// 環境コンテキストを読み込み、ユーザーコンテンツに付与する
		const [parsedContent, envDetails] = await loadContext(userContent, includeFileDetails)
		userContent = [...parsedContent, { type: "text", text: envDetails }]
		await addToApiConversationHistory({ role: "user", content: userContent })
		updateLastApiRequestMessage(userContent)

		// ── ストリーム処理前の状態リセット ──
		resetStreamingState()

		// ── APIリクエストストリームの実行 ──
		const { assistantMessage, tokenUsage, error: streamError } = await processApiStream()
		if (streamError) {
			await handleStreamAbort("streaming_failed", streamError as string, assistantMessage)
		} else if (!assistantMessage) {
			await handleEmptyAssistantResponse()
		} else {
			// ── アシスタントレスポンスを会話履歴に追加 ──
			await addToApiConversationHistory({
				role: "assistant",
				content: [{ type: "text", text: assistantMessage }],
			})
			updateLastApiRequestMessageWithUsage(tokenUsage)
			didProcessAssistantMessage = true
		}

		// 次のリクエスト用のユーザーコンテンツを取得
		userContent = state.userMessageContent

		// ── ツール使用がなかった場合、または完了シグナルの場合は、ループを抜ける ──
		if (didProcessAssistantMessage && !assistantResponseContainsToolUsage()) {
			updateUserContentNoTool()
			break
		}
		if (userContent.length === 1 && userContent[0].type === "text" && userContent[0].text === "") {
			break
		}
		if (userContent.length === 0) {
			break
		}
		if (state.abort) {
			break
		}
		if (state.taskCompleted) {
			return true
		}
		await processClineRequests(userContent, includeFileDetails)
	}
	return false
}

/* ── ヘルパー関数群 ── */

/**
 * 連続ミスの確認を行い、必要ならユーザーに問い合わせた上で状態をリセットする。
 */
async function checkLimits(userContent: UserContent): Promise<void> {
	const state = globalStateManager.state

	if (state.consecutiveMistakeCount >= 6) {
		// ユーザーへ通知＆ガイダンス取得（実装詳細は省略）
		console.log("[エラー] Clineが問題を抱えています。タスクを中断します")
		userContent.push({
			type: "text",
			text: formatResponse.tooManyMistakes(),
		})
		state.consecutiveMistakeCount = 0
		state.abort = true
	}
}

/**
 * ユーザーコンテンツからリクエスト用テキストを生成する
 */
function formatRequest(userContent: UserContent): string {
	return userContent.map(formatContentBlockToMarkdown).join("\\n\\n")
}

/**
 * チェックポイントトラッカーが未初期化の場合、初期化する
 */
async function initCheckpointTracker(): Promise<void> {
	const state = globalStateManager.state
	if (!state.checkpointTracker) {
		try {
			state.checkpointTracker = await CheckpointTracker.create(state.taskId)
			state.checkpointTrackerErrorMessage = undefined
		} catch (error) {
			const errorMessage = error instanceof Error ? error.message : "不明なエラー"
			state.checkpointTrackerErrorMessage = errorMessage
		}
	}
}

/**
 * 最後の「api_req_started」メッセージを更新する
 */
function updateLastApiRequestMessage(userContent: UserContent): void {
	const messages = globalStateManager.state.clineMessages
	const lastIndex = findLastIndex(messages, (m) => m.say === "api_req_started")
	messages[lastIndex].text = JSON.stringify({
		request: formatRequest(userContent),
	} as ClineApiReqInfo)
}

/**
 * ストリーム処理前に各種ストリーム関連状態をリセットする
 */
function resetStreamingState(): void {
	const state = globalStateManager.state
	state.assistantMessageContent = []
	state.didCompleteReadingStream = false
	state.userMessageContent = []
	state.userMessageContentReady = false
	state.didAlreadyUseTool = false
	state.presentAssistantMessageLocked = false
	state.presentAssistantMessageHasPendingUpdates = false
	state.didAutomaticallyRetryFailedApiRequest = false
	state.taskCompleted = false // Add this line
}

/**
 * APIからのレスポンスストリームを処理し、アシスタントメッセージとトークン使用量を返す
 */
async function processApiStream(): Promise<{
	assistantMessage: string
	tokenUsage: {
		inputTokens: number
		outputTokens: number
		cacheWriteTokens: number
		cacheReadTokens: number
		totalCost?: number
	}
	error?: unknown
}> {
	const state = globalStateManager.state
	let assistantMessage = ""
	const tokenUsage = { inputTokens: 0, outputTokens: 0, cacheWriteTokens: 0, cacheReadTokens: 0, totalCost: undefined }

	try {
		// 直近のAPIリクエストのインデックスを取得（トークン使用量を把握し、履歴をトリムするかなどの判定に使用）
		const previousApiReqIndex = findLastIndex(state.clineMessages, (m) => m.say === "api_req_started")

		const response = await attemptApiRequest(previousApiReqIndex)
		tokenUsage.inputTokens += response.usage.inputTokens
		tokenUsage.outputTokens += response.usage.outputTokens
		tokenUsage.cacheWriteTokens += response.usage.cacheWriteTokens ?? 0
		tokenUsage.cacheReadTokens += response.usage.cacheReadTokens ?? 0
		assistantMessage = response.text
		// console.log("[processApiStream] APIリクエスト成功: レスポンス", response.text)
		state.assistantMessageContent = parseAssistantMessage(assistantMessage)
		await presentAssistantMessage()
	} catch (error) {
		return { assistantMessage, tokenUsage, error }
	} finally {
		state.didCompleteReadingStream = true
	}
	return { assistantMessage, tokenUsage }
}

/**
 * ストリーム中断時の処理（アシスタントへの通知など）を行う
 */
async function handleStreamAbort(
	cancelReason: ClineApiReqCancelReason,
	errorMessage: string,
	assistantMessage: string,
): Promise<void> {
	await addToApiConversationHistory({
		role: "assistant",
		content: [
			{
				type: "text",
				text:
					assistantMessage + `\\n\\n[${cancelReason === "streaming_failed" ? "APIエラーによる中断" : "ユーザー中断"}]`,
			},
		],
	})
	// 必要に応じた追加処理（例：abortTask の呼び出しや履歴の再初期化）を実施
	console.log(`[handleStreamAbort] ストリーム中断: ${cancelReason} - ${errorMessage}`)
}

/**
 * アシスタントのレスポンスが空の場合のエラー処理
 */
async function handleEmptyAssistantResponse(): Promise<void> {
	await say(Say.ERROR, "予期しないAPIレスポンス: アシスタントメッセージが返されませんでした。")
	await addToApiConversationHistory({
		role: "assistant",
		content: [{ type: "text", text: "失敗: レスポンスが提供されませんでした。" }],
	})
}

/**
 * APIリクエストメッセージにトークン使用量を反映する
 */
function updateLastApiRequestMessageWithUsage(tokenUsage: {
	inputTokens: number
	outputTokens: number
	cacheWriteTokens: number
	cacheReadTokens: number
	totalCost?: number
}): void {
	const state = globalStateManager.state
	const messages = state.clineMessages
	const lastIndex = findLastIndex(messages, (m) => m.say === "api_req_started")
	const currentMsg = JSON.parse(messages[lastIndex].text || "{}")

	messages[lastIndex].text = JSON.stringify({
		...currentMsg,
		tokensIn: tokenUsage.inputTokens,
		tokensOut: tokenUsage.outputTokens,
		cacheWrites: tokenUsage.cacheWriteTokens,
		cacheReads: tokenUsage.cacheReadTokens,
		cost: tokenUsage.totalCost,
	} as ClineApiReqInfo)
}

/**
 * アシスタントのレスポンス内にツール使用ブロックが含まれているかを判定する
 */
function assistantResponseContainsToolUsage(): boolean {
	const state = globalStateManager.state
	return state.assistantMessageContent.some((block) => block.type === "tool_use")
}

/**
 * ツール未使用の場合、ユーザーにその旨を伝え、ミスカウントを更新する
 */
function updateUserContentNoTool(): void {
	const state = globalStateManager.state
	const currentUserMsg = state.userMessageContent
	state.userMessageContent = [...currentUserMsg, { type: "text", text: formatResponse.noToolsUsed() }]
	state.consecutiveMistakeCount++
}
