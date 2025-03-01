import { Anthropic } from "@anthropic-ai/sdk"
import OpenAI from "openai"
import { ApiHandler } from ".."
import {
	ApiHandlerOptions,
	ModelInfo,
	openAiNativeDefaultModelId,
	OpenAiNativeModelId,
	openAiNativeModels,
} from "../../shared/api.js"
import { convertToOpenAiMessages } from "../transform/openai-format.js"
import { ApiResponse } from "../transform/stream.js"

export class OpenAiNativeHandler implements ApiHandler {
	private options: ApiHandlerOptions
	private client: OpenAI

	constructor(options: ApiHandlerOptions) {
		this.options = options
		this.client = new OpenAI({
			apiKey: this.options.openAiNativeApiKey,
		})
	}

	async createMessage(systemPrompt: string, messages: Anthropic.Messages.MessageParam[]): ApiResponse {
		switch (this.getModel().id) {
			case "o1":
			case "o1-preview":
			case "o1-mini": {
				// o1 doesnt support streaming, non-1 temp, or system prompt
				const response = await this.client.chat.completions.create({
					model: this.getModel().id,
					messages: [{ role: "user", content: systemPrompt }, ...convertToOpenAiMessages(messages)],
				})
				return {
					text: response.choices[0]?.message.content || "",
					usage: {
						inputTokens: response.usage?.prompt_tokens || 0,
						outputTokens: response.usage?.completion_tokens || 0,
					},
				}
			}
			default: {
				const response = await this.client.chat.completions.create({
					model: this.getModel().id,
					// max_completion_tokens: this.getModel().info.maxTokens,
					temperature: 0,
					messages: [{ role: "system", content: systemPrompt }, ...convertToOpenAiMessages(messages)],
					stream_options: { include_usage: true },
				})
				return {
					text: response.choices[0]?.message?.content || "",
					usage: {
						inputTokens: response.usage?.prompt_tokens || 0,
						outputTokens: response.usage?.completion_tokens || 0,
					},
				}
			}
		}
	}

	getModel(): { id: OpenAiNativeModelId; info: ModelInfo } {
		const modelId = this.options.apiModelId
		if (modelId && modelId in openAiNativeModels) {
			const id = modelId as OpenAiNativeModelId
			return { id, info: openAiNativeModels[id] }
		}
		return {
			id: openAiNativeDefaultModelId,
			info: openAiNativeModels[openAiNativeDefaultModelId],
		}
	}
}
