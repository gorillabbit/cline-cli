import {
	AssistantMessageContent,
	TextContent,
	ToolParamName,
	toolParamNames,
	ToolUse,
	ToolUseName,
	toolUseNames,
} from "./index.js"

/**
 * アシスタントからのメッセージ文字列を解析し、テキストコンテンツやツール利用指示などのブロックに分割します。
 * ツール利用指示（<toolname>...</toolname>）と、そのパラメータ（<param>...</param>）を検出し、
 * テキスト部分は「text」ブロック、ツール利用は「tool_use」ブロックとして保持します。
 *
 * @param assistantMessage - アシスタントからのメッセージ文字列
 * @returns 分割後のコンテンツブロック配列
 */
export const parseAssistantMessage = (input: string): AssistantMessageContent[] => {
	const result: AssistantMessageContent[] = []
	const toolTagPattern = new RegExp(`<(${toolUseNames.join("|")})>([\\s\\S]*?)<\\/\\1>`, "g") // ToolUseName に含まれるタグのみを対象とする
	const paramTagPattern = new RegExp(`<(${toolParamNames.join("|")})>([\\s\\S]*?)<\\/\\1>`, "g")

	let lastIndex = 0

	let match
	while ((match = toolTagPattern.exec(input)) !== null) {
		// XMLタグの前のテキスト部分を取得
		if (match.index > lastIndex) {
			const textPart = input.slice(lastIndex, match.index).trim()
			if (textPart) {
				const textContent: TextContent = { type: "text", content: textPart }
				result.push(textContent)
			}
		}

		// ツール利用部分を処理
		const toolName = match[1] as ToolUseName
		const toolContent = match[2]

		const params: Partial<Record<ToolParamName, string>> = {}
		let paramMatch
		while ((paramMatch = paramTagPattern.exec(toolContent)) !== null) {
			const paramName = paramMatch[1] as ToolParamName // ToolParamNameであると型アサート
			params[paramName] = paramMatch[2].trim()
		}
		paramTagPattern.lastIndex = 0 // reset lastIndex for next tool tag

		const toolUse: ToolUse = {
			type: "tool_use",
			name: toolName,
			params,
		}
		result.push(toolUse)

		lastIndex = toolTagPattern.lastIndex
	}

	// 最後のXMLタグ以降のテキスト部分を取得
	if (lastIndex < input.length) {
		const textPart = input.slice(lastIndex).trim()
		if (textPart) {
			const textContent: TextContent = { type: "text", content: textPart }
			result.push(textContent)
		}
	}

	return result
}
