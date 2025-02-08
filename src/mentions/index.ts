import * as path from "path"
import fs from "fs/promises"
import { isBinaryFile } from "isbinaryfile"
import { extractTextFromFile } from "../integrations/misc/extract-text.js"
import { mentionRegexGlobal } from "../shared/context-mentions.js"
import { globalStateManager } from "../globalState.js"

export async function openMention(mention?: string): Promise<void> {
	if (!mention) {
		return
	}

	if (mention.startsWith("/")) {
		const relPath = mention.slice(1)
		const cwd = globalStateManager.state.workspaceFolder
		if (!cwd) {
			return
		}
		const absPath = path.resolve(cwd, relPath)
		if (mention.endsWith("/")) {
			await fs.readdir(absPath)
		}
	}
}

export async function parseMentions(text: string, cwd: string): Promise<string> {
	const mentions: Set<string> = new Set()
	let parsedText = text.replace(mentionRegexGlobal, (match, mention) => {
		mentions.add(mention)
		if (mention.startsWith("http")) {
			return `'${mention}' (see below for site content)`
		} else if (mention.startsWith("/")) {
			const mentionPath = mention.slice(1) // Remove the leading '/'
			return mentionPath.endsWith("/")
				? `'${mentionPath}' (see below for folder content)`
				: `'${mentionPath}' (see below for file content)`
		} else if (mention === "problems") {
			return `Workspace Problems (see below for diagnostics)`
		}
		return match
	})

	for (const mention of mentions) {
		if (mention.startsWith("http")) {} else if (mention.startsWith("/")) {
			const mentionPath = mention.slice(1)
			try {
				const content = await getFileOrFolderContent(mentionPath, cwd)
				if (mention.endsWith("/")) {
					parsedText += `\n\n<folder_content path="${mentionPath}">\n${content}\n</folder_content>`
				} else {
					parsedText += `\n\n<file_content path="${mentionPath}">\n${content}\n</file_content>`
				}
			} catch (error) {
				if (mention.endsWith("/")) {
					parsedText += `\n\n<folder_content path="${mentionPath}">\nError fetching content: ${error.message}\n</folder_content>`
				} else {
					parsedText += `\n\n<file_content path="${mentionPath}">\nError fetching content: ${error.message}\n</file_content>`
				}
			}
		} else if (mention === "problems") {
			try {
				const problems = getWorkspaceProblems()
				parsedText += `\n\n<workspace_diagnostics>\n${problems}\n</workspace_diagnostics>`
			} catch (error) {
				parsedText += `\n\n<workspace_diagnostics>\nError fetching diagnostics: ${error.message}\n</workspace_diagnostics>`
			}
		}
	}

	return parsedText
}

async function getFileOrFolderContent(mentionPath: string, cwd: string): Promise<string> {
	const absPath = path.resolve(cwd, mentionPath)

	try {
		const stats = await fs.stat(absPath)

		if (stats.isFile()) {
			const isBinary = await isBinaryFile(absPath).catch(() => false)
			if (isBinary) {
				return "(Binary file, unable to display content)"
			}
			const content = await extractTextFromFile(absPath)
			return content
		} else if (stats.isDirectory()) {
			const entries = await fs.readdir(absPath, { withFileTypes: true })
			let folderContent = ""
			const fileContentPromises: Promise<string | undefined>[] = []
			entries.forEach((entry, index) => {
				const isLast = index === entries.length - 1
				const linePrefix = isLast ? "└── " : "├── "
				if (entry.isFile()) {
					folderContent += `${linePrefix}${entry.name}\n`
					const filePath = path.join(mentionPath, entry.name)
					const absoluteFilePath = path.resolve(absPath, entry.name)
					// const relativeFilePath = path.relative(cwd, absoluteFilePath);
					fileContentPromises.push(
						(async () => {
							try {
								const isBinary = await isBinaryFile(absoluteFilePath).catch(() => false)
								if (isBinary) {
									return undefined
								}
								const content = await extractTextFromFile(absoluteFilePath)
								return `<file_content path="${filePath.toPosix()}">\n${content}\n</file_content>`
							} catch (error) {
								return undefined
							}
						})(),
					)
				} else if (entry.isDirectory()) {
					folderContent += `${linePrefix}${entry.name}/\n`
					// not recursively getting folder contents
				} else {
					folderContent += `${linePrefix}${entry.name}\n`
				}
			})
			const fileContents = (await Promise.all(fileContentPromises)).filter((content) => content)
			return `${folderContent}\n${fileContents.join("\n\n")}`.trim()
		} else {
			return `(Failed to read contents of ${mentionPath})`
		}
	} catch (error) {
		throw new Error(`Failed to access path "${mentionPath}": ${error.message}`)
	}
}

// コードのエラーを取得する関数
function getWorkspaceProblems() {

	throw new Error("Function not implemented.")
}

