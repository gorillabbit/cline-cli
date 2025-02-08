import { globalStateManager } from "./globalState.js"
import { saveClineMessages } from "./tasks.js"

export const saveCheckpoint = async () => {
    const stats = globalStateManager.state
    const commitHash = await stats.checkpointTracker?.commit() // silently fails for now
    if (commitHash) {
        // Start from the end and work backwards until we find a tool use or another message with a hash
        for (let i = stats.clineMessages.length - 1; i >= 0; i--) {
            const message = stats.clineMessages[i]
            if (message.lastCheckpointHash) {
                // Found a message with a hash, so we can stop
                break
            }
            // Update this message with a hash
            message.lastCheckpointHash = commitHash

            // We only care about adding the hash to the last tool use (we don't want to add this hash to every prior message ie for tasks pre-checkpoint)
            const isToolUse =
                message.say === "tool" ||
                message.ask === "tool" ||
                message.say === "command" ||
                message.ask === "command" ||
                message.say === "completion_result" ||
                message.ask === "completion_result" ||
                message.ask === "followup" ||
                message.say === "use_mcp_server" ||
                message.ask === "use_mcp_server" ||
                message.say === "browser_action" ||
                message.say === "browser_action_launch" ||
                message.ask === "browser_action_launch"

            if (isToolUse) {
                break
            }
        }
        // Save the updated messages
        await saveClineMessages()
    }
}
