import * as path from "path"
import * as fs from "fs/promises"
import { taskBaseDir, GlobalFileNames, configPath } from "./const.js"
import { Anthropic } from "@anthropic-ai/sdk"
import { globalStateManager } from "./globalState.js"
import { ToolUseName } from "./types.js"
import { formatResponse } from "./prompts/responses.js"
import { AppDataSource, Ask, ClineMessage, MessageType, Say } from "./database.js"
import { ApiProvider } from "./shared/api.js"
import { fileExistsAtPath } from "./utils/fs.js"

export interface ClineConfig {
	apiProvider: ApiProvider
	apiModelId: string
	apiKey: string
	openRouterApiKey: string
	awsAccessKey: string
	awsSecretKey: string
	awsSessionToken: string
	awsRegion: string
	awsUseCrossRegionInference: boolean
	vertexProjectId: string
	vertexRegion: string
	openAiBaseUrl: string
	openAiApiKey: string
	openAiModelId: string
	ollamaModelId: string
	ollamaBaseUrl: string
	lmStudioModelId: string
	lmStudioBaseUrl: string
	anthropicBaseUrl: string
	geminiApiKey: string
	openAiNativeApiKey: string
	deepSeekApiKey: string
	mistralApiKey: string
	azureApiVersion: string
	openRouterModelId: string
}

/**
 * 指定したtaskIdに対応するタスクディレクトリを作成し、必要なファイルを準備します。
 * ディレクトリが既に存在している場合は再帰的に作成され、存在しないファイルには空の配列をJSON化したデータを書き込みます。
 *
 * @param {string} taskId - タスクID
 */
export const ensureTaskDirectoryExists = async (taskId: string) => {
	try {
		// 現在のグローバルステートにtaskIdを設定
		globalStateManager.state.taskId = taskId
		const taskDir = path.join(taskBaseDir, taskId)

		// タスクディレクトリが存在しない場合は再帰的に作成
		await fs.mkdir(taskDir, { recursive: true })

		// コンフィグファイルが存在しない場合は作成
		if (!(await fileExistsAtPath(configPath))) {
			const defaultConfig: ClineConfig = {
				apiProvider: "openai",
				apiKey: "",
				geminiApiKey: "",
				apiModelId: "",
				openRouterApiKey: "",
				awsAccessKey: "",
				awsSecretKey: "",
				awsSessionToken: "",
				awsRegion: "",
				awsUseCrossRegionInference: false,
				vertexProjectId: "",
				vertexRegion: "",
				openAiBaseUrl: "",
				openAiApiKey: "",
				openAiModelId: "",
				ollamaModelId: "",
				ollamaBaseUrl: "",
				lmStudioModelId: "",
				lmStudioBaseUrl: "",
				anthropicBaseUrl: "",
				openAiNativeApiKey: "",
				deepSeekApiKey: "",
				mistralApiKey: "",
				azureApiVersion: "",
				openRouterModelId: "",
			}
			await fs.writeFile(configPath, JSON.stringify(defaultConfig))
		}

		// 必要なファイルが無い場合は空のデータを書き込んで作成する
		for (const file of Object.values(GlobalFileNames)) {
			const filePath = path.join(taskDir, file)
			await fs.writeFile(filePath, "[]")
		}

		// グローバルステートにタスクディレクトリを登録
		globalStateManager.state.taskDir = taskDir
	} catch (error) {
		console.error("タスクディレクトリの作成に失敗しました:", error)
	}
}

/**
 * 保存されたAPI会話履歴を取得する関数
 * @returns {Promise<Anthropic.MessageParam[]>} - 保存されているAPI会話履歴の配列
 */
export const getSavedApiConversationHistory = async (): Promise<Anthropic.MessageParam[]> => {
	const taskDir = globalStateManager.state.taskDir
	const filePath = path.join(taskDir, GlobalFileNames.apiConversationHistory)
	return JSON.parse(await fs.readFile(filePath, "utf8"))
}

/**
 * API会話履歴にメッセージを追加する関数
 * @param {Anthropic.MessageParam} message - 追加するメッセージオブジェクト
 */
export const addToApiConversationHistory = async (message: Anthropic.MessageParam) => {
	// 現在の履歴を取得し、メッセージを追加した上で保存
	const apiConversationHistory = await getSavedApiConversationHistory()
	apiConversationHistory.push(message)
	globalStateManager.updateState({ apiConversationHistory })
	await saveApiConversationHistory(apiConversationHistory)
}

/**
 * 新しいAPI会話履歴で既存の履歴を上書きする関数
 * @param {Anthropic.MessageParam[]} newHistory - 新しいAPI会話履歴
 */
export const overwriteApiConversationHistory = async (newHistory: Anthropic.MessageParam[]) => {
	await saveApiConversationHistory(newHistory)
}

/**
 * API会話履歴を保存する関数
 * @param {Anthropic.MessageParam[]} apiConversationHistory - 保存対象のAPI会話履歴
 */
const saveApiConversationHistory = async (apiConversationHistory: Anthropic.MessageParam[]) => {
	try {
		const taskDir = globalStateManager.state.taskDir
		const filePath = path.join(taskDir, GlobalFileNames.apiConversationHistory)
		// JSON文字列に変換してファイルに書き込む
		await fs.writeFile(filePath, JSON.stringify(apiConversationHistory))
	} catch (error) {
		// 保存に失敗してもタスク自体は停止しない
		console.error("API会話履歴の保存に失敗しました:", error)
	}
}

/**
 * 新しいClineメッセージをメッセージリストに追加し、保存する関数
 * @param {ClineMessage} message - 追加するClineメッセージオブジェクト
 */
export const addToClineMessages = async (message: Partial<ClineMessage>) => {
	// conversationHistoryIndexを現在のAPI会話履歴数 - 1 に設定（最後のユーザーメッセージを指す想定）
	const state = globalStateManager.state
	message.conversationHistoryIndex = state.apiConversationHistory.length - 1
	message.conversationHistoryDeletedRangeStart = state.conversationHistoryDeletedRange?.[0]
	message.conversationHistoryDeletedRangeEnd = state.conversationHistoryDeletedRange?.[1]
	if (message.type === "say" && !message.text) {
		return
	}

	if (!AppDataSource.isInitialized) {
		console.error("Data Source not initialized")
		return
	}
	const clineMessageRepository = AppDataSource.getRepository(ClineMessage)
	message.ts = message.ts ?? Date.now()
	message.taskId = state.taskId
	await clineMessageRepository.save(message)
	if (message.ts !== undefined) {
		state.clineMessages.push(message as ClineMessage)
	} else {
		console.error("Message timestamp is undefined")
	}
}

/**
 * 新しいClineメッセージ配列で既存のメッセージを上書きする関数
 * @param {ClineMessage[]} newMessages - 新しいClineメッセージ配列
 */
export const overwriteClineMessages = async (newMessages: ClineMessage[]) => {
	globalStateManager.state.clineMessages = newMessages
}

/**
 * 指定したタイプ(ClineSay)のメッセージを追加または更新する関数。
 * partialフラグが指定された場合、前回のpartialメッセージを更新または新たにpartialメッセージを作成する。
 *
 * @param {ClineSay} type - メッセージ種別（例: "error", "info"など）
 * @param {string} [text] - メッセージ本文
 * @param {string[]} [images] - 画像URLなどの配列
 * @param {boolean} [partial] - partialフラグ。trueの場合はストリーミング中の未完成メッセージを扱う
 */
export const say = async (type: Say, text?: string, images?: string) => {
	const state = globalStateManager.state

	// partialが指定されていない通常メッセージの場合
	const sayTs = Date.now()
	state.lastMessageTs = sayTs
	await addToClineMessages({
		ts: sayTs,
		type: MessageType.SAY,
		say: type,
		text,
		images,
	})
}

/**
 * 必須パラメータが欠けていることをユーザーに伝え、再試行する際に使用するエラーメッセージを作成する関数
 * @param {ToolUseName} toolName - ツール名
 * @param {string} paramName - 欠けているパラメータ名
 * @param {string} [relPath] - 関連ファイルパス（任意）
 * @returns {Promise<string>} - フォーマットされたエラーメッセージ（再試行用）
 */
export const sayAndCreateMissingParamError = async (
	toolName: ToolUseName,
	paramName: string,
	relPath?: string,
): Promise<string> => {
	await say(
		Say.ERROR,
		`Clineは${toolName}を使用しようとしましたが、必須パラメータ'${paramName}'に値がありません。${
			relPath ? `対象: '${relPath}'` : ""
		} 再試行します...`,
	)
	return formatResponse.toolError(formatResponse.missingToolParameterError(paramName))
}

/**
 * 最後のメッセージが指定したタイプかつpartial状態である場合、配列から取り除く関数。
 * @param {"ask" | "say"} type - メッセージタイプ
 * @param {ClineAsk | ClineSay} askOrSay - "ask"または"say"の具体的な値
 */
export const removeLastPartialMessageIfExistsWithType = (type: MessageType, askOrSay: Ask | Say) => {
	const clineMessages = globalStateManager.state.clineMessages
	const lastMessage = clineMessages.at(-1)
	if (lastMessage?.partial && lastMessage.type === type && (lastMessage.ask === askOrSay || lastMessage.say === askOrSay)) {
		// 対象のpartialメッセージを削除し、保存
		clineMessages.pop()
		// saveClineMessages();
	}
}
