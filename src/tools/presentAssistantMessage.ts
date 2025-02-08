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
 * アシスタントのメッセージをユーザーに提示し、各種コンテンツブロックやツールとの対話を処理します。
 * Present assistant messages and handle tool interactions.
 */
export const presentAssistantMessage = async () => {
    const state = globalStateManager.state

    console.log("1:[プレゼント] 開始"); // ログ: 関数実行開始
    const apiState = apiStateManager.getState()
    const apiHandler = buildApiHandler(apiState)

    // タスク中止が指定されている場合はエラーを投げる
    if (state.abort) {
        console.log("中断フラグが立っているため、処理を停止します。")
        throw new Error("Cline instance aborted")
    }

    // メッセージ提示処理がロックされている場合は、更新をフラグに記録して終了
    if (state.presentAssistantMessageLocked) {
        console.log("2:[プレゼント] presentAssistantMessageLockedがtrueのため、更新を保留します。")
        state.presentAssistantMessageHasPendingUpdates = true
        return
    }
    state.presentAssistantMessageLocked = true
    state.presentAssistantMessageHasPendingUpdates = false

    // 現在のストリーミングインデックスが範囲外の場合
    if (state.currentStreamingContentIndex >= state.assistantMessageContent.length) {
        // ストリーミングが完了している場合、ユーザーメッセージの準備ができたことを示す
        if (state.didCompleteReadingStream) {
            state.userMessageContentReady = true
            console.log("3:[プレゼント]ストリーミング完了: ユーザーメッセージの準備完了")
        }
        state.presentAssistantMessageLocked = false
        return
    }

    // ストリーミング中に配列が更新される可能性があるため、ディープコピーを作成
    const block = cloneDeep(state.assistantMessageContent[state.currentStreamingContentIndex])
    console.log(`4:[プレゼント]処理中のブロックタイプ: ${block.type}`)

    switch (block.type) {
        case "text": {
            if (state.didRejectTool || state.didAlreadyUseTool) {
                console.log("ツールが拒否されたか既に使用済みのため、テキストブロックの処理をスキップ")
                break
            }
            let content = block.content
            if (content) {
                // thinking タグを削除
                content = content.replace(/<thinking>\s?/g, "")
                content = content.replace(/\s?<\/thinking>/g, "")

                // ファイルの最後にある部分的なXMLタグを削除
                const lastOpenBracketIndex = content.lastIndexOf("<")
                if (lastOpenBracketIndex !== -1) {
                    const possibleTag = content.slice(lastOpenBracketIndex)
                    const hasCloseBracket = possibleTag.includes(">")
                    if (!hasCloseBracket) {
                        let tagContent: string
                        if (possibleTag.startsWith("</")) {
                            tagContent = possibleTag.slice(2).trim()
                        } else {
                            tagContent = possibleTag.slice(1).trim()
                        }
                        const isLikelyTagName = /^[a-zA-Z_]+$/.test(tagContent)
                        const isOpeningOrClosing = possibleTag === "<" || possibleTag === "</"
                        if (isOpeningOrClosing || isLikelyTagName) {
                            console.log("不完全なタグを検出したため削除します。")
                            content = content.slice(0, lastOpenBracketIndex).trim()
                        }
                    }
                }
            }

            // 部分的なブロックでない場合、コードブロックのアーティファクトを削除
            if (!block.partial) {
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
            // ツールごとの説明を生成する関数
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
            const userMessageContent = state.userMessageContent
            if (state.didRejectTool) {
                // ユーザーがツールを拒否した場合、ツール実行をスキップ
                if (!block.partial) {
                    userMessageContent.push({
                        type: "text",
                        text: `前回のツール拒否のため、${toolDescription()} をスキップします。`,
                    })
                } else {
                    userMessageContent.push({
                        type: "text",
                        text: `前回のツール拒否のため、部分的な${toolDescription()}は中断されました。`,
                    })
                }
                break
            }

            if (state.didAlreadyUseTool) {
                // 既にツールが使用されている場合、以降のツール呼び出しは無視
                userMessageContent.push({
                    type: "text",
                    text: `メッセージ内で既にツール [${block.name}] が使用されているため、実行しません。`,
                })
                break
            }

            const pushToolResult = (content: ToolResponse) => {
                userMessageContent.push({
                    type: "text",
                    text: `${toolDescription()} の結果:`,
                })
                if (typeof content === "string") {
                    userMessageContent.push({
                        type: "text",
                        text: content || "(ツールは何も返しませんでした)",
                    })
                } else {
                    userMessageContent.push(...content)
                }
                // ツール結果が取得されたため、以降のツール呼び出しは無視
                state.didAlreadyUseTool = true
            }

            // ツール使用前にユーザーに承認を求める関数
            const askApproval = async (type: ClineAsk, partialMessage?: string) => {
                const { response, text, images } = await ask(type, partialMessage, false)
                if (response !== "yesButtonClicked") {
                    if (response === "messageResponse") {
                        await say("user_feedback", text, images)
                        pushToolResult(formatResponse.toolResult(formatResponse.toolDeniedWithFeedback(text), images))
                        state.didRejectTool = true
                        return false
                    }
                    pushToolResult(formatResponse.toolDenied())
                    state.didRejectTool = true
                    return false
                }
                return true
            }

            // エラー発生時の処理
            const handleError = async (action: string, error: Error) => {
                if (state.abandoned) {
                    console.log("タスクが中止されたため、エラーを無視します。")
                    return
                }
                const errorString = `Error ${action}: ${JSON.stringify(serializeError(error))}`
                await say(
                    "error",
                    `Error ${action}:\n${error.message ?? JSON.stringify(serializeError(error), null, 2)}`,
                )
                pushToolResult(formatResponse.toolError(errorString))
            }

            // 部分的なブロックの場合、閉じタグを削除
            const removeClosingTag = (tag: ToolParamName, text?: string) => {
                if (!block.partial) {
                    return text || ""
                }
                if (!text) {
                    return ""
                }
                const tagRegex = new RegExp(
                    `\\s?<\/?${tag
                        .split("")
                        .map((char) => `(?:${char})?`)
                        .join("")}$`,
                    "g",
                )
                return text.replace(tagRegex, "")
            }

            // 各ツール名ごとの処理分岐
            switch (block.name) {
                case "write_to_file":
                case "replace_in_file": {
                    const relPath: string | undefined = block.params.path
                    let content: string | undefined = block.params.content // write_to_file用
                    let diff: string | undefined = block.params.diff // replace_in_file用
                    if (!relPath || (!content && !diff)) {
                        console.log("必要なパラメータが不足しているため、ツール処理を中断します。")
                        break
                    }
                    let fileExists: boolean = false

                    try {
                        let newContent: string = ""
                        if (diff) {
                            
                        } else if (content) {
                            newContent = content

                            // マークダウンコードブロックのアーティファクトを除去
                            if (newContent.startsWith("```")) {
                                newContent = newContent.split("\n").slice(1).join("\n").trim()
                            }
                            if (newContent.endsWith("```")) {
                                newContent = newContent.split("\n").slice(0, -1).join("\n").trim()
                            }

                        } else {
                            break
                        }

                        newContent = newContent.trimEnd()

                        const sharedMessageProps: ClineSayTool = {
                            tool: fileExists ? "editedExistingFile" : "newFileCreated",
                            path: getReadablePath(cwd(), removeClosingTag("path", relPath)),
                            content: diff || content,
                        }

                        if (block.partial) {
                            const partialMessage = JSON.stringify(sharedMessageProps)
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
                                state.consecutiveMistakeCount++
                                pushToolResult(await sayAndCreateMissingParamError(block.name, "path"))
                                await saveCheckpoint()
                                break
                            }
                            if (block.name === "replace_in_file" && !diff) {
                                state.consecutiveMistakeCount++
                                pushToolResult(await sayAndCreateMissingParamError("replace_in_file", "diff"))
                                await saveCheckpoint()
                                break
                            }
                            if (block.name === "write_to_file" && !content) {
                                state.consecutiveMistakeCount++
                                pushToolResult(await sayAndCreateMissingParamError("write_to_file", "content"))
                                await saveCheckpoint()
                                break
                            }
                            state.consecutiveMistakeCount = 0

                            const completeMessage = JSON.stringify({
                                ...sharedMessageProps,
                                content: diff || content,
                            } satisfies ClineSayTool)

                            if (shouldAutoApproveTool(block.name)) {
                                removeLastPartialMessageIfExistsWithType("ask", "tool")
                                await say("tool", completeMessage, undefined, false)
                            } else {
                                console.log(
                                    `Clineが ${fileExists ? "既存ファイルの編集" : "新規ファイルの作成"} を要求しています: ${path.basename(relPath)}`,
                                )
                                removeLastPartialMessageIfExistsWithType("say", "tool")
                            }
                        }
                    } catch (error) {
                        await handleError("ファイル書き込み", error)
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
                                await ask("tool", partialMessage,  block.partial)
                            }
                            break
                        } else {
                            if (!relPath) {
                                state.consecutiveMistakeCount++
                                pushToolResult(await sayAndCreateMissingParamError("read_file", "path"))
                                break
                            }
                            state.consecutiveMistakeCount = 0
                            const absolutePath = path.resolve(cwd(), relPath)
                            const completeMessage = JSON.stringify({
                                ...sharedMessageProps,
                                content: absolutePath,
                            } satisfies ClineSayTool)
                            if (shouldAutoApproveTool(block.name)) {
                                removeLastPartialMessageIfExistsWithType("ask", "tool")
                                await say("tool", completeMessage, undefined, false)
                            } else {
                                removeLastPartialMessageIfExistsWithType("say", "tool")
                            }
                            // now execute the tool like normal
                            const content = await extractTextFromFile(absolutePath)
                            pushToolResult(content)
                            break
                        }
                    } catch (error) {
                        await handleError("ファイル書き込み", error)
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
                                await ask("tool", partialMessage, undefined)
                            }
                            break
                        }else {
                            if (!relDirPath) {
                                state.consecutiveMistakeCount++
                                pushToolResult(await sayAndCreateMissingParamError("list_files", "path"))
                                await saveCheckpoint()
                                break
                            }
                            state.consecutiveMistakeCount = 0
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
                            } else {
                                removeLastPartialMessageIfExistsWithType("say", "tool")
                            }
                            pushToolResult(result)
                            break
                        }
                    } catch (error) {
                        await handleError("ファイル書き込み", error)
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
                                await ask("tool", partialMessage, block.partial)
                            }
                            break
                         } else {
                            if (!relDirPath) {
                                state.consecutiveMistakeCount++
                                pushToolResult(await sayAndCreateMissingParamError("list_code_definition_names", "path"))
                                break
                            }
                            state.consecutiveMistakeCount = 0
                            const absolutePath = path.resolve(cwd(), relDirPath)
                            const result = await parseSourceCodeForDefinitionsTopLevel(absolutePath)
                            const completeMessage = JSON.stringify({
                                ...sharedMessageProps,
                                content: result,
                            } satisfies ClineSayTool)
                            if (shouldAutoApproveTool(block.name)) {
                                removeLastPartialMessageIfExistsWithType("ask", "tool")
                                await say("tool", completeMessage, undefined, false)
                                removeLastPartialMessageIfExistsWithType("say", "tool")
                            }
                            pushToolResult(result)
                            break
                        }
                    } catch (error) {
                        await handleError("ファイル書き込み", error)
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
                                await ask("tool", partialMessage, block.partial)
                            }
                            break
                        } else {
                            if (!relDirPath) {
                                state.consecutiveMistakeCount++
                                pushToolResult(await sayAndCreateMissingParamError("search_files", "path"))
                                break
                            }
                            if (!regex) {
                                state.consecutiveMistakeCount++
                                pushToolResult(await sayAndCreateMissingParamError("search_files", "regex"))
                                await saveCheckpoint()
                                break
                            }
                            state.consecutiveMistakeCount = 0
                            const absolutePath = path.resolve(cwd(), relDirPath)
                            const results = await regexSearchFiles(cwd(), absolutePath, regex, filePattern)
                            const completeMessage = JSON.stringify({
                                ...sharedMessageProps,
                                content: results,
                            } satisfies ClineSayTool)
                            if (shouldAutoApproveTool(block.name)) {
                                removeLastPartialMessageIfExistsWithType("ask", "tool")
                                await say("tool", completeMessage, undefined, false)
                                removeLastPartialMessageIfExistsWithType("say", "tool")
                            }
                            pushToolResult(results)
                            break
                        }
                    } catch (error) {
                        await handleError("ファイル書き込み", error)
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
                                // 自動承認の場合、特に追加処理はしない
                            } else {
                                await ask("command", removeClosingTag("command", command), block.partial).catch(() => {})
                            }
                            break
                        } else {
                            if (!command) {
                                state.consecutiveMistakeCount++
                                pushToolResult(await sayAndCreateMissingParamError("execute_command", "command"))
                                await saveCheckpoint()
                                break
                            }
                            if (!requiresApprovalRaw) {
                                state.consecutiveMistakeCount++
                                pushToolResult(
                                    await sayAndCreateMissingParamError("execute_command", "requires_approval"),
                                )
                                await saveCheckpoint()
                                break
                            }
                            state.consecutiveMistakeCount = 0

                            let didAutoApprove = false

                            if (!requiresApproval && shouldAutoApproveTool(block.name)) {
                                removeLastPartialMessageIfExistsWithType("ask", "command")
                                await say("command", command, undefined, false)
                                didAutoApprove = true
                            }

                            let timeoutId: NodeJS.Timeout | undefined
                            timeoutId = setTimeout(() => {
                                console.log("コマンド実行中: 自動承認されたコマンドが30秒以上実行中です。ご確認ください。")
                            }, 30_000)

                            const [userRejected, result] = await executeCommandTool(command)
                            if (timeoutId) {
                                clearTimeout(timeoutId)
                            }
                            if (userRejected) {
                                state.didRejectTool = true
                            }
                            pushToolResult(result)
                            break
                        }
                    } catch (error) {
                        await handleError("コマンド実行", error)
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
                                state.consecutiveMistakeCount++
                                pushToolResult(await sayAndCreateMissingParamError("ask_followup_question", "question"))
                                await saveCheckpoint()
                                break
                            }
                            state.consecutiveMistakeCount = 0

                            showSystemNotification({
                                subtitle: "Clineからの質問",
                                message: question.replace(/\n/g, " "),
                            })

                            const { text, images } = await ask("followup", question, false)
                            await say("user_feedback", text ?? "", images)
                            pushToolResult(formatResponse.toolResult(`<answer>\n${text}\n</answer>`, images))
                            await saveCheckpoint()
                            break
                        }
                    } catch (error) {
                        await handleError("質問送信", error)
                        await saveCheckpoint()
                        break
                    }
                }
                case "plan_mode_response": {
                    const response: string | undefined = block.params.response
                    try {
                        if (block.partial) {
                            await ask("plan_mode_response", removeClosingTag("response", response), block.partial).catch(() => {})
                            break
                        } else {
                            if (!response) {
                                state.consecutiveMistakeCount++
                                pushToolResult(await sayAndCreateMissingParamError("plan_mode_response", "response"))
                                break
                            }
                            state.consecutiveMistakeCount = 0
                            state.isAwaitingPlanResponse = true
                            const { text, images } = await ask("plan_mode_response", response, false)
                            state.isAwaitingPlanResponse = false

                            if (state.didRespondToPlanAskBySwitchingMode) {
                                pushToolResult(
                                    formatResponse.toolResult(
                                        `[ユーザーがACT MODEに切り替えたため、タスクを継続してください。]`,
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
                        await handleError("プランモード応答", error)
                        break
                    }
                }
                case "attempt_completion": {
                    const result: string | undefined = block.params.result
                    const command: string | undefined = block.params.command

                    const addNewChangesFlagToLastCompletionResultMessage = async () => {
                        // ワークスペースに新しい変更がある場合、フラグを追加
                        const hasNewChanges = await doesLatestTaskCompletionHaveNewChanges()
                        const lastCompletionResultMessage = findLast(state.clineMessages, (m) => m.say === "completion_result")
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
                        const lastMessage = state.clineMessages.at(-1)
                        if (block.partial) {
                            if (command) {
                                if (lastMessage && lastMessage.ask === "command") {
                                    await ask("command", removeClosingTag("command", command), block.partial).catch(() => {})
                                } else {
                                    await say("completion_result", removeClosingTag("result", result), undefined, false)
                                    await saveCheckpoint()
                                    await addNewChangesFlagToLastCompletionResultMessage()
                                    await ask("command", removeClosingTag("command", command), block.partial).catch(() => {})
                                }
                            } else {
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
                                state.consecutiveMistakeCount++
                                pushToolResult(await sayAndCreateMissingParamError("attempt_completion", "result"))
                                await saveCheckpoint()
                                break
                            }
                            state.consecutiveMistakeCount = 0

                            showSystemNotification({
                                subtitle: "タスク完了",
                                message: result.replace(/\n/g, " "),
                            })

                            let commandResult: ToolResponse | undefined
                            if (command) {
                                if (lastMessage && lastMessage.ask !== "command") {
                                    await say("completion_result", result, undefined, false)
                                    await saveCheckpoint()
                                    await addNewChangesFlagToLastCompletionResultMessage()
                                } else {
                                    await saveCheckpoint()
                                }

                                const didApprove = await askApproval("command", command)
                                if (!didApprove) {
                                    await saveCheckpoint()
                                    break
                                }
                                const [userRejected, execCommandResult] = await executeCommandTool(command!)
                                if (userRejected) {
                                    state.didRejectTool = true
                                    pushToolResult(execCommandResult)
                                    await saveCheckpoint()
                                    break
                                }
                                commandResult = execCommandResult
                            } else {
                                await say("completion_result", result, undefined, false)
                                await saveCheckpoint()
                                await addNewChangesFlagToLastCompletionResultMessage()
                            }

                            const { response, text, images } = await ask("completion_result", "", false)
                            if (response === "yesButtonClicked") {
                                pushToolResult("") // 再帰ループ停止のシグナル
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
                                text: `ユーザーからフィードバックが提供されました。フィードバックを参考にタスクを継続し、再度完了を試みてください。\n<feedback>\n${text}\n</feedback>`,
                            })
                            toolResults.push(...formatResponse.imageBlocks(images))
                            const message = state.userMessageContent
                            state.userMessageContent = [
                                ...message,
                                {
                                    type: "text",
                                    text: `タスク完了結果:`,
                                },
                                ...toolResults,
                            ]
                            break
                        }
                    } catch (error) {
                        await handleError("完了試行", error)
                        break
                    }
                }
            }
            break
    }

    // インデックスが範囲外の場合は、ストリーミングが完了しているかチェック
    state.presentAssistantMessageLocked = false // ロック解除
    if (!block.partial || state.didRejectTool || state.didAlreadyUseTool) {
        if (state.currentStreamingContentIndex === state.assistantMessageContent.length - 1) {
            state.userMessageContentReady = true
            console.log("[プレゼント] すべてのブロックの処理が完了しました。")
        }
        // 次のブロックが存在する場合は再帰的に処理を呼び出す
        state.currentStreamingContentIndex++
        if (state.currentStreamingContentIndex < state.assistantMessageContent.length) {
            console.log(`[プレゼント] 次のブロック（インデックス: ${state.currentStreamingContentIndex}, ${ state.assistantMessageContent.length}）の処理を再帰的に処理を呼び出し開始します。`)
            await presentAssistantMessage()
            return
        }
    }
    // 部分的なブロックであっても、更新が保留されていれば再呼び出し
    if (state.presentAssistantMessageHasPendingUpdates) {
        console.log("[プレゼント] 保留中の更新があるため、再度presentAssistantMessageを呼び出します。")
        await presentAssistantMessage()
    }
    console.log("[プレゼント] 終了") // ログ: 関数実行終了
}
