import { AssistantMessageContent } from "./assistant-message/index.js";
import CheckpointTracker from "./integrations/checkpoints/CheckpointTracker.js";
import { AutoApprovalSettings } from "./shared/AutoApprovalSettings.js";
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
  autoApprovalSettings: AutoApprovalSettings
  consecutiveAutoApprovedRequestsCount: number,
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
  private state: GlobalState = {
    clineMessages: [],
    apiConversationHistory: [],
    taskId: "",
    taskDir: "",
    taskHistory: [],
    chatSettings: {
      mode: "act"
    },
    abort: false,
    consecutiveMistakeCount: 0,
    autoApprovalSettings: {
      enabled: false,
      actions: {
        readFiles: false,
        editFiles: false,
        executeCommands: false,
        useBrowser: false,
        useMcp: false
      },
      maxRequests: 0,
      enableNotifications: false,
    },
    consecutiveAutoApprovedRequestsCount: 0,
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
    didAutomaticallyRetryFailedApiRequest: false
  };

  private constructor() {}

  public static getInstance(): GlobalStateManager {
    if (!GlobalStateManager.instance) {
      GlobalStateManager.instance = new GlobalStateManager();
    }
    return GlobalStateManager.instance;
  }

  public getState(): GlobalState {
    return this.state;
  }

  public updateState(newState: Partial<GlobalState>): void {
    this.state = { ...this.state, ...newState };
  }
}

export const globalStateManager = GlobalStateManager.getInstance();
