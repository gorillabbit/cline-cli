import { Database } from "sqlite"
import { AssistantMessageContent } from "./assistant-message/index.js"
import CheckpointTracker from "./integrations/checkpoints/CheckpointTracker.js"
import { ChatSettings } from "./shared/ChatSettings.js"
import { HistoryItem } from "./shared/HistoryItem.js"
import { ClineAskResponse, ClineMessage } from "./types.js"
import Anthropic from "@anthropic-ai/sdk"

export interface GlobalState {
	clineMessages: ClineMessage[]
	apiConversationHistory: Anthropic.Messages.MessageParam[]
	taskId: string
	taskDir: string
	conversationHistoryDeletedRange?: [number, number]
	lastMessageTs?: number
	askResponse?: ClineAskResponse
	askResponseText?: string
	askResponseImages?: string
	taskHistory: HistoryItem[]
	isInitialized?: boolean
	chatSettings: ChatSettings
	abort: boolean
	consecutiveMistakeCount: number
	checkpointTracker?: CheckpointTracker
	checkpointTrackerErrorMessage?: string
	workspaceFolder?: string
	didFinishAbortingStream: boolean
	customInstructions?: string

	// streaming
	currentStreamingContentIndex: number
	assistantMessageContent: AssistantMessageContent[]
	presentAssistantMessageLocked: boolean
	presentAssistantMessageHasPendingUpdates: boolean
	userMessageContent: (Anthropic.TextBlockParam | Anthropic.ImageBlockParam)[]
	userMessageContentReady: boolean
	didAlreadyUseTool: boolean
	didCompleteReadingStream: boolean
	didAutomaticallyRetryFailedApiRequest: boolean
	isAwaitingPlanResponse?: boolean
	didRespondToPlanAskBySwitchingMode?: boolean
	db?: Database
	abandoned?: boolean
	taskCompleted: boolean
}

class GlobalStateManager {
	private static instance: GlobalStateManager

	// Note: Be careful only here: Always use the same this._state so that the update is reflected
	private _state: GlobalState = {
		clineMessages: [],
		apiConversationHistory: [],
		taskId: "",
		taskDir: "",
		taskHistory: [],
		chatSettings: {
			mode: "act",
		},
		abort: false,
		consecutiveMistakeCount: 0,
		didFinishAbortingStream: false,
		currentStreamingContentIndex: 0,
		assistantMessageContent: [],
		presentAssistantMessageLocked: false,
		presentAssistantMessageHasPendingUpdates: false,
		userMessageContent: [],
		userMessageContentReady: false,
		didAlreadyUseTool: false,
		didCompleteReadingStream: false,
		didAutomaticallyRetryFailedApiRequest: false,
		db: undefined,
		abandoned: false,
		taskCompleted: false,
	}

	private constructor() {}

	public static getInstance(): GlobalStateManager {
		if (!GlobalStateManager.instance) {
			GlobalStateManager.instance = new GlobalStateManager()
		}
		return GlobalStateManager.instance
	}

	// state is exposed with getter
	public get state(): GlobalState {
		return this._state
	}

	// Updates are also performed on the same object
	public updateState(newState: Partial<GlobalState>): void {
		Object.assign(this._state, newState)
	}
}

export const globalStateManager = GlobalStateManager.getInstance()
