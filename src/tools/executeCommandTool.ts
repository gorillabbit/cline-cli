import { ToolResponse } from "../types.js"
import { formatResponse } from "../prompts/responses.js"
import { say } from "../tasks.js"
import { Say } from "../database.js"
import { exec } from "child_process"
import { promisify } from "util"
import { randomUUID } from "crypto"
import fs from "fs/promises"

const execAsync = promisify(exec)

const getGitInfo = async () => {
	try {
		const { stdout } = await execAsync("git remote -v")
		return stdout.trim()
	} catch {
		return "Not a Git repository"
	}
}

const runCommand = async (command: string, tempFilePath: string, gitInfo: string, cwd: string) => {
	try {
		const logContent = `Command: ${command}\nGit Repository: ${gitInfo}\nCurrent Directory: ${cwd}\n\n`
		await fs.writeFile(tempFilePath, logContent)
		await execAsync(`${command} >> ${tempFilePath} 2>&1`)

		const output = await fs.readFile(tempFilePath, "utf-8")

		return { type: "success", output: output }
	} catch (error) {
		console.error(`An error occurred: ${error.message}`)
		const output = await fs.readFile(tempFilePath, "utf-8")
		return { type: "error", output: output }
	}
}

/**
 * Executes the command tool and processes the command output and user feedback.
 * @param {string} command - The command to execute.
 * @returns {Promise<[ToolResponse]>} - A promise that resolves to a tuple containing the user-rejected flag and the tool response.
 */
export const executeCommandTool = async (command: string): Promise<[ToolResponse]> => {
	const timestamp = Date.now()
	const uuid = randomUUID()
	const tempFilePath = `/tmp/cline-command-output-${timestamp}-${uuid}.log`
	const gitInfo = await getGitInfo()
	const cwd = process.cwd()
	const { type, output } = await runCommand(command, tempFilePath, gitInfo, cwd)
	await say(Say.COMMAND_OUTPUT, output)

	if (type === "error") {
		console.error("Command execution failed:", output)
		return [formatResponse.toolError(output)]
	}

	return [formatResponse.toolResult(output, undefined)]
}
