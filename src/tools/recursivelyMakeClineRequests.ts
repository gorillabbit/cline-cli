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
 * A concise example of processing the API request flow in a loop "until there is no more user content".
 * @param initialUserContent User content (array of ContentBlock)
 * @param includeFileDetails Whether to include file details in the environment context
 * @returns Returns true if the user interrupts, etc., and ends early, false otherwise
 */
export const processClineRequests = async (
	initialUserContent: UserContent,
	includeFileDetails: boolean = false,
): Promise<boolean> => {
	let userContent = initialUserContent
	const state = globalStateManager.state
	let didProcessAssistantMessage = false

	// Loop as long as user content exists
	while (userContent.length > 0) {
		// Added check for task completion
		if (state.taskCompleted) {
			return true
		}
		// ── Pre-processing: Interrupt check & limit confirmation ──
		if (state.abort) {
			throw new Error("Cline instance aborted")
		}
		await checkLimits(userContent)

		// ── Preparing the API request ──
		const requestText = formatRequest(userContent)
		await say(Say.API_REQ_STARTED, JSON.stringify({ request: requestText + "\\n\\nLoading..." }))
		await initCheckpointTracker()

		// Load environment context and add it to user content
		const [parsedContent, envDetails] = await loadContext(userContent, includeFileDetails)
		userContent = [...parsedContent, { type: "text", text: envDetails }]
		// ── Add assistant response to conversation history ──
		await addToApiConversationHistory({ role: "user", content: userContent })
		updateLastApiRequestMessage(userContent)

		// ── Reset stream-related state before stream processing ──
		resetStreamingState()

		// ── Execute API request stream ──
		const {
			assistantMessage,
			tokenUsage,
			error: streamError,
		} = await processApiStream()
		if (streamError) {
			await handleStreamAbort("streaming_failed", streamError as string, assistantMessage)
		} else if (!assistantMessage) {
			await handleEmptyAssistantResponse()
		} else {
			// ── Add user response to conversation history ──
			await addToApiConversationHistory({
				role: "assistant",
				content: [{ type: "text", text: assistantMessage }],
			})
			updateLastApiRequestMessageWithUsage(tokenUsage)
			didProcessAssistantMessage = true
		}

		// Get user content for the next request
		userContent = state.userMessageContent

		// ── Exit loop if no tool usage or completion signal ──
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

/* ── Helper functions ── */

/**
 * Check for consecutive mistakes and reset state if necessary after querying the user.
 */
async function checkLimits(userContent: UserContent): Promise<void> {
	const state = globalStateManager.state

	if (state.consecutiveMistakeCount >= 6) {
		// Notify user & get guidance (implementation details omitted)
		console.log("[Error] Cline is having problems. Aborting task")
		userContent.push({
			type: "text",
			text: formatResponse.tooManyMistakes(),
		})
		state.consecutiveMistakeCount = 0
		state.abort = true
	}
}

/**
 * Generate request text from user content
 */
function formatRequest(userContent: UserContent): string {
	return userContent.map(formatContentBlockToMarkdown).join("\\n\\n")
}

/**
 * Initialize checkpoint tracker if not already initialized
 */
async function initCheckpointTracker(): Promise<void> {
	const state = globalStateManager.state
	if (!state.checkpointTracker) {
		try {
			state.checkpointTracker = await CheckpointTracker.create(state.taskId)
			state.checkpointTrackerErrorMessage = undefined
		} catch (error) {
			const errorMessage = error instanceof Error ? error.message : "Unknown error"
			state.checkpointTrackerErrorMessage = errorMessage
		}
	}
}

/**
 * Update the last "api_req_started" message
 */
function updateLastApiRequestMessage(userContent: UserContent): void {
	const messages = globalStateManager.state.clineMessages
	const lastIndex = findLastIndex(messages, (m) => m.say === "api_req_started")
	messages[lastIndex].text = JSON.stringify({
		request: formatRequest(userContent),
	} as ClineApiReqInfo)
}

/**
 * Reset various stream-related states before stream processing
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
 * Process the response stream from the API and return the assistant message and token usage
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
		// Get the index of the most recent API request (used to track token usage and determine if history needs trimming)
		const previousApiReqIndex = findLastIndex(state.clineMessages, (m) => m.say === "api_req_started")

		const response = await attemptApiRequest(previousApiReqIndex)
		tokenUsage.inputTokens += response.usage.inputTokens
		tokenUsage.outputTokens += response.usage.outputTokens
		tokenUsage.cacheWriteTokens += response.usage.cacheWriteTokens ?? 0
		tokenUsage.cacheReadTokens += response.usage.cacheReadTokens ?? 0
		assistantMessage = response.text
		// console.log("[processApiStream] API request successful: response", response.text)
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
 * Handle stream abort (e.g., notify assistant, etc.)
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
					assistantMessage + `\\n\\n[${cancelReason === "streaming_failed" ? "API error caused interruption" : "User interruption"}]`,
			},
		],
	})
	// Perform additional processing as needed (e.g., call abortTask or reinitialize history)
	console.log(`[handleStreamAbort] Stream aborted: ${cancelReason} - ${errorMessage}`)
}

/**
 * Handle error when the assistant's response is empty
 */
async function handleEmptyAssistantResponse(): Promise<void> {
	await say(Say.ERROR, "Unexpected API response: No assistant message returned.")
	await addToApiConversationHistory({
		role: "assistant",
		content: [{ type: "text", text: "Failure: No response provided." }],
	})
}

/**
 * Reflect token usage in the API request message
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
 * Determine if the assistant's response contains a tool usage block
 */
function assistantResponseContainsToolUsage(): boolean {
	const state = globalStateManager.state
	return state.assistantMessageContent.some((block) => block.type === "tool_use")
}

/**
 * Notify the user if no tools were used and update the mistake count
 */
function updateUserContentNoTool(): void {
	const state = globalStateManager.state
	const currentUserMsg = state.userMessageContent
	state.userMessageContent = [...currentUserMsg, { type: "text", text: formatResponse.noToolsUsed() }]
	state.consecutiveMistakeCount++
}
