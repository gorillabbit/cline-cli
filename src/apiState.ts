import { ApiProvider, ModelInfo } from "./shared/api.js";
import { ChatSettings } from "./shared/ChatSettings.js";
import { HistoryItem } from "./shared/HistoryItem.js";

export interface ApiState {
    apiProvider: ApiProvider,
    apiModelId: string,
    apiKey: string,
    openRouterApiKey: string,
    awsAccessKey: string,
    awsSecretKey: string,
    awsSessionToken: string,
    awsRegion: string,
    awsUseCrossRegionInference: boolean,
    vertexProjectId: string,
    vertexRegion: string,
    openAiBaseUrl: string,
    openAiApiKey: string,
    openAiModelId: string,
    ollamaModelId: string,
    ollamaBaseUrl: string,
    lmStudioModelId: string,
    lmStudioBaseUrl: string,
    anthropicBaseUrl: string,
    geminiApiKey: string,
    openAiNativeApiKey: string,
    deepSeekApiKey: string,
    mistralApiKey: string,
    azureApiVersion: string,
    openRouterModelId: string,
    openRouterModelInfo: ModelInfo,
    lastShownAnnouncementId: string,
    customInstructions: string,
    taskHistory: HistoryItem[],
    autoApprovalSetting: string,
    chatSettings: ChatSettings,
    userInfo: string,
    authToken: string,
    previousModeApiProvider: ApiProvider,
    previousModeModelId: string,
    previousModeModelInfo: ModelInfo,

}
  
class ApiStateManager {
  private static instance: ApiStateManager;
  private state: ApiState = {
      apiProvider: "anthropic",
      apiModelId: "",
      apiKey: "",
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
      geminiApiKey: "",
      openAiNativeApiKey: "",
      deepSeekApiKey: "",
      mistralApiKey: "",
      azureApiVersion: "",
      openRouterModelId: "",
      openRouterModelInfo: {
        supportsPromptCache: false
      },
      lastShownAnnouncementId: "",
      customInstructions: "",
      taskHistory: [],
      autoApprovalSetting: "",
      chatSettings: {
        mode: "plan"
      },
      userInfo: "",
      authToken: "",
      previousModeApiProvider: "anthropic",
      previousModeModelId: "",
      previousModeModelInfo: {
        supportsPromptCache: false
      },
  };

  private constructor() {}

  public static getInstance(): ApiStateManager {
    if (!ApiStateManager.instance) {
      ApiStateManager.instance = new ApiStateManager();
    }
    return ApiStateManager.instance;
  }

  public getState(): ApiState {
    return this.state;
  }

  public updateState(newState: Partial<ApiState>): void {
    this.state = { ...this.state, ...newState };
  }
}

export const apiStateManager = ApiStateManager.getInstance();
