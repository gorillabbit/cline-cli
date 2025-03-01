import { Anthropic } from "@anthropic-ai/sdk"
import { Mistral } from "@mistralai/mistralai"
import { ApiHandler } from ".."
import { ApiHandlerOptions, mistralDefaultModelId, MistralModelId, mistralModels, ModelInfo } from "../../shared/api.js"
import { convertToMistralMessages } from "../transform/mistral-format.js"
import { ApiResponse } from "../transform/stream.js"

export class MistralHandler implements ApiHandler {
	private options: ApiHandlerOptions
	private client: Mistral

	constructor(options: ApiHandlerOptions) {
		this.options = options
		this.client = new Mistral({
			serverURL: "https://codestral.mistral.ai",
			apiKey: this.options.mistralApiKey,
		})
	}

	async createMessage(systemPrompt: string, messages: Anthropic.Messages.MessageParam[]): ApiResponse {
		const response = await this.client.chat.complete({
			model: this.getModel().id,
			// max_completion_tokens: this.getModel().info.maxTokens,
			temperature: 0,
			messages: [{ role: "system", content: systemPrompt }, ...convertToMistralMessages(messages)],
		})
		return {
			text: Array.isArray(response.choices?.[0]?.message.content)
				? response.choices[0].message.content.join("")
				: response.choices?.[0]?.message.content || "",
			usage: {
				inputTokens: response.usage?.promptTokens || 0,
				outputTokens: response.usage?.completionTokens || 0,
			},
		}
	}

	getModel(): { id: MistralModelId; info: ModelInfo } {
		const modelId = this.options.apiModelId
		if (modelId && modelId in mistralModels) {
			const id = modelId as MistralModelId
			return { id, info: mistralModels[id] }
		}
		return {
			id: mistralDefaultModelId,
			info: mistralModels[mistralDefaultModelId],
		}
	}
}
