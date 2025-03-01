import Anthropic from "@anthropic-ai/sdk"
import { cwd } from "process"
import { globalStateManager } from "./globalState.js"
import { formatResponse } from "./prompts/responses.js"
import { findLastIndex } from "./shared/array.js"
import { ClineApiReqInfo, UserContent } from "./types.js"
import { getSavedApiConversationHistory, overwriteApiConversationHistory, overwriteClineMessages, say } from "./tasks.js"
import { ask } from "./chat.js"
import { processClineRequests } from "./tools.js"
import { findToolName } from "./integrations/misc/export-markdown.js"
import { Ask, ClineMessage, Say } from "./database.js"

export const startTask = async (task?: string, images?: string) => {
	const state = globalStateManager.state
	state.clineMessages = []
	state.apiConversationHistory = []
	await say(Say.TEXT, task, images)
	state.isInitialized = true

	const imageBlocks: Anthropic.ImageBlockParam[] = formatResponse.imageBlocks(images)
	await initiateTaskLoop([
		{
			type: "text",
			text: `<task>\n${task}\n</task>`,
		},
		...imageBlocks,
	])
}

export const resumeTaskFromHistory = async () => {
	const state = globalStateManager.state
	const modifiedClineMessages: ClineMessage[] = []

	// Remove any resume messages that may have been added before
	const lastRelevantMessageIndex = findLastIndex(
		modifiedClineMessages,
		(m) => !(m.ask === "resume_task" || m.ask === "resume_completed_task"),
	)
	if (lastRelevantMessageIndex !== -1) {
		modifiedClineMessages.splice(lastRelevantMessageIndex + 1)
	}

	// since we don't use api_req_finished anymore, we need to check if the last api_req_started has a cost value, if it doesn't and no cancellation reason to present, then we remove it since it indicates an api request without any partial content streamed
	const lastApiReqStartedIndex = findLastIndex(modifiedClineMessages, (m) => m.type === "say" && m.say === "api_req_started")
	if (lastApiReqStartedIndex !== -1) {
		const lastApiReqStarted = modifiedClineMessages[lastApiReqStartedIndex]
		const { cost, cancelReason }: ClineApiReqInfo = JSON.parse(lastApiReqStarted.text || "{}")
		if (cost === undefined && cancelReason === undefined) {
			modifiedClineMessages.splice(lastApiReqStartedIndex, 1)
		}
	}

	await overwriteClineMessages(modifiedClineMessages)

	state.clineMessages = modifiedClineMessages

	// Now present the cline messages to the user and ask if they want to resume (NOTE: we ran into a bug before where the apiconversationhistory wouldnt be initialized when opening a old task, and it was because we were waiting for resume)
	// This is important in case the user deletes messages without resuming the task first

	state.apiConversationHistory = await getSavedApiConversationHistory()
	const lastClineMessage = state.clineMessages
		.slice()
		.reverse()
		.find((m) => !(m.ask === "resume_task" || m.ask === "resume_completed_task")) // could be multiple resume tasks
	let askType: Ask
	if (lastClineMessage?.ask === "completion_result") {
		askType = Ask.RESUME_COMPLETED_TASK
	} else {
		askType = Ask.RESUME_TASK
	}

	state.isInitialized = true

	const { response, text, images } = await ask(askType) // calls poststatetowebview
	let responseText: string | undefined
	let responseImages: string | undefined
	if (response === "messageResponse") {
		await say(Say.USER_FEEDBACK, text, images)
		responseText = text
		responseImages = images
	}

	// need to make sure that the api conversation history can be resumed by the api, even if it goes out of sync with cline messages

	let existingApiConversationHistory: Anthropic.Messages.MessageParam[] = await getSavedApiConversationHistory()

	// v2.0 xml tags refactor caveat: since we don't use tools anymore, we need to replace all tool use blocks with a text block since the API disallows conversations with tool uses and no tool schema
	const conversationWithoutToolBlocks = existingApiConversationHistory.map((message) => {
		if (Array.isArray(message.content)) {
			const newContent = message.content.map((block) => {
				if (block.type === "tool_use") {
					// it's important we convert to the new tool schema format so the model doesn't get confused about how to invoke tools
					const inputAsXml = Object.entries(block.input as Record<string, string>)
						.map(([key, value]) => `<${key}>\n${value}\n</${key}>`)
						.join("\n")
					return {
						type: "text",
						text: `<${block.name}>\n${inputAsXml}\n</${block.name}>`,
					} as Anthropic.Messages.TextBlockParam
				} else if (block.type === "tool_result") {
					// Convert block.content to text block array, removing images
					const contentAsTextBlocks = Array.isArray(block.content)
						? block.content.filter((item) => item.type === "text")
						: [{ type: "text", text: block.content }]
					const textContent = contentAsTextBlocks.map((item) => item.text).join("\n\n")
					const toolName = findToolName(block.tool_use_id, existingApiConversationHistory)
					return {
						type: "text",
						text: `[${toolName} Result]\n\n${textContent}`,
					} as Anthropic.Messages.TextBlockParam
				}
				return block
			})
			return { ...message, content: newContent }
		}
		return message
	})
	existingApiConversationHistory = conversationWithoutToolBlocks

	let modifiedOldUserContent: UserContent // either the last message if its user message, or the user message before the last (assistant) message
	let modifiedApiConversationHistory: Anthropic.Messages.MessageParam[] // need to remove the last user message to replace with new modified user message
	if (existingApiConversationHistory.length > 0) {
		const lastMessage = existingApiConversationHistory[existingApiConversationHistory.length - 1]

		if (lastMessage.role === "assistant") {
			const content = Array.isArray(lastMessage.content)
				? lastMessage.content
				: [{ type: "text", text: lastMessage.content }]
			const hasToolUse = content.some((block) => block.type === "tool_use")

			if (hasToolUse) {
				const toolUseBlocks = content.filter((block) => block.type === "tool_use") as Anthropic.Messages.ToolUseBlock[]
				const toolResponses: Anthropic.ToolResultBlockParam[] = toolUseBlocks.map((block) => ({
					type: "tool_result",
					tool_use_id: block.id,
					content: "Task was interrupted before this tool call could be completed.",
				}))
				modifiedApiConversationHistory = [...existingApiConversationHistory] // no changes
				modifiedOldUserContent = [...toolResponses]
			} else {
				modifiedApiConversationHistory = [...existingApiConversationHistory]
				modifiedOldUserContent = []
			}
		} else if (lastMessage.role === "user") {
			const previousAssistantMessage: Anthropic.Messages.MessageParam | undefined =
				existingApiConversationHistory[existingApiConversationHistory.length - 2]

			const existingUserContent: UserContent = Array.isArray(lastMessage.content)
				? lastMessage.content
				: [{ type: "text", text: lastMessage.content }]
			if (previousAssistantMessage && previousAssistantMessage.role === "assistant") {
				const assistantContent = Array.isArray(previousAssistantMessage.content)
					? previousAssistantMessage.content
					: [
							{
								type: "text",
								text: previousAssistantMessage.content,
							},
						]

				const toolUseBlocks = assistantContent.filter(
					(block) => block.type === "tool_use",
				) as Anthropic.Messages.ToolUseBlock[]

				if (toolUseBlocks.length > 0) {
					const existingToolResults = existingUserContent.filter(
						(block) => block.type === "tool_result",
					) as Anthropic.ToolResultBlockParam[]

					const missingToolResponses: Anthropic.ToolResultBlockParam[] = toolUseBlocks
						.filter((toolUse) => !existingToolResults.some((result) => result.tool_use_id === toolUse.id))
						.map((toolUse) => ({
							type: "tool_result",
							tool_use_id: toolUse.id,
							content: "Task was interrupted before this tool call could be completed.",
						}))

					modifiedApiConversationHistory = existingApiConversationHistory.slice(0, -1) // removes the last user message
					modifiedOldUserContent = [...existingUserContent, ...missingToolResponses]
				} else {
					modifiedApiConversationHistory = existingApiConversationHistory.slice(0, -1)
					modifiedOldUserContent = [...existingUserContent]
				}
			} else {
				modifiedApiConversationHistory = existingApiConversationHistory.slice(0, -1)
				modifiedOldUserContent = [...existingUserContent]
			}
		} else {
			throw new Error("Unexpected: Last message is not a user or assistant message")
		}
	} else {
		throw new Error("Unexpected: No existing API conversation history")
	}

	const newUserContent: UserContent = [...modifiedOldUserContent]

	const agoText = (() => {
		const timestamp = lastClineMessage?.ts ?? Date.now()
		const now = Date.now()
		const diff = now - timestamp
		const minutes = Math.floor(diff / 60000)
		const hours = Math.floor(minutes / 60)
		const days = Math.floor(hours / 24)

		if (days > 0) {
			return `${days} day${days > 1 ? "s" : ""} ago`
		}
		if (hours > 0) {
			return `${hours} hour${hours > 1 ? "s" : ""} ago`
		}
		if (minutes > 0) {
			return `${minutes} minute${minutes > 1 ? "s" : ""} ago`
		}
		return "just now"
	})()

	const wasRecent = lastClineMessage?.ts && Date.now() - lastClineMessage.ts < 30_000

	newUserContent.push({
		type: "text",
		text:
			`[TASK RESUMPTION] ${
				state.chatSettings?.mode === "plan"
					? `This task was interrupted ${agoText}. The conversation may have been incomplete. Be aware that the project state may have changed since then. The current working directory is now '${cwd}'.\n\nNote: If you previously attempted a tool use that the user did not provide a result for, you should assume the tool use was not successful. However you are in PLAN MODE, so rather than continuing the task, you must respond to the user's message.`
					: `This task was interrupted ${agoText}. It may or may not be complete, so please reassess the task context. Be aware that the project state may have changed since then. The current working directory is now '${cwd}'. If the task has not been completed, retry the last step before interruption and proceed with completing the task.\n\nNote: If you previously attempted a tool use that the user did not provide a result for, you should assume the tool use was not successful and assess whether you should retry. If the last tool was a browser_action, the browser has been closed and you must launch a new browser if needed.`
			}${
				wasRecent
					? "\n\nIMPORTANT: If the last tool use was a replace_in_file or write_to_file that was interrupted, the file was reverted back to its original state before the interrupted edit, and you do NOT need to re-read the file as you already have its up-to-date contents."
					: ""
			}` +
			(responseText
				? `\n\n${state.chatSettings?.mode === "plan" ? "New message to respond to with plan_mode_response tool (be sure to provide your response in the <response> parameter)" : "New instructions for task continuation"}:\n<user_message>\n${responseText}\n</user_message>`
				: state.chatSettings.mode === "plan"
					? "(The user did not provide a new message. Consider asking them how they'd like you to proceed, or to switch to Act mode to continue with the task.)"
					: ""),
	})

	if (responseImages && responseImages.length > 0) {
		newUserContent.push(...formatResponse.imageBlocks(responseImages))
	}

	await overwriteApiConversationHistory(modifiedApiConversationHistory)
	initiateTaskLoop(newUserContent)
}

export const initiateTaskLoop = async (userContent: UserContent) => {
	let nextUserContent = userContent
	let includeFileDetails = true
	const state = globalStateManager.state
	while (!state.abort) {
		const didEndLoop = await processClineRequests(nextUserContent, includeFileDetails)
		includeFileDetails = false // we only need file details the first time
		if (didEndLoop) {
			break
		} else {
			nextUserContent = [
				{
					type: "text",
					text: formatResponse.noToolsUsed(),
				},
			]
			state.consecutiveMistakeCount++
		}
	}
}

export const abortTask = () => {
	globalStateManager.state.abort = true
}
