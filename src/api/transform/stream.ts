export type ApiResponse = Promise<{
	text: string
	usage: {
		inputTokens: number
		outputTokens: number
		cacheWriteTokens?: number
		cacheReadTokens?: number
		totalCost?: number // openrouter
	}
}>
