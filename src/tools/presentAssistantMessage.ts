import Anthropic from "@anthropic-ai/sdk"
import path from "path"
import { cwd } from "process"
import { serializeError } from "serialize-error"
import cloneDeep from "clone-deep"
import delay from "delay"
import { ToolParamName } from "../assistant-message/index.js"
import { ask } from "../chat.js"
import { saveCheckpoint } from "../checkpoint.js"
import { shouldAutoApproveTool } from "../clineUtils.js"
import { globalStateManager } from "../globalState.js"
import { extractTextFromFile } from "../integrations/misc/extract-text.js"
import { showSystemNotification } from "../notifications/index.js"
import { formatResponse } from "../prompts/responses.js"
import { listFiles } from "../services/glob/list-files.js"
import { regexSearchFiles } from "../services/ripgrep/index.js"
import { parseSourceCodeForDefinitionsTopLevel } from "../services/tree-sitter/index.js"
import { findLast } from "../shared/array.js"
import { say, removeLastPartialMessageIfExistsWithType, sayAndCreateMissingParamError, saveClineMessages } from "../tasks.js"
import { ToolResponse, ClineAsk, ClineSayTool, COMPLETION_RESULT_CHANGES_FLAG } from "../types.js"
import { getReadablePath } from "../utils/path.js"
import { fixModelHtmlEscaping, removeInvalidChars } from "../utils/string.js"
import { doesLatestTaskCompletionHaveNewChanges } from "./doesLatestTaskCompletionHaveNewChanges.js"
import { executeCommandTool } from "./executeCommandTool.js"
import { apiStateManager } from "../apiState.js"
import { buildApiHandler } from "../api/index.js"


/**
 * Presents assistant messages to the user, handling different content blocks and tool interactions.
 */
export const presentAssistantMessage = async () => {

    console.log("presentAssistantMessage started"); // Log: Function execution start
    const apiState = apiStateManager.getState()
    const apiHandler = buildApiHandler(apiState)
    if (globalStateManager.getState().abort) {
        throw new Error("Cline instance aborted")
    }

    if (globalStateManager.getState().presentAssistantMessageLocked) {
        globalStateManager.updateState({
            presentAssistantMessageHasPendingUpdates: true,
        })
        return
    }
    globalStateManager.updateState({
        presentAssistantMessageLocked: true,
        presentAssistantMessageHasPendingUpdates: false,
    })

    if (globalStateManager.getState().currentStreamingContentIndex >= globalStateManager.getState().assistantMessageContent.length) {
        // このケースは、ストリーミングが完了する前に最後のコンテンツブロックが完了した場合に発生する可能性があります。
        // ストリーミングが完了し、範囲外になった場合、これはすでに最後のコンテンツブロックを提示/実行し、次のリクエストに進む準備ができていることを意味します
        if (globalStateManager.getState().didCompleteReadingStream) {
            globalStateManager.updateState({
                userMessageContentReady: true,
            })
        }
        globalStateManager.updateState({
            presentAssistantMessageLocked: false,
        })
        return
    }
    // ストリームが配列を更新している間、参照ブロックプロパティも更新されている可能性があるため、コピーを作成する必要があります
    const block = cloneDeep(globalStateManager.getState().assistantMessageContent[globalStateManager.getState().currentStreamingContentIndex])
    switch (block.type) {
        case "text": {
            if (globalStateManager.getState().didRejectTool || globalStateManager.getState().didAlreadyUseTool) {
                break
            }
            let content = block.content
            if (content) {
                content = content.replace(/<thinking>\s?/g, "")
                content = content.replace(/\s?<\/thinking>/g, "")

                // Remove partial XML tag at the very end of the content (for tool use and thinking tags)
                // (prevents scrollview from jumping when tags are automatically removed)
                const lastOpenBracketIndex = content.lastIndexOf("<")
                if (lastOpenBracketIndex !== -1) {
                    const possibleTag = content.slice(lastOpenBracketIndex)
                    // Check if there's a '>' after the last '<' (i.e., if the tag is complete) (complete thinking and tool tags will have been removed by now)
                    const hasCloseBracket = possibleTag.includes(">")
                    if (!hasCloseBracket) {
                        // Extract the potential tag name
                        let tagContent: string
                        if (possibleTag.startsWith("</")) {
                            tagContent = possibleTag.slice(2).trim()
                        } else {
                            tagContent = possibleTag.slice(1).trim()
                        }
                        // Check if tagContent is likely an incomplete tag name (letters and underscores only)
                        const isLikelyTagName = /^[a-zA-Z_]+$/.test(tagContent)
                        // Preemptively remove < or </ to keep from these artifacts showing up in chat (also handles closing thinking tags)
                        const isOpeningOrClosing = possibleTag === "<" || possibleTag === "</"
                        // If the tag is incomplete and at the end, remove it from the content
                        if (isOpeningOrClosing || isLikelyTagName) {
                            content = content.slice(0, lastOpenBracketIndex).trim()
                        }
                    }
                }
            }

            if (!block.partial) {
                // Some models add code block artifacts (around the tool calls) which show up at the end of text content
                // matches ``` with atleast one char after the last backtick, at the end of the string
                const match = content?.trimEnd().match(/```[a-zA-Z0-9_-]+$/)
                if (match) {
                    const matchLength = match[0].length
                    content = content.trimEnd().slice(0, -matchLength)
                }
            }

            await say("text", content, undefined, block.partial)
            break
        }
        case "tool_use":
            const toolDescription = () => {
                switch (block.name) {
                    case "execute_command":
                        return `[${block.name} for '${block.params.command}']`
                    case "read_file":
                        return `[${block.name} for '${block.params.path}']`
                    case "write_to_file":
                        return `[${block.name} for '${block.params.path}']`
                    case "replace_in_file":
                        return `[${block.name} for '${block.params.path}']`
                    case "search_files":
                        return `[${block.name} for '${block.params.regex}'${
                            block.params.file_pattern ? ` in '${block.params.file_pattern}'` : ""
                        }]`
                    case "list_files":
                        return `[${block.name} for '${block.params.path}']`
                    case "list_code_definition_names":
                        return `[${block.name} for '${block.params.path}']`
                    case "browser_action":
                        return `[${block.name} for '${block.params.action}']`
                    case "use_mcp_tool":
                        return `[${block.name} for '${block.params.server_name}']`
                    case "access_mcp_resource":
                        return `[${block.name} for '${block.params.server_name}']`
                    case "ask_followup_question":
                        return `[${block.name} for '${block.params.question}']`
                    case "plan_mode_response":
                        return `[${block.name}]`
                    case "attempt_completion":
                        return `[${block.name}]`
                }
            }
            const userMessageContent = globalStateManager.getState().userMessageContent
            if (globalStateManager.getState().didRejectTool) {
                // ignore any tool content after user has rejected tool once
                
                if (!block.partial) {
                    userMessageContent.push({
                        type: "text",
                        text: `Skipping tool ${toolDescription()} due to user rejecting a previous tool.`,
                    })
                } else {
                    // partial tool after user rejected a previous tool
                    userMessageContent.push({
                        type: "text",
                        text: `Tool ${toolDescription()} was interrupted and not executed due to user rejecting a previous tool.`,
                    })
                }
                globalStateManager.updateState({
                    userMessageContent:userMessageContent
                })
                break
            }

            if (globalStateManager.getState().didAlreadyUseTool) {
                // ignore any content after a tool has already been used
                userMessageContent.push({
                    type: "text",
                    text: `Tool [${block.name}] was not executed because a tool has already been used in this message. Only one tool may be used per message. You must assess the first tool's result before proceeding to use the next tool.`,
                })
                globalStateManager.updateState({
                    userMessageContent:userMessageContent
                })
                break
            }

            const pushToolResult = (content: ToolResponse) => {
                userMessageContent.push({
                    type: "text",
                    text: `${toolDescription()} Result:`,
                })
                if (typeof content === "string") {
                    userMessageContent.push({
                        type: "text",
                        text: content || "(tool did not return anything)",
                    })
                } else {
                    userMessageContent.push(...content)
                }
                // once a tool result has been collected, ignore all other tool uses since we should only ever present one tool result per message
                globalStateManager.updateState({
                    didAlreadyUseTool: true,
                    userMessageContent:userMessageContent
                })
            }

            // ツールを使用する前に、ユーザーに承認を求める
            const askApproval = async (type: ClineAsk, partialMessage?: string) => {
                const { response, text, images } = await ask(type, partialMessage, false)
                if (response !== "yesButtonClicked") {
                    if (response === "messageResponse") {
                        await say("user_feedback", text, images)
                        pushToolResult(formatResponse.toolResult(formatResponse.toolDeniedWithFeedback(text), images))
                        globalStateManager.updateState({
                            didRejectTool: true,
                        })
                        return false
                    }
                    pushToolResult(formatResponse.toolDenied())
                    globalStateManager.updateState({
                        didRejectTool: true,
                    })
                    return false
                }
                return true
            }

            // ツールの使用を自動承認する場合、ツールの使用をスキップして結果を表示します
            const showNotificationForApprovalIfAutoApprovalEnabled = (message: string) => {
                if (globalStateManager.getState().autoApprovalSettings.enabled && globalStateManager.getState().autoApprovalSettings.enableNotifications) {
                    showSystemNotification({
                        subtitle: "Approval Required",
                        message,
                    })
                }
            }

            const handleError = async (action: string, error: Error) => {
                if (globalStateManager.getState().abandoned) {
                    console.log("Ignoring error since task was abandoned (i.e. from task cancellation after resetting)")
                    return
                }
                const errorString = `Error ${action}: ${JSON.stringify(serializeError(error))}`
                await say(
                    "error",
                    `Error ${action}:\n${error.message ?? JSON.stringify(serializeError(error), null, 2)}`,
                )
                pushToolResult(formatResponse.toolError(errorString))
            }

            // ブロックが部分的な場合、部分的なクロージングタグを削除してユーザーに表示されないようにします
            const removeClosingTag = (tag: ToolParamName, text?: string) => {
                if (!block.partial) {
                    return text || ""
                }
                if (!text) {
                    return ""
                }
                // This regex dynamically constructs a pattern to match the closing tag:
                // - Optionally matches whitespace before the tag
                // - Matches '<' or '</' optionally followed by any subset of characters from the tag name
                const tagRegex = new RegExp(
                    `\\s?<\/?${tag
                        .split("")
                        .map((char) => `(?:${char})?`)
                        .join("")}$`,
                    "g",
                )
                return text.replace(tagRegex, "")
            }

            switch (block.name) {
                case "write_to_file":
                case "replace_in_file": {
                    const relPath: string | undefined = block.params.path
                    let content: string | undefined = block.params.content // for write_to_file
                    let diff: string | undefined = block.params.diff // for replace_in_file
                    if (!relPath || (!content && !diff)) {
                        // checking for content/diff ensures relPath is complete
                        // wait so we can determine if it's a new file or editing an existing file
                        break
                    }
                    // Check if file exists using cached map or fs.access
                    let fileExists: boolean = false

                    try {
                        // Construct newContent from diff
                        let newContent: string = ""
                        if (diff) {
                            if (!apiHandler.getModel().id.includes("claude")) {
                                // deepseek models tend to use unescaped html entities in diffs
                                diff = fixModelHtmlEscaping(diff)
                                diff = removeInvalidChars(diff)
                            }
                        } else if (content) {
                            newContent = content

                            // pre-processing newContent for cases where weaker models might add artifacts like markdown codeblock markers (deepseek/llama) or extra escape characters (gemini)
                            if (newContent.startsWith("```")) {
                                // this handles cases where it includes language specifiers like ```python ```js
                                newContent = newContent.split("\n").slice(1).join("\n").trim()
                            }
                            if (newContent.endsWith("```")) {
                                newContent = newContent.split("\n").slice(0, -1).join("\n").trim()
                            }

                            if (!apiHandler.getModel().id.includes("claude")) {
                                // it seems not just llama models are doing this, but also gemini and potentially others
                                newContent = fixModelHtmlEscaping(newContent)
                                newContent = removeInvalidChars(newContent)
                            }
                        } else {
                            // can't happen, since we already checked for content/diff above. but need to do this for type error
                            break
                        }

                        newContent = newContent.trimEnd() // remove any trailing newlines, since it's automatically inserted by the editor

                        const sharedMessageProps: ClineSayTool = {
                            tool: fileExists ? "editedExistingFile" : "newFileCreated",
                            path: getReadablePath(cwd(), removeClosingTag("path", relPath)),
                            content: diff || content,
                        }

                        if (block.partial) {
                            // update gui message
                            const partialMessage = JSON.stringify(sharedMessageProps)
                            if (shouldAutoApproveTool(block.name)) {
                                removeLastPartialMessageIfExistsWithType("ask", "tool") // in case the user changes auto-approval settings mid stream
                                await say("tool", partialMessage, undefined, block.partial)
                            } else {
                                removeLastPartialMessageIfExistsWithType("say", "tool")
                                await ask("tool", partialMessage, block.partial).catch(() => {})
                            }
                            break
                        } else {
                            if (!relPath) {
                                globalStateManager.updateState({
                                    consecutiveMistakeCount: globalStateManager.getState().consecutiveMistakeCount + 1,
                                })
                                pushToolResult(await sayAndCreateMissingParamError(block.name, "path"))
                                await saveCheckpoint()
                                break
                            }
                            if (block.name === "replace_in_file" && !diff) {
                                globalStateManager.updateState({
                                    consecutiveMistakeCount: globalStateManager.getState().consecutiveMistakeCount + 1,
                                })
                                pushToolResult(await sayAndCreateMissingParamError("replace_in_file", "diff"))
                                await saveCheckpoint()
                                break
                            }
                            if (block.name === "write_to_file" && !content) {
                                globalStateManager.updateState({
                                    consecutiveMistakeCount: globalStateManager.getState().consecutiveMistakeCount + 1,
                                })
                                pushToolResult(await sayAndCreateMissingParamError("write_to_file", "content"))
                                await saveCheckpoint()
                                break
                            }
                            globalStateManager.updateState({
                                consecutiveMistakeCount: 0,
                            })

                            // if isEditingFile false, that means we have the full contents of the file already.
                            // it's important to note how this function works, you can't make the assumption that the block.partial conditional will always be called since it may immediately get complete, non-partial data. So this part of the logic will always be called.
                            // in other words, you must always repeat the block.partial logic here
                            const completeMessage = JSON.stringify({
                                ...sharedMessageProps,
                                content: diff || content,
                            } satisfies ClineSayTool)

                            if (shouldAutoApproveTool(block.name)) {
                                removeLastPartialMessageIfExistsWithType("ask", "tool")
                                await say("tool", completeMessage, undefined, false)
                                globalStateManager.updateState({
                                    consecutiveAutoApprovedRequestsCount: globalStateManager.getState().consecutiveAutoApprovedRequestsCount + 1,
                                })

                                // we need an artificial delay to let the diagnostics catch up to the changes
                                await delay(3_500)
                            } else {
                                // If auto-approval is enabled but this tool wasn't auto-approved, send notification
                                showNotificationForApprovalIfAutoApprovalEnabled(
                                    `Cline wants to ${fileExists ? "edit" : "create"} ${path.basename(relPath)}`,
                                )
                                removeLastPartialMessageIfExistsWithType("say", "tool")
                                // Need a more customized tool response for file edits to highlight the fact that the file was not updated (particularly important for deepseek)
                                let didApprove = true
                                const { response, text, images } = await ask("tool", completeMessage, false)
                                if (response !== "yesButtonClicked") {
                                    // TODO: add similar context for other tool denial responses, to emphasize ie that a command was not run
                                    const fileDeniedNote = fileExists
                                        ? "The file was not updated, and maintains its original contents."
                                        : "The file was not created."
                                    if (response === "messageResponse") {
                                        await say("user_feedback", text, images)
                                        pushToolResult(
                                            formatResponse.toolResult(
                                                `The user denied this operation. ${fileDeniedNote}\nThe user provided the following feedback:\n<feedback>\n${text}\n</feedback>`,
                                                images,
                                            ),
                                        )
                                        globalStateManager.updateState({
                                            didRejectTool: true,
                                        })
                                        didApprove = false
                                    } else {
                                        pushToolResult(`The user denied this operation. ${fileDeniedNote}`)
                                        globalStateManager.updateState({
                                            didRejectTool: true,
                                        })
                                        didApprove = false
                                    }
                                }

                                if (!didApprove) {
                                    await saveCheckpoint()
                                    break
                                }
                            }
                        }
                    } catch (error) {
                        await handleError("writing file", error)
                        break
                    }
                    break
                }
                case "read_file": {
                    const relPath: string | undefined = block.params.path
                    const sharedMessageProps: ClineSayTool = {
                        tool: "readFile",
                        path: getReadablePath(cwd(), removeClosingTag("path", relPath)),
                    }
                    try {
                        if (block.partial) {
                            const partialMessage = JSON.stringify({
                                ...sharedMessageProps,
                                content: undefined,
                            } satisfies ClineSayTool)
                            if (shouldAutoApproveTool(block.name)) {
                                removeLastPartialMessageIfExistsWithType("ask", "tool")
                                await say("tool", partialMessage, undefined, block.partial)
                            } else {
                                removeLastPartialMessageIfExistsWithType("say", "tool")
                                await ask("tool", partialMessage, block.partial).catch(() => {})
                            }
                            break
                        } else {
                            if (!relPath) {
                                globalStateManager.updateState({
                                    consecutiveMistakeCount: globalStateManager.getState().consecutiveMistakeCount + 1,
                                })
                                pushToolResult(await sayAndCreateMissingParamError("read_file", "path"))
                                await saveCheckpoint()
                                break
                            }
                            globalStateManager.updateState({
                                consecutiveMistakeCount: 0,
                            })
                            const absolutePath = path.resolve(cwd(), relPath)
                            const completeMessage = JSON.stringify({
                                ...sharedMessageProps,
                                content: absolutePath,
                            } satisfies ClineSayTool)
                            if (shouldAutoApproveTool(block.name)) {
                                removeLastPartialMessageIfExistsWithType("ask", "tool")
                                await say("tool", completeMessage, undefined, false) // need to be sending partialValue bool, since undefined has its own purpose in that the message is treated neither as a partial or completion of a partial, but as a single complete message
                                globalStateManager.updateState({
                                    consecutiveAutoApprovedRequestsCount: globalStateManager.getState().consecutiveAutoApprovedRequestsCount + 1,
                                })
                            } else {
                                showNotificationForApprovalIfAutoApprovalEnabled(
                                    `Cline wants to read ${path.basename(absolutePath)}`,
                                )
                                removeLastPartialMessageIfExistsWithType("say", "tool")
                                const didApprove = await askApproval("tool", completeMessage)
                                if (!didApprove) {
                                    await saveCheckpoint()
                                    break
                                }
                            }
                            // now execute the tool like normal
                            const content = await extractTextFromFile(absolutePath)
                            pushToolResult(content)
                            await saveCheckpoint()
                            break
                        }
                    } catch (error) {
                        await handleError("reading file", error)
                        await saveCheckpoint()
                        break
                    }
                }
                case "list_files": {
                    const relDirPath: string | undefined = block.params.path
                    const recursiveRaw: string | undefined = block.params.recursive
                    const recursive = recursiveRaw?.toLowerCase() === "true"
                    const sharedMessageProps: ClineSayTool = {
                        tool: !recursive ? "listFilesTopLevel" : "listFilesRecursive",
                        path: getReadablePath(cwd(), removeClosingTag("path", relDirPath)),
                    }
                    try {
                        if (block.partial) {
                            const partialMessage = JSON.stringify({
                                ...sharedMessageProps,
                                content: "",
                            } satisfies ClineSayTool)
                            if (shouldAutoApproveTool(block.name)) {
                                removeLastPartialMessageIfExistsWithType("ask", "tool")
                                await say("tool", partialMessage, undefined, block.partial)
                            } else {
                                removeLastPartialMessageIfExistsWithType("say", "tool")
                                await ask("tool", partialMessage, block.partial).catch(() => {})
                            }
                            break
                        } else {
                            if (!relDirPath) {
                                globalStateManager.updateState({
                                    consecutiveMistakeCount: globalStateManager.getState().consecutiveMistakeCount + 1,
                                })
                                pushToolResult(await sayAndCreateMissingParamError("list_files", "path"))
                                await saveCheckpoint()
                                break
                            }
                            globalStateManager.updateState({
                                consecutiveMistakeCount: 0,
                            })
                            const absolutePath = path.resolve(cwd(), relDirPath)
                            const [files, didHitLimit] = await listFiles(absolutePath, recursive, 200)
                            const result = formatResponse.formatFilesList(absolutePath, files, didHitLimit)
                            const completeMessage = JSON.stringify({
                                ...sharedMessageProps,
                                content: result,
                            } satisfies ClineSayTool)
                            if (shouldAutoApproveTool(block.name)) {
                                removeLastPartialMessageIfExistsWithType("ask", "tool")
                                await say("tool", completeMessage, undefined, false)
                                globalStateManager.updateState({
                                    consecutiveAutoApprovedRequestsCount: globalStateManager.getState().consecutiveAutoApprovedRequestsCount + 1,
                                })
                            } else {
                                showNotificationForApprovalIfAutoApprovalEnabled(
                                    `Cline wants to view directory ${path.basename(absolutePath)}/`,
                                )
                                removeLastPartialMessageIfExistsWithType("say", "tool")
                                const didApprove = await askApproval("tool", completeMessage)
                                if (!didApprove) {
                                    await saveCheckpoint()
                                    break
                                }
                            }
                            pushToolResult(result)
                            await saveCheckpoint()
                            break
                        }
                    } catch (error) {
                        await handleError("listing files", error)
                        await saveCheckpoint()
                        break
                    }
                }
                case "list_code_definition_names": {
                    const relDirPath: string | undefined = block.params.path
                    const sharedMessageProps: ClineSayTool = {
                        tool: "listCodeDefinitionNames",
                        path: getReadablePath(cwd(), removeClosingTag("path", relDirPath)),
                    }
                    try {
                        if (block.partial) {
                            const partialMessage = JSON.stringify({
                                ...sharedMessageProps,
                                content: "",
                            } satisfies ClineSayTool)
                            if (shouldAutoApproveTool(block.name)) {
                                removeLastPartialMessageIfExistsWithType("ask", "tool")
                                await say("tool", partialMessage, undefined, block.partial)
                            } else {
                                removeLastPartialMessageIfExistsWithType("say", "tool")
                                await ask("tool", partialMessage, block.partial).catch(() => {})
                            }
                            break
                        } else {
                            if (!relDirPath) {
                                globalStateManager.updateState({
                                    consecutiveMistakeCount: globalStateManager.getState().consecutiveMistakeCount + 1,
                                })
                                pushToolResult(await sayAndCreateMissingParamError("list_code_definition_names", "path"))
                                await saveCheckpoint()
                                break
                            }
                            globalStateManager.updateState({
                                consecutiveMistakeCount: 0,
                            })
                            const absolutePath = path.resolve(cwd(), relDirPath)
                            const result = await parseSourceCodeForDefinitionsTopLevel(absolutePath)
                            const completeMessage = JSON.stringify({
                                ...sharedMessageProps,
                                content: result,
                            } satisfies ClineSayTool)
                            if (shouldAutoApproveTool(block.name)) {
                                removeLastPartialMessageIfExistsWithType("ask", "tool")
                                await say("tool", completeMessage, undefined, false)
                                globalStateManager.updateState({
                                    consecutiveAutoApprovedRequestsCount: globalStateManager.getState().consecutiveAutoApprovedRequestsCount + 1,
                                })
                            } else {
                                showNotificationForApprovalIfAutoApprovalEnabled(
                                    `Cline wants to view source code definitions in ${path.basename(absolutePath)}/`,
                                )
                                removeLastPartialMessageIfExistsWithType("say", "tool")
                                const didApprove = await askApproval("tool", completeMessage)
                                if (!didApprove) {
                                    await saveCheckpoint()
                                    break
                                }
                            }
                            pushToolResult(result)
                            await saveCheckpoint()
                            break
                        }
                    } catch (error) {
                        await handleError("parsing source code definitions", error)
                        await saveCheckpoint()
                        break
                    }
                }
                case "search_files": {
                    const relDirPath: string | undefined = block.params.path
                    const regex: string | undefined = block.params.regex
                    const filePattern: string | undefined = block.params.file_pattern
                    const sharedMessageProps: ClineSayTool = {
                        tool: "searchFiles",
                        path: getReadablePath(cwd(), removeClosingTag("path", relDirPath)),
                        regex: removeClosingTag("regex", regex),
                        filePattern: removeClosingTag("file_pattern", filePattern),
                    }
                    try {
                        if (block.partial) {
                            const partialMessage = JSON.stringify({
                                ...sharedMessageProps,
                                content: "",
                            } satisfies ClineSayTool)
                            if (shouldAutoApproveTool(block.name)) {
                                removeLastPartialMessageIfExistsWithType("ask", "tool")
                                await say("tool", partialMessage, undefined, block.partial)
                            } else {
                                removeLastPartialMessageIfExistsWithType("say", "tool")
                                await ask("tool", partialMessage, block.partial).catch(() => {})
                            }
                            break
                        } else {
                            if (!relDirPath) {
                                globalStateManager.updateState({
                                    consecutiveMistakeCount: globalStateManager.getState().consecutiveMistakeCount + 1,
                                })
                                pushToolResult(await sayAndCreateMissingParamError("search_files", "path"))
                                await saveCheckpoint()
                                break
                            }
                            if (!regex) {
                                globalStateManager.updateState({
                                    consecutiveMistakeCount: globalStateManager.getState().consecutiveMistakeCount + 1,
                                })
                                pushToolResult(await sayAndCreateMissingParamError("search_files", "regex"))
                                await saveCheckpoint()
                                break
                            }
                            globalStateManager.updateState({
                                consecutiveMistakeCount: 0,
                            })
                            const absolutePath = path.resolve(cwd(), relDirPath)
                            const results = await regexSearchFiles(cwd(), absolutePath, regex, filePattern)
                            const completeMessage = JSON.stringify({
                                ...sharedMessageProps,
                                content: results,
                            } satisfies ClineSayTool)
                            if (shouldAutoApproveTool(block.name)) {
                                removeLastPartialMessageIfExistsWithType("ask", "tool")
                                await say("tool", completeMessage, undefined, false)
                                globalStateManager.updateState({
                                    consecutiveAutoApprovedRequestsCount: globalStateManager.getState().consecutiveAutoApprovedRequestsCount + 1,
                                })
                            } else {
                                showNotificationForApprovalIfAutoApprovalEnabled(
                                    `Cline wants to search files in ${path.basename(absolutePath)}/`,
                                )
                                removeLastPartialMessageIfExistsWithType("say", "tool")
                                const didApprove = await askApproval("tool", completeMessage)
                                if (!didApprove) {
                                    await saveCheckpoint()
                                    break
                                }
                            }
                            pushToolResult(results)
                            await saveCheckpoint()
                            break
                        }
                    } catch (error) {
                        await handleError("searching files", error)
                        await saveCheckpoint()
                        break
                    }
                }
                case "execute_command": {
                    const command: string | undefined = block.params.command
                    const requiresApprovalRaw: string | undefined = block.params.requires_approval
                    const requiresApproval = requiresApprovalRaw?.toLowerCase() === "true"

                    try {
                        if (block.partial) {
                            if (shouldAutoApproveTool(block.name)) {
                            } else {
                                // don't need to remove last partial since we couldn't have streamed a say
                                await ask("command", removeClosingTag("command", command), block.partial).catch(() => {})
                            }
                            break
                        } else {
                            if (!command) {
                                globalStateManager.updateState({
                                    consecutiveMistakeCount: globalStateManager.getState().consecutiveMistakeCount + 1,
                                })
                                pushToolResult(await sayAndCreateMissingParamError("execute_command", "command"))
                                await saveCheckpoint()
                                break
                            }
                            if (!requiresApprovalRaw) {
                                globalStateManager.updateState({
                                    consecutiveMistakeCount: globalStateManager.getState().consecutiveMistakeCount + 1,
                                })
                                pushToolResult(
                                    await sayAndCreateMissingParamError("execute_command", "requires_approval"),
                                )
                                await saveCheckpoint()
                                break
                            }
                            globalStateManager.updateState({
                                consecutiveMistakeCount: 0,
                            })

                            let didAutoApprove = false

                            if (!requiresApproval && shouldAutoApproveTool(block.name)) {
                                removeLastPartialMessageIfExistsWithType("ask", "command")
                                await say("command", command, undefined, false)
                                globalStateManager.updateState({
                                    consecutiveAutoApprovedRequestsCount: globalStateManager.getState().consecutiveAutoApprovedRequestsCount + 1,
                                })
                                didAutoApprove = true
                            } else {
                                showNotificationForApprovalIfAutoApprovalEnabled(
                                    `Cline wants to execute a command: ${command}`,
                                )
                                const didApprove = await askApproval(
                                    "command",
                                    command +
                                        `${shouldAutoApproveTool(block.name) && requiresApproval ? "" : ""}`, // ugly hack until we refactor combineCommandSequences
                                )
                                if (!didApprove) {
                                    await saveCheckpoint()
                                    break
                                }
                            }

                            let timeoutId: NodeJS.Timeout | undefined
                            if (didAutoApprove && globalStateManager.getState().autoApprovalSettings.enableNotifications) {
                                // if the command was auto-approved, and it's long running we need to notify the user after some time has passed without proceeding
                                timeoutId = setTimeout(() => {
                                    showSystemNotification({
                                        subtitle: "Command is still running",
                                        message:
                                            "An auto-approved command has been running for 30s, and may need your attention.",
                                    })
                                }, 30_000)
                            }

                            const [userRejected, result] = await executeCommandTool(command)
                            if (timeoutId) {
                                clearTimeout(timeoutId)
                            }
                            if (userRejected) {
                                globalStateManager.updateState({
                                    didRejectTool: true,
                                })
                            }
                            pushToolResult(result)
                            await saveCheckpoint()
                            break
                        }
                    } catch (error) {
                        await handleError("executing command", error)
                        await saveCheckpoint()
                        break
                    }
                }
                case "ask_followup_question": {
                    const question: string | undefined = block.params.question
                    try {
                        if (block.partial) {
                            await ask("followup", removeClosingTag("question", question), block.partial).catch(() => {})
                            break
                        } else {
                            if (!question) {
                                globalStateManager.updateState({
                                    consecutiveMistakeCount: globalStateManager.getState().consecutiveMistakeCount + 1,
                                })
                                pushToolResult(await sayAndCreateMissingParamError("ask_followup_question", "question"))
                                await saveCheckpoint()
                                break
                            }
                            globalStateManager.updateState({
                                consecutiveMistakeCount: 0,
                            })

                            if (globalStateManager.getState().autoApprovalSettings.enabled && globalStateManager.getState().autoApprovalSettings.enableNotifications) {
                                showSystemNotification({
                                    subtitle: "Cline has a question...",
                                    message: question.replace(/\n/g, " "),
                                })
                            }

                            const { text, images } = await ask("followup", question, false)
                            await say("user_feedback", text ?? "", images)
                            pushToolResult(formatResponse.toolResult(`<answer>\n${text}\n</answer>`, images))
                            await saveCheckpoint()
                            break
                        }
                    } catch (error) {
                        await handleError("asking question", error)
                        await saveCheckpoint()
                        break
                    }
                }
                case "plan_mode_response": {
                    const response: string | undefined = block.params.response
                    try {
                        if (block.partial) {
                            await ask("plan_mode_response", removeClosingTag("response", response), block.partial).catch(
                                () => {},
                            )
                            break
                        } else {
                            if (!response) {
                                globalStateManager.updateState({
                                    consecutiveMistakeCount: globalStateManager.getState().consecutiveMistakeCount + 1,
                                })
                                pushToolResult(await sayAndCreateMissingParamError("plan_mode_response", "response"))
                                // await saveCheckpoint()
                                break
                            }
                            globalStateManager.updateState({
                                consecutiveMistakeCount: 0,
                                isAwaitingPlanResponse: true,
                            })
                            const { text, images } = await ask("plan_mode_response", response, false)
                            globalStateManager.updateState({
                                isAwaitingPlanResponse: false,
                            })

                            if (globalStateManager.getState().didRespondToPlanAskBySwitchingMode) {
                                pushToolResult(
                                    formatResponse.toolResult(
                                        `[The user has switched to ACT MODE, so you may now proceed with the task.]`,
                                        images,
                                    ),
                                )
                            } else {
                                await say("user_feedback", text ?? "", images)
                                pushToolResult(formatResponse.toolResult(`<user_message>\n${text}\n</user_message>`, images))
                            }
                            break
                        }
                    } catch (error) {
                        await handleError("responding to inquiry", error)
                        break
                    }
                }
                case "attempt_completion": {
                    const result: string | undefined = block.params.result
                    const command: string | undefined = block.params.command

                    const addNewChangesFlagToLastCompletionResultMessage = async () => {
                        // Add newchanges flag if there are new changes to the workspace

                        const hasNewChanges = await doesLatestTaskCompletionHaveNewChanges()
                        const lastCompletionResultMessage = findLast(globalStateManager.getState().clineMessages, (m) => m.say === "completion_result")
                        if (
                            lastCompletionResultMessage &&
                            hasNewChanges &&
                            !lastCompletionResultMessage.text?.endsWith(COMPLETION_RESULT_CHANGES_FLAG)
                        ) {
                            lastCompletionResultMessage.text += COMPLETION_RESULT_CHANGES_FLAG
                        }
                        await saveClineMessages()
                    }

                    try {
                        const lastMessage = globalStateManager.getState().clineMessages.at(-1)
                        if (block.partial) {
                            if (command) {
                                // the attempt_completion text is done, now we're getting command
                                // remove the previous partial attempt_completion ask, replace with say, post state to webview, then stream command
                                if (lastMessage && lastMessage.ask === "command") {
                                    // update command
                                    await ask("command", removeClosingTag("command", command), block.partial).catch(
                                        () => {},
                                    )
                                } else {
                                    // last message is completion_result
                                    // we have command string, which means we have the result as well, so finish it (doesnt have to exist yet)
                                    await say("completion_result", removeClosingTag("result", result), undefined, false)
                                    await saveCheckpoint()
                                    await addNewChangesFlagToLastCompletionResultMessage()
                                    await ask("command", removeClosingTag("command", command), block.partial).catch(
                                        () => {},
                                    )
                                }
                            } else {
                                // no command, still outputting partial result
                                await say(
                                    "completion_result",
                                    removeClosingTag("result", result),
                                    undefined,
                                    block.partial,
                                )
                            }
                            break
                        } else {
                            if (!result) {
                                globalStateManager.updateState({
                                    consecutiveMistakeCount: globalStateManager.getState().consecutiveMistakeCount + 1,
                                })
                                pushToolResult(await sayAndCreateMissingParamError("attempt_completion", "result"))
                                await saveCheckpoint()
                                break
                            }
                            globalStateManager.updateState({
                                consecutiveMistakeCount: 0,
                            })

                            if (globalStateManager.getState().autoApprovalSettings.enabled && globalStateManager.getState().autoApprovalSettings.enableNotifications) {
                                showSystemNotification({
                                    subtitle: "Task Completed",
                                    message: result.replace(/\n/g, " "),
                                })
                            }

                            let commandResult: ToolResponse | undefined
                            if (command) {
                                if (lastMessage && lastMessage.ask !== "command") {
                                    // havent sent a command message yet so first send completion_result then command
                                    await say("completion_result", result, undefined, false)
                                    await saveCheckpoint()
                                    await addNewChangesFlagToLastCompletionResultMessage()
                                } else {
                                    // we already sent a command message, meaning the complete completion message has also been sent
                                    await saveCheckpoint()
                                }

                                // complete command message
                                const didApprove = await askApproval("command", command)
                                if (!didApprove) {
                                    await saveCheckpoint()
                                    break
                                }
                                const [userRejected, execCommandResult] = await executeCommandTool(command!)
                                if (userRejected) {
                                    globalStateManager.updateState({
                                        didRejectTool: true,
                                    })
                                    pushToolResult(execCommandResult)
                                    await saveCheckpoint()
                                    break
                                }
                                // user didn't reject, but the command may have output
                                commandResult = execCommandResult
                            } else {
                                await say("completion_result", result, undefined, false)
                                await saveCheckpoint()
                                await addNewChangesFlagToLastCompletionResultMessage()
                            }

                            // we already sent completion_result says, an empty string asks relinquishes control over button and field
                            const { response, text, images } = await ask("completion_result", "", false)
                            if (response === "yesButtonClicked") {
                                pushToolResult("") // signals to recursive loop to stop (for now this never happens since yesButtonClicked will trigger a new task)
                                break
                            }
                            await say("user_feedback", text ?? "", images)

                            const toolResults: (Anthropic.TextBlockParam | Anthropic.ImageBlockParam)[] = []
                            if (commandResult) {
                                if (typeof commandResult === "string") {
                                    toolResults.push({
                                        type: "text",
                                        text: commandResult,
                                    })
                                } else if (Array.isArray(commandResult)) {
                                    toolResults.push(...commandResult)
                                }
                            }
                            toolResults.push({
                                type: "text",
                                text: `The user has provided feedback on the results. Consider their input to continue the task, and then attempt completion again.\n<feedback>\n${text}\n</feedback>`,
                            })
                            toolResults.push(...formatResponse.imageBlocks(images))
                            const message = globalStateManager.getState().userMessageContent
                            globalStateManager.updateState({
                                userMessageContent: [
                                    ...message,
                                    {
                                        type: "text",
                                        text: `${toolDescription()} Result:`,
                                    },
                                    ...toolResults
                                ],
                            })
                            break
                        }
                    } catch (error) {
                        await handleError("attempting completion", error)
                        await saveCheckpoint()
                        break
                    }
                }
            }
            break
    }

    /*
    Seeing out of bounds is fine, it means that the next too call is being built up and ready to add to assistantMessageContent to present.
    When you see the UI inactive during this, it means that a tool is breaking without presenting any UI. For example the write_to_file tool was breaking when relpath was undefined, and for invalid relpath it never presented UI.
    */
    globalStateManager.getState().presentAssistantMessageLocked = false // this needs to be placed here, if not then calling this.presentAssistantMessage below would fail (sometimes) since it's locked
    // NOTE: when tool is rejected, iterator stream is interrupted and it waits for userMessageContentReady to be true. Future calls to present will skip execution since didRejectTool and iterate until contentIndex is set to message length and it sets userMessageContentReady to true itself (instead of preemptively doing it in iterator)
    if (!block.partial || globalStateManager.getState().didRejectTool || globalStateManager.getState().didAlreadyUseTool) {
        // block is finished streaming and executing
        if (globalStateManager.getState().currentStreamingContentIndex === globalStateManager.getState().assistantMessageContent.length - 1) {
            // its okay that we increment if !didCompleteReadingStream, it'll just return bc out of bounds and as streaming continues it will call presentAssitantMessage if a new block is ready. if streaming is finished then we set userMessageContentReady to true when out of bounds. This gracefully allows the stream to continue on and all potential content blocks be presented.
            // last block is complete and it is finished executing
            globalStateManager.updateState({ // will allow pwaitfor to continue
                userMessageContentReady: true,
            })
        }

        // call next block if it exists (if not then read stream will call it when its ready)
        globalStateManager.updateState({
            currentStreamingContentIndex: globalStateManager.getState().currentStreamingContentIndex + 1,
        }) // need to increment regardless, so when read stream calls this function again it will be streaming the next block

        if (globalStateManager.getState().currentStreamingContentIndex < globalStateManager.getState().assistantMessageContent.length) {
            presentAssistantMessage()
            return
        }
    }
    // block is partial, but the read stream may have finished
    if (globalStateManager.getState().presentAssistantMessageHasPendingUpdates) {
        presentAssistantMessage()
    }
    console.log("presentAssistantMessage finished"); // Log: Function execution finish
}
