// Task history

import fs from "fs/promises"
import Anthropic from "@anthropic-ai/sdk"
import { HistoryItem } from "./shared/HistoryItem.js"
import path from "path"
import { GlobalFileNames, taskBaseDir } from "./const.js"
import { downloadTask } from "./integrations/misc/export-markdown.js"
import { fileExistsAtPath } from "./utils/fs.js"
import { globalStateManager } from "./globalState.js"
import { abortTask } from "./lifecycle.js"

const state = globalStateManager.state

export const getTaskWithId = async (id: string): Promise<{
    historyItem: HistoryItem
    taskDirPath: string
    apiConversationHistoryFilePath: string
    uiMessagesFilePath: string
    apiConversationHistory: Anthropic.MessageParam[]
}> => {
    const history = state.taskHistory
    const historyItem = history.find((item) => item.id === id)
    if (historyItem) {
        const taskDirPath = path.join(taskBaseDir, id)
        const apiConversationHistoryFilePath = path.join(taskDirPath, GlobalFileNames.apiConversationHistory)
        const uiMessagesFilePath = path.join(taskDirPath, GlobalFileNames.uiMessages)
        const fileExists = await fileExistsAtPath(apiConversationHistoryFilePath)
        if (fileExists) {
            const apiConversationHistory = JSON.parse(await fs.readFile(apiConversationHistoryFilePath, "utf8"))
            return {
                historyItem,
                taskDirPath,
                apiConversationHistoryFilePath,
                uiMessagesFilePath,
                apiConversationHistory,
            }
        }
    }
    // if we tried to get a task that doesn't exist, remove it from state
    // FIXME: this seems to happen sometimes when the json file doesnt save to disk for some reason
    deleteTaskFromState(id)
    throw new Error("Task not found")
}

const showTaskWithId = async (id: string) => {
    if (id !== state.taskId) {
        // non-current task
        const { historyItem } = await getTaskWithId(id)
        initClineWithHistoryItem(historyItem) // clears existing task
    }
    console.log("showTaskWithId", id)
}

const exportTaskWithId = async (id: string) => {
    const { historyItem, apiConversationHistory } = await getTaskWithId(id)
    await downloadTask(historyItem.ts, apiConversationHistory)
}

const deleteTaskWithId = async (id: string) => {
    if (id === state.taskId) {
        clearTask()
    }

    const { taskDirPath, apiConversationHistoryFilePath, uiMessagesFilePath } = await getTaskWithId(id)

    deleteTaskFromState(id)

    // Delete the task files
    const apiConversationHistoryFileExists = await fileExistsAtPath(apiConversationHistoryFilePath)
    if (apiConversationHistoryFileExists) {
        await fs.unlink(apiConversationHistoryFilePath)
    }
    const uiMessagesFileExists = await fileExistsAtPath(uiMessagesFilePath)
    if (uiMessagesFileExists) {
        await fs.unlink(uiMessagesFilePath)
    }
    const legacyMessagesFilePath = path.join(taskDirPath, "claude_messages.json")
    if (await fileExistsAtPath(legacyMessagesFilePath)) {
        await fs.unlink(legacyMessagesFilePath)
    }

    // Delete the checkpoints directory if it exists
    const checkpointsDir = path.join(taskDirPath, "checkpoints")
    if (await fileExistsAtPath(checkpointsDir)) {
        try {
            await fs.rm(checkpointsDir, { recursive: true, force: true })
        } catch (error) {
            console.error(`Failed to delete checkpoints directory for task ${id}:`, error)
            // Continue with deletion of task directory - don't throw since this is a cleanup operation
        }
    }

    await fs.rmdir(taskDirPath) // succeeds if the dir is empty
}

const deleteTaskFromState = (id: string) => {
    // Remove the task from history
    const taskHistory = state.taskHistory
    const updatedTaskHistory = taskHistory.filter((task) => task.id !== id)
    globalStateManager.updateState({ taskHistory: updatedTaskHistory })
}

const clearTask = () => {
    abortTask()
}

const initClineWithTask = (task?: string, images?: string[]) => {
    clearTask()
}

export const initClineWithHistoryItem = (historyItem: HistoryItem) => {
    clearTask()
}
