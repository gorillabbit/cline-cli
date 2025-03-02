import path from "path"
import os from "os"
import { cwd } from "process"
import { listFiles } from "../services/glob/list-files.js"
import { arePathsEqual } from "../utils/path.js"
import { parseMentions } from "../mentions/index.js"
import { globalStateManager } from "../globalState.js"
import { formatResponse } from "../prompts/responses.js"
import { UserContent } from "../types.js"

/**
 * Loads context information (parsed user content, environment details, etc.).
 * @param {UserContent} userContent - The user content to load the context for.
 * @param {boolean} [includeFileDetails=false] - Whether to include file details in the environment context.
 * @returns The parsed user content and environment details.
 */
export const loadContext = async (userContent: UserContent, includeFileDetails: boolean = false) => {
	const result = await Promise.all([
		Promise.all(
			userContent.map(async (block) => {
				if (block.type === "text") {
					// We need to ensure any user generated content is wrapped in one of these tags so that we know to parse mentions
					// FIXME: Only parse text in between these tags instead of the entire text block which may contain other tool results. This is part of a larger issue where we shouldn't be using regex to parse mentions in the first place (ie for cases where file paths have spaces)
					if (
						block.text.includes("<feedback>") ||
						block.text.includes("<answer>") ||
						block.text.includes("<task>") ||
						block.text.includes("<user_message>")
					) {
						return {
							...block,
							text: await parseMentions(block.text, globalStateManager.state.workspaceFolder ?? cwd()),
						}
					}
				}
				return block
			}),
		),
		getEnvironmentDetails(includeFileDetails),
	])
	return result
}

/**
 * Gets environment details (current time, files in the working directory, current mode, etc.).
 * @param {boolean} [includeFileDetails=false] - Whether to include file details.
 * @returns Environment details formatted as a string.
 */
export const getEnvironmentDetails = async (includeFileDetails: boolean = false): Promise<string> => {
	let details = ""

	const state = globalStateManager.state

	if (includeFileDetails) {
		details += `\n\n# Current Working Directory (${state.workspaceFolder}) Files\n`
		const isDesktop = arePathsEqual(state.workspaceFolder, path.join(os.homedir(), "Desktop"))
		if (isDesktop) {
			// don't want to immediately access desktop since it would show permission popup
			details += "(Desktop files not shown automatically. Use list_files to explore if needed.)"
		} else {
			if (state.workspaceFolder) {
				const [files, didHitLimit] = await listFiles(state.workspaceFolder, true, 200)
				const result = formatResponse.formatFilesList(state.workspaceFolder, files, didHitLimit)
				details += result
			}
		}
	}

	details += "\n\n# Current Mode"
	if (state.chatSettings.mode === "plan") {
		details += "\nPLAN MODE"
		details +=
			"\nIn this mode you should focus on information gathering, asking questions, and architecting a solution. Once you have a plan, use the plan_mode_response tool to engage in a conversational back and forth with the user. Do not use the plan_mode_response tool until you've gathered all the information you need e.g. with read_file or ask_followup_question."
		details +=
			'\n(Remember: If it seems the user wants you to use tools only available in Act Mode, you should ask the user to "toggle to Act mode" (use those words) - they will have to manually do this themselves with the Plan/Act toggle button below. You do not have the ability to switch to Act Mode yourself, and must wait for the user to do it themselves once they are satisfied with the plan.)'
	} else {
		details += "\nACT MODE"
	}
	return `<environment_details>\n${details.trim()}\n</environment_details>`
}
