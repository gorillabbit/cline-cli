import { ClineConfig, ensureTaskDirectoryExists } from "./tasks.js"
import { randomUUID } from "crypto"
import { globalStateManager } from "./globalState.js"
import { ApiProvider } from "./shared/api.js"
import { startTask } from "./lifecycle.js"
import { initDB } from "./database.js"
import { getConfig, setConfig } from "./utils/fs.js"
import * as readline from "readline"
import yargs from "yargs"
import fs from "fs"

const requireApiKey = async (config: ClineConfig, keyName: keyof ClineConfig) => {
	if (!config[keyName]) {
		const rl = readline.createInterface({ input: process.stdin, output: process.stdout })
		try {
			const answer = await new Promise<string>((resolve) => {
				rl.question(`Value not found. Please enter a new ${keyName}: `, resolve)
			})
			await setConfig({ [keyName]: answer })
			console.log(`New ${keyName} has been set: ${answer}`)
		} catch (err) {
			console.error("An error occurred:", err)
		} finally {
			rl.close()
		}
	}
}

/**
 * main: Read input JSON and execute each modification task in parallel.
 */
async function main() {
	// Execute AI processing from CLI
	const taskId = randomUUID()
	await ensureTaskDirectoryExists(taskId)

	const argv = await yargs(process.argv.slice(2)).option("file", {
		alias: "f",
		describe: "Path to the prompt file",
		type: "string",
	}).argv

	// Get instructions and target repository path from command arguments
	const workspaceFolder = argv._[0] as string
	let instruction = argv._[1] as string
	globalStateManager.state.workspaceFolder = workspaceFolder

	if (argv.file) {
		try {
			instruction = fs.readFileSync(argv.file, "utf-8")
		} catch (error) {
			console.error("Error reading prompt file:", error)
			process.exit(1)
		}
	}

	if (argv._.length > 2) {
		const apiProvider = argv._[2]
		await setConfig({ apiProvider: apiProvider as ApiProvider })
	}

	const config = await getConfig()
	switch (config?.apiProvider) {
		case "openai":
			await requireApiKey(config, "openAiApiKey")
			break
		case "ollama":
			await requireApiKey(config, "ollamaModelId")
			break
		case "lmstudio":
			await requireApiKey(config, "lmStudioModelId")
			break
		case "openrouter":
			await requireApiKey(config, "openRouterApiKey")
			break
		case "vertex":
			await requireApiKey(config, "vertexProjectId")
			break
		case "deepseek":
			await requireApiKey(config, "deepSeekApiKey")
			break
		case "mistral":
			await requireApiKey(config, "mistralApiKey")
			break
		case "gemini":
			await requireApiKey(config, "geminiApiKey")
			break
	}
	await initDB()
	await startTask(instruction)
	process.exit(0)
}

main().catch((error) => {
	if (error instanceof Error) {
		console.error("Error message:", error.message)
		console.error("Stack trace:", error.stack)
	} else {
		console.error("Unexpected error:", error)
	}
	process.exit(1)
})
