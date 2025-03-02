import { ClineAskResponse } from "./types.js"
import { globalStateManager } from "./globalState.js"
import { addToClineMessages } from "./tasks.js"
import { Ask, MessageType } from "./database.js"

/**
 * Clears the state related to askResponse
 */
function clearAskResponse(): void {
	const state = globalStateManager.state
	state.askResponse = undefined
	state.askResponseText = undefined
	state.askResponseImages = undefined
}

/**
 * ask function
 * If partial is true, update the existing partial update message if it exists, otherwise interrupt the process with an error after adding a new one.
 * If partial is false, complete the existing partial message or add a new one.
 * If partial is undefined, add as a normal new ask.
 *
 * Waits for globalStateManager's askResponse to be set in the subsequent process and returns a response to the corresponding message.
 */
export const ask = async (type: Ask, text?: string): Promise<{ response: ClineAskResponse; text?: string; images?: string }> => {
	clearAskResponse()
	let askTs = 0
	const state = globalStateManager.state

	state.askResponse = "yesButtonClicked"
	state.askResponseText = "yes"
	state.askResponseImages = ""

	// If partial is undefined, add as a normal new ask
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
