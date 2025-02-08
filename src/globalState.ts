import { AssistantMessageContent } from "./assistant-message/index.js";
import CheckpointTracker from "./integrations/checkpoints/CheckpointTracker.js";
import { ChatSettings } from "./shared/ChatSettings.js";
import { HistoryItem } from "./shared/HistoryItem.js";
import { ClineAskResponse, ClineMessage } from "./types.js";
import Anthropic from "@anthropic-ai/sdk";

export interface GlobalState {
  clineMessages: ClineMessage[];
  apiConversationHistory: any[];
  taskId: string;
  taskDir: string;
  conversationHistoryDeletedRange?: any;
  lastMessageTs?: number;
  askResponse?: ClineAskResponse
	askResponseText?: string
	askResponseImages?: string[]
  taskHistory: HistoryItem[];
  isInitialized?: boolean;
  chatSettings: ChatSettings
  abort: boolean;
  consecutiveMistakeCount: number
  checkpointTracker?: CheckpointTracker,
  checkpointTrackerErrorMessage?: string,
  workspaceFolder?: string,
  didFinishAbortingStream: boolean,
  customInstructions?: string

	// streaming
	isWaitingForFirstChunk:boolean
	isStreaming:boolean
	currentStreamingContentIndex:number
	assistantMessageContent: AssistantMessageContent[] 
	presentAssistantMessageLocked : boolean
	presentAssistantMessageHasPendingUpdates : boolean
	userMessageContent: (Anthropic.TextBlockParam | Anthropic.ImageBlockParam)[]
	userMessageContentReady : boolean
	didRejectTool: boolean
	didAlreadyUseTool : boolean
	didCompleteReadingStream : boolean
	didAutomaticallyRetryFailedApiRequest : boolean
  isAwaitingPlanResponse?: boolean;
  didRespondToPlanAskBySwitchingMode?: boolean;

  abandoned?: boolean;
}
  
class GlobalStateManager {
  private static instance: GlobalStateManager;

  // ※ここだけ注意: 更新が反映されるよう、常に同じ this._state を使う
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
    isWaitingForFirstChunk: false,
    isStreaming: false,
    currentStreamingContentIndex: 0,
    assistantMessageContent: [],
    presentAssistantMessageLocked: false,
    presentAssistantMessageHasPendingUpdates: false,
    userMessageContent: [],
    userMessageContentReady: false,
    didRejectTool: false,
    didAlreadyUseTool: false,
    didCompleteReadingStream: false,
    didAutomaticallyRetryFailedApiRequest: false,
  };

  private constructor() {}

  public static getInstance(): GlobalStateManager {
    if (!GlobalStateManager.instance) {
      GlobalStateManager.instance = new GlobalStateManager();
    }
    return GlobalStateManager.instance;
  }

  // state はゲッターで公開
  public get state(): GlobalState {
    return this._state;
  }

  // 更新も同一オブジェクトに対して行う
  public updateState(newState: Partial<GlobalState>): void {
    Object.assign(this._state, newState);
  }
}

export const globalStateManager = GlobalStateManager.getInstance();
