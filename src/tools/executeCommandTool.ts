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
		console.error(`エラーが発生しました: ${error.message}`)
		const output = await fs.readFile(tempFilePath, "utf-8")
		return { type: "error", output: output }
	}
}

/**
 * コマンドツールを実行し、コマンド出力とユーザーフィードバックを処理します。
 * @param {string} command - 実行するコマンド。
 * @returns {Promise<[boolean, ToolResponse]>} - ユーザーが拒否したフラグとツール応答を含むタプルに解決されるプロミス。
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
