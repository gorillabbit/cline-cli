import path from "path"

import os from "os";

const homeDir = os.homedir();
export const globalStoragePath =path.join(homeDir, ".cline")

export const taskBaseDir = path.join(globalStoragePath, "tasks")

export const GlobalFileNames = {
    apiConversationHistory: "api_conversation_history.json",
    uiMessages: "ui_messages.json",
    clineRules: ".clinerules",
}