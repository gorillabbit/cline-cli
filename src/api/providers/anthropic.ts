import { Anthropic } from "@anthropic-ai/sdk"
import { anthropicDefaultModelId, AnthropicModelId, anthropicModels, ApiHandlerOptions, ModelInfo } from "../../shared/api.js"
import { ApiHandler } from "../index.js"
import { ApiResponse } from "../transform/stream.js"

export class AnthropicHandler implements ApiHandler {
	private options: ApiHandlerOptions
	private client: Anthropic

	constructor(options: ApiHandlerOptions) {
		this.options = options
		this.client = new Anthropic({
			apiKey: this.options.apiKey,
			baseURL: this.options.anthropicBaseUrl || undefined,
		})
	}

	async createMessage(systemPrompt: string, messages: Anthropic.Messages.MessageParam[]): ApiResponse {
		const model = this.getModel()
		let stream: Anthropic.Messages.Message
		const modelId = model.id
		switch (modelId) {
			// 'latest' alias does not support cache_control
			case "claude-3-5-sonnet-20241022":
			case "claude-3-5-haiku-20241022":
			case "claude-3-opus-20240229":
			case "claude-3-haiku-20240307": {
				/*
				The latest message will be the new user message, one before will be the assistant message from a previous request, and the user message before that will be a previously cached user message. So we need to mark the latest user message as ephemeral to cache it for the next request, and mark the second to last user message as ephemeral to let the server know the last message to retrieve from the cache for the current request..
				*/
				const userMsgIndices = messages.reduce(
					(acc, msg, index) => (msg.role === "user" ? [...acc, index] : acc),
					[] as number[],
				)
				const lastUserMsgIndex = userMsgIndices[userMsgIndices.length - 1] ?? -1
				const secondLastMsgUserIndex = userMsgIndices[userMsgIndices.length - 2] ?? -1
				stream = await this.client.beta.promptCaching.messages.create(
					{
						model: modelId,
						max_tokens: model.info.maxTokens || 8192,
						temperature: 0,
						system: [
							{
								text: systemPrompt,
								type: "text",
								cache_control: { type: "ephemeral" },
							},
						], // setting cache breakpoint for system prompt so new tasks can reuse it
						messages: messages.map((message, index) => {
							if (index === lastUserMsgIndex || index === secondLastMsgUserIndex) {
								return {
									...message,
									content:
										typeof message.content === "string"
											? [
													{
														type: "text",
														text: message.content,
														cache_control: {
															type: "ephemeral",
														},
													},
												]
											: message.content.map((content, contentIndex) =>
													contentIndex === message.content.length - 1
														? {
																...content,
																cache_control: {
																	type: "ephemeral",
																},
															}
														: content,
												),
								}
							}
							return message
						}),
					},
					(() => {
						// prompt caching: https://x.com/alexalbert__/status/1823751995901272068
						// https://github.com/anthropics/anthropic-sdk-typescript?tab=readme-ov-file#default-headers
						// https://github.com/anthropics/anthropic-sdk-typescript/commit/c920b77fc67bd839bfeb6716ceab9d7c9bbe7393
						switch (modelId) {
							case "claude-3-5-sonnet-20241022":
							case "claude-3-5-haiku-20241022":
							case "claude-3-opus-20240229":
							case "claude-3-haiku-20240307":
								return {
									headers: {
										"anthropic-beta": "prompt-caching-2024-07-31",
									},
								}
							default:
								return undefined
						}
					})(),
				)
				break
			}
			default: {
				stream = await this.client.messages.create({
					model: modelId,
					max_tokens: model.info.maxTokens || 8192,
					temperature: 0,
					system: [{ text: systemPrompt, type: "text" }],
					messages,
				})
				break
			}
		}

		const result = {
			text: "This is a dummy. It has not been fixed yet.",
			usage: {
				inputTokens: stream.usage.input_tokens || 0,
				outputTokens: stream.usage.output_tokens || 0,
			},
		}
		return result
	}

	getModel(): { id: AnthropicModelId; info: ModelInfo } {
		const modelId = this.options.apiModelId
		if (modelId && modelId in anthropicModels) {
			const id = modelId as AnthropicModelId
			return { id, info: anthropicModels[id] }
		}
		return {
			id: anthropicDefaultModelId,
			info: anthropicModels[anthropicDefaultModelId],
		}
	}
}
