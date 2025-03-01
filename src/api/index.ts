import { Anthropic } from "@anthropic-ai/sdk"
import { ApiConfiguration, ModelInfo } from "../shared/api.js"
import { AnthropicHandler } from "./providers/anthropic.js"
import { AwsBedrockHandler } from "./providers/bedrock.js"
import { OpenRouterHandler } from "./providers/openrouter.js"
import { VertexHandler } from "./providers/vertex.js"
import { OpenAiHandler } from "./providers/openai.js"
import { OllamaHandler } from "./providers/ollama.js"
import { LmStudioHandler } from "./providers/lmstudio.js"
import { GeminiHandler } from "./providers/gemini.js"
import { OpenAiNativeHandler } from "./providers/openai-native.js"
import { ApiResponse } from "./transform/stream"
import { DeepSeekHandler } from "./providers/deepseek.js"
import { MistralHandler } from "./providers/mistral.js"

export interface ApiHandler {
	createMessage(systemPrompt: string, messages: Anthropic.Messages.MessageParam[]): ApiResponse
	getModel(): { id: string; info: ModelInfo }
}

export interface SingleCompletionHandler {
	completePrompt(prompt: string): Promise<string>
}

export function buildApiHandler(configuration: ApiConfiguration): ApiHandler {
	const { apiProvider, ...options } = configuration
	switch (apiProvider) {
		case "anthropic":
			return new AnthropicHandler(options)
		case "openrouter":
			return new OpenRouterHandler(options)
		case "bedrock":
			return new AwsBedrockHandler(options)
		case "vertex":
			return new VertexHandler(options)
		case "openai":
			return new OpenAiHandler(options)
		case "ollama":
			return new OllamaHandler(options)
		case "lmstudio":
			return new LmStudioHandler(options)
		case "gemini":
			return new GeminiHandler(options)
		case "openai-native":
			return new OpenAiNativeHandler(options)
		case "deepseek":
			return new DeepSeekHandler(options)
		case "mistral":
			return new MistralHandler(options)
		default:
			return new AnthropicHandler(options)
	}
}
