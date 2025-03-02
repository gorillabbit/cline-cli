import path from "path"
import fs from "fs/promises"
import { OpenAiHandler } from "../api/providers/openai.js"
import { getTruncatedMessages } from "../clineUtils.js"
import { GlobalFileNames } from "../const.js"
import { globalStateManager } from "../globalState.js"
import { SYSTEM_PROMPT, addUserInstructions } from "../prompts/system.js"
import { ClineApiReqInfo } from "../types.js"
import { fileExistsAtPath } from "../utils/fs.js"
import Anthropic from "@anthropic-ai/sdk"
import { apiStateManager } from "../apiState.js"
import { buildApiHandler } from "../api/index.js"
import { ApiResponse } from "../api/transform/stream.js"

/**
 * Build a system prompt for API requests
 */
async function buildSystemPrompt(): Promise<string> {
	const state = globalStateManager.state
	if (!state.workspaceFolder) {
		throw new Error("Workspace folder not set")
	}
	let prompt = await SYSTEM_PROMPT(state.workspaceFolder)

	// User-specific settings
	const customInstructions = state.customInstructions?.trim()
	const clineRulesFilePath = path.resolve(state.workspaceFolder, GlobalFileNames.clineRules)
	let clineRulesInstructions: string | undefined

	// Read the contents of the .clinerules file
	if (await fileExistsAtPath(clineRulesFilePath)) {
		try {
			const ruleFileContent = (await fs.readFile(clineRulesFilePath, "utf8")).trim()
			if (ruleFileContent) {
				clineRulesInstructions = `# .clinerules\n\nThe following instructions are provided by the .clinerules file for this working directory (${state.workspaceFolder}):\n\n${ruleFileContent}`
			}
		} catch (error) {
			console.error("[buildSystemPrompt] Error occurred while reading the .clinerules file.", error)
		}
	}

	// Add user settings and .clinerules content to the prompt
	if (customInstructions || clineRulesInstructions) {
		prompt += addUserInstructions(customInstructions, clineRulesInstructions)
	}
	return prompt
}

/**
 * Calculate the maximum allowed tokens based on the context window size
 */
function getMaxAllowedTokens(apiHandler: ReturnType<typeof buildApiHandler>): number {
	// Subtract a margin based on the context size
	let contextWindow = apiHandler.getModel().info.contextWindow || 128_000
	if (apiHandler instanceof OpenAiHandler && apiHandler.getModel().id.toLowerCase().includes("deepseek")) {
		contextWindow = 64_000
	}
	switch (contextWindow) {
		case 64_000:
			return contextWindow - 27_000
		case 128_000:
			return contextWindow - 30_000
		case 200_000:
			return contextWindow - 40_000
		default:
			return Math.max(contextWindow - 40_000, contextWindow * 0.8)
	}
}

/**
 * Check the token usage of the previous request and trim the conversation history if necessary
 */
async function trimHistoryIfNeeded(previousApiReqIndex: number): Promise<void> {
	const state = globalStateManager.state
	if (previousApiReqIndex < 0) {
		return
	}

	const previousRequest = state.clineMessages[previousApiReqIndex]
	if (previousRequest?.text) {
		const { tokensIn, tokensOut, cacheWrites, cacheReads }: ClineApiReqInfo = JSON.parse(previousRequest.text)
		const totalTokens = (tokensIn || 0) + (tokensOut || 0) + (cacheWrites || 0) + (cacheReads || 0)

		const apiHandler = buildApiHandler(apiStateManager.getState())
		const maxAllowed = getMaxAllowedTokens(apiHandler)

		console.log(`[trimHistoryIfNeeded] Total tokens: ${totalTokens} / Max allowed: ${maxAllowed}`)
		if (totalTokens >= maxAllowed) {
			console.log("[trimHistoryIfNeeded] Approaching context window limit, trimming history.")
			const keep = totalTokens / 2 > maxAllowed ? "quarter" : "half"
			const newRange = getNextTruncationRange(state.apiConversationHistory, state.conversationHistoryDeletedRange, keep)
			state.conversationHistoryDeletedRange = newRange
		}
	}
}

/**
 * attemptApiRequest
 * Function to obtain an API request
 *
 * @param previousApiReqIndex Index of the previous API request
 */
export async function attemptApiRequest(previousApiReqIndex: number): ApiResponse {
	const state = globalStateManager.state
	const apiHandler = buildApiHandler(apiStateManager.getState())

	// Build system prompt
	const systemPrompt = await buildSystemPrompt()

	// Trim history if necessary
	await trimHistoryIfNeeded(previousApiReqIndex)

	// Get trimmed conversation history
	const truncatedHistory = getTruncatedMessages(state.apiConversationHistory, state.conversationHistoryDeletedRange)

	// Generate response
	return await apiHandler.createMessage(systemPrompt, truncatedHistory)
}

/**
 * Function to calculate the next deletion range for conversation history trimming.
 * Always keeps the first message (index=0) and reduces while maintaining user-assistant pairs.
 *
 * @param messages All conversation messages
 * @param currentDeletedRange The range deleted so far (optional)
 * @param keep "half" to keep half, "quarter" to keep a quarter
 * @returns [start, end] deletion range
 */
export function getNextTruncationRange(
	messages: Anthropic.Messages.MessageParam[],
	currentDeletedRange: [number, number] | undefined = undefined,
	keep: "half" | "quarter" = "half",
): [number, number] {
	// Always keep the first message, so deletion starts from index 1
	const rangeStart = 1
	const startIndex = currentDeletedRange ? currentDeletedRange[1] + 1 : rangeStart

	// Calculate the number of messages to remove
	let messagesToRemove: number
	if (keep === "half") {
		messagesToRemove = Math.floor((messages.length - startIndex) / 4) * 2
	} else {
		messagesToRemove = Math.floor((messages.length - startIndex) / 8) * 3 * 2
	}

	// Calculate the end index
	let rangeEnd = startIndex + messagesToRemove - 1

	// Adjust to ensure the last message is a user message to maintain user-assistant pair structure
	if (messages[rangeEnd]?.role !== "user") {
		rangeEnd -= 1
	}
	return [rangeStart, rangeEnd]
}
