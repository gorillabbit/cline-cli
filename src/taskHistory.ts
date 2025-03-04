// Task history

import fs from "fs/promises"
import Anthropic from "@anthropic-ai/sdk"
import { HistoryItem } from "./shared/HistoryItem.js"
import path from "path"
import { GlobalFileNames, taskBaseDir } from "./const.js"
import { fileExistsAtPath } from "./utils/fs.js"
import { globalStateManager } from "./globalState.js"
import { abortTask } from "./lifecycle.js"

const state = globalStateManager.state

export const getTaskWithId = async (
	id: string,
): Promise<{
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

const deleteTaskFromState = (id: string) => {
	// Remove the task from history
	const taskHistory = state.taskHistory
	const updatedTaskHistory = taskHistory.filter((task) => task.id !== id)
	globalStateManager.updateState({ taskHistory: updatedTaskHistory })
}

const clearTask = () => {
	abortTask()
}

export const initClineWithHistoryItem = () => {
	clearTask()
}
