import { ClineAskResponse } from "./types.js"
import { globalStateManager } from "./globalState.js"
import { addToClineMessages } from "./tasks.js"
import { Ask, MessageType } from "./database.js"

/**
 * askResponse 関連の状態をクリアする
 */
function clearAskResponse(): void {
	const state = globalStateManager.state
	state.askResponse = undefined
	state.askResponseText = undefined
	state.askResponseImages = undefined
}

/**
 * ask 関数
 * ・partial が true の場合は既存の部分更新メッセージがあれば更新、なければ新規追加後エラーで処理を中断
 * ・partial が false の場合は既存の部分メッセージを完結させるか、または新規追加
 * ・partial が undefined の場合は通常の新規 ask として追加
 *
 * 後続で globalStateManager の askResponse が設定されるまで待機し、該当メッセージに対する応答を返します。
 */
export const ask = async (type: Ask, text?: string): Promise<{ response: ClineAskResponse; text?: string; images?: string }> => {
	clearAskResponse()
	let askTs = 0
	const state = globalStateManager.state

	state.askResponse = "yesButtonClicked"
	state.askResponseText = "yes"
	state.askResponseImages = ""

	// partial が undefined の場合は通常の新規 ask として追加
	askTs = Date.now()
	state.lastMessageTs = askTs
	await addToClineMessages({
		ts: askTs,
		type: MessageType.ASK,
		ask: type,
		text,
	})

	if (state.lastMessageTs !== askTs) {
		throw new Error("Current ask promise was ignored")
	}
	const result = {
		response: state.askResponse,
		text: state.askResponseText,
		images: state.askResponseImages,
	}
	return result
}
