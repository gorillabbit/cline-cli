import delay from "delay"
import { ToolResponse } from "../types.js";
import { ask } from "../chat.js";
import { formatResponse } from "../prompts/responses.js";
import { say } from "../tasks.js";
import { Ask, Say } from "../database.js";


/**
 * Executes a command tool and handles command output and user feedback.
 * @param {string} command - The command to execute.
 * @returns {Promise<[boolean, ToolResponse]>} - A promise resolving to a tuple containing userRejected flag and tool response.
 */
export const executeCommandTool = async (command: string): Promise<[boolean, ToolResponse]> => {
    console.log("executeCommandTool started", { command }); // Log: Function execution start with command
    let userFeedback: { text?: string; images?: string } | undefined
    let didContinue = false
    const sendCommandOutput = async (line: string): Promise<void> => {
        try {
            const { response, text, images } = await ask(Ask.COMMAND_OUTPUT, line)
            if (response === "yesButtonClicked") {
                // proceed while running
            } else {
                userFeedback = { text, images }
            }
            didContinue = true
            process // continue past the await
        } catch {
            // This can only happen if this ask promise was ignored, so ignore this error
        }
    }

    let result = ""
    process.on("line", async (line) => {
        result += line + "\n"
        if (!didContinue) {
            sendCommandOutput(line)
        } else {
            await say(Say.COMMAND_OUTPUT, line)
        }
    })

    let completed = false
    process.once("completed", () => {
        completed = true
    })

    process.once("no_shell_integration", async () => {
        await say(Say.SHELL_INTEGRATION_WARNING)
    })

    process

    await delay(50)

    result = result.trim()

    if (userFeedback) {
        await say(Say.USER_FEEDBACK, userFeedback.text, userFeedback.images)
        console.log("executeCommandTool user feedback", { userFeedback }); // Log: User feedback received
        return [
            true,
            formatResponse.toolResult(
                `Command is still running in the user's terminal.${
                    result.length > 0 ? `\nHere's the output so far:\n${result}` : ""
                }\n\nThe user provided the following feedback:\n<feedback>\n${userFeedback.text}\n</feedback>`,
                userFeedback.images,
            ),
        ]
    }

    if (completed) {
        console.log("executeCommandTool completed", { result }); // Log: Command execution completed
        return [false, `Command executed.${result.length > 0 ? `\nOutput:\n${result}` : ""}`]
    } else {
        console.log("executeCommandTool still running", { result }); // Log: Command still running
        return [
            false,
            `Command is still running in the user's terminal.${
                result.length > 0 ? `\nHere's the output so far:\n${result}` : ""
            }\n\nYou will be updated on the terminal status and new output in the future.`,
        ]
    }
}
