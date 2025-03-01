import { findLastIndex, findLast } from "../shared/array.js"
import CheckpointTracker from "../integrations/checkpoints/CheckpointTracker.js"
import { globalStateManager } from "../globalState.js"

/**
 * Checks if the latest task completion has new changes in the workspace.
 * @returns {Promise<boolean>} - Promise resolving to true if there are new changes, false otherwise.
 */
export const doesLatestTaskCompletionHaveNewChanges = async (): Promise<boolean> => {
	const state = globalStateManager.state
	const messageIndex = findLastIndex(state.clineMessages, (m) => m.say === "completion_result")
	const message = state.clineMessages[messageIndex]
	if (!message) {
		console.error("Completion message not found")
		return false
	}
	const hash = message.lastCheckpointHash
	if (!hash) {
		console.error("No checkpoint hash found")
		return false
	}

	if (!state.checkpointTracker) {
		try {
			state.checkpointTracker = await CheckpointTracker.create(state.taskId)
			state.checkpointTrackerErrorMessage = undefined
		} catch (error) {
			const errorMessage = error instanceof Error ? error.message : "Unknown error"
			console.error("Failed to initialize checkpoint tracker:", errorMessage)
			return false
		}
	}

	// Get last task completed
	const lastTaskCompletedMessage = findLast(state.clineMessages.slice(0, messageIndex), (m) => m.say === "completion_result")

	try {
		// Get changed files between current state and commit
		const changedFiles = await state.checkpointTracker?.getDiffSet(
			lastTaskCompletedMessage?.lastCheckpointHash, // if undefined, then we get diff from beginning of git history, AKA when the task was started
			hash,
		)
		const changedFilesCount = changedFiles?.length || 0
		if (changedFilesCount > 0) {
			return true
		}
	} catch (error) {
		console.error("Failed to get diff set:", error)
		return false
	}
	return false
}
