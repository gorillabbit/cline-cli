import Anthropic from "@anthropic-ai/sdk"
import path from "path"
import { serializeError } from "serialize-error"
import cloneDeep from "clone-deep"
import { ToolParamName } from "../assistant-message/index.js"
import { ask } from "../chat.js"
import { saveCheckpoint } from "../checkpoint.js"
import { globalStateManager } from "../globalState.js"
import { extractTextFromFile } from "../integrations/misc/extract-text.js"
import { formatResponse } from "../prompts/responses.js"
import { listFiles } from "../services/glob/list-files.js"
import { regexSearchFiles } from "../services/ripgrep/index.js"
import { parseSourceCodeForDefinitionsTopLevel } from "../services/tree-sitter/index.js"
import { findLast } from "../shared/array.js"
import { say, removeLastPartialMessageIfExistsWithType, sayAndCreateMissingParamError } from "../tasks.js"
import { ToolResponse, ClineSayTool, COMPLETION_RESULT_CHANGES_FLAG } from "../types.js"
import { getReadablePath } from "../utils/path.js"
import { doesLatestTaskCompletionHaveNewChanges } from "./doesLatestTaskCompletionHaveNewChanges.js"
import { executeCommandTool } from "./executeCommandTool.js"
import { GenericDiffProvider } from "../integrations/editor/DiffViewProvider.js"
import { fileExistsAtPath } from "../utils/fs.js"
import { constructNewFileContent } from "../assistant-message/diff.js"
import { Ask, MessageType, Say } from "../database.js"

/**
 * アシスタントのメッセージをユーザーに提示し、各種コンテンツブロックやツールとの対話を処理します。
 * Present assistant messages and handle tool interactions.
 */
export const presentAssistantMessage = async () => {
    const state = globalStateManager.state
    const genericDiffProvider = new GenericDiffProvider(state.workspaceFolder ?? "")
    if (!state.workspaceFolder) {
        throw new Error("Workspace folder not set")
    }

    console.log("1:[presentAssistantMessage] 開始", {
        locked: state.presentAssistantMessageLocked,
        pendingUpdates: state.presentAssistantMessageHasPendingUpdates,
        index: state.currentStreamingContentIndex,
    }); // ログ: 関数実行開始

    // タスク中止が指定されている場合はエラーを投げる
    if (state.abort) {
        console.log("中断フラグが立っているため、処理を停止します。")
        throw new Error("Cline instance aborted")
    }

    // メッセージ提示処理がロックされている場合は、更新をフラグに記録して終了
    if (state.presentAssistantMessageLocked) {
        console.log("2:[presentAssistantMessage] presentAssistantMessageLockedがtrueのため、更新を保留します。")
        console.log("Setting presentAssistantMessageHasPendingUpdates to true");
        state.presentAssistantMessageHasPendingUpdates = true
        return
    }
    console.log("Setting presentAssistantMessageLocked to true");
    state.presentAssistantMessageLocked = true
    state.presentAssistantMessageHasPendingUpdates = false

    // 現在のストリーミングインデックスが範囲外の場合
    if (state.currentStreamingContentIndex >= state.assistantMessageContent.length) {
        // ストリーミングが完了している場合、ユーザーメッセージの準備ができたことを示す
        if (state.didCompleteReadingStream) {
            state.userMessageContentReady = true
            console.log("3:[presentAssistantMessage]ストリーミング完了: ユーザーメッセージの準備完了")
        }
        console.log("Setting presentAssistantMessageLocked to false");
        state.presentAssistantMessageLocked = false
        return
    }

    // ストリーミング中に配列が更新される可能性があるため、ディープコピーを作成
    const block = cloneDeep(state.assistantMessageContent[state.currentStreamingContentIndex])
    console.log(`4:[presentAssistantMessage]処理中のブロック: `,block)

    switch (block.type) {
        case "text": {
            console.log("Processing text block");
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

            await say(Say.TEXT, content, undefined, block.partial)
            break
        }
        case "tool_use":
            console.log("Processing tool_use block:", block.name);
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
            const askApproval = async (type: Ask, partialMessage?: string) => {
                await ask(type, partialMessage, false)
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
                    Say.ERROR,
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
                    if (genericDiffProvider.editType !== undefined) {
                        fileExists = genericDiffProvider.editType === "modify"
                    } else {
                        const absolutePath = path.resolve(state.workspaceFolder ?? "", relPath)
                        fileExists = await fileExistsAtPath(absolutePath)
                        genericDiffProvider.editType = fileExists ? "modify" : "create"
                    }

                    try {
                        let newContent: string = ""
                        if (diff) {
                            if (!genericDiffProvider.isEditing) {
                                await genericDiffProvider.open(relPath)
                            }

                            try {
                                newContent = await constructNewFileContent(
                                    diff,
                                    genericDiffProvider.originalContent || "",
                                    !block.partial,
                                )
                            } catch (error) {
                                await say(Say.DIFF_ERROR, relPath)
                                pushToolResult(
                                    formatResponse.toolError(
                                        `${(error as Error)?.message}\n\n` +
                                            `This is likely because the SEARCH block content doesn't match exactly with what's in the file, or if you used multiple SEARCH/REPLACE blocks they may not have been in the order they appear in the file.\n\n` +
                                            `The file was reverted to its original state:\n\n` +
                                            `<file_content path="${relPath.toPosix()}">\n${genericDiffProvider.originalContent}\n</file_content>\n\n` +
                                            `Try again with a more precise SEARCH block.\n(If you keep running into this error, you may use the write_to_file tool as a workaround.)`,
                                    ),
                                )
                                await genericDiffProvider.revertChanges()
                                await genericDiffProvider.reset()
                                break
                            }
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
                            path: getReadablePath(state.workspaceFolder ?? "", removeClosingTag("path", relPath)),
                            content: diff || content,
                        }

                        if (block.partial) {
                            const partialMessage = JSON.stringify(sharedMessageProps)
                            removeLastPartialMessageIfExistsWithType(MessageType.ASK, Ask.TOOL)
                                await say(Say.TOOL, partialMessage, undefined, block.partial)
                            // update editor
                            if (!genericDiffProvider.isEditing) {
                                // open the editor and prepare to stream content in
                                await genericDiffProvider.open(relPath)
                            }
                            // editor is open, stream content in
                            await genericDiffProvider.update(newContent, false)
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
                            if (!genericDiffProvider.isEditing) {
                                // show gui message before showing edit animation
                                const partialMessage = JSON.stringify(sharedMessageProps)
                                await ask(Ask.TOOL, partialMessage, true).catch(() => {}) // sending true for partial even though it's not a partial, this shows the edit row before the content is streamed into the editor
                                await genericDiffProvider.open(relPath) // updated to use genericDiffProvider
                            }
                            await genericDiffProvider.update(newContent, true) // updated to use genericDiffProvider

                            const completeMessage = JSON.stringify({
                                ...sharedMessageProps,
                                content: diff || content,
                            } satisfies ClineSayTool)


                            console.log(`Tool operation '${block.name}' completed successfully.`);
                            removeLastPartialMessageIfExistsWithType(MessageType.ASK, Ask.TOOL)
                            await say(Say.TOOL, completeMessage, undefined, false)
                        }
                    } catch (error) {
                        await handleError("ファイル書き込み", error)
                        break
                    }
                    break
                }
                case "read_file": {
                    const relPath: string | undefined = block.params.path
                    if (!state.workspaceFolder) {
                        break
                    }
                    const sharedMessageProps: ClineSayTool = {
                        tool: "readFile",
                        path: getReadablePath(state.workspaceFolder, removeClosingTag("path", relPath)),
                    }
                    try {
                        if (block.partial) {
                            const partialMessage = JSON.stringify({
                                ...sharedMessageProps,
                                content: undefined,
                            } satisfies ClineSayTool)
                            removeLastPartialMessageIfExistsWithType(MessageType.ASK, Ask.TOOL)
                            await say(Say.TOOL, partialMessage, undefined, block.partial)
                            break
                        } else {
                            if (!relPath) {
                                state.consecutiveMistakeCount++
                                pushToolResult(await sayAndCreateMissingParamError("read_file", "path"))
                                break
                            }
                            state.consecutiveMistakeCount = 0
                            const absolutePath = path.resolve(state.workspaceFolder, relPath)
                            const completeMessage = JSON.stringify({
                                ...sharedMessageProps,
                                content: absolutePath,
                            } satisfies ClineSayTool)
                            removeLastPartialMessageIfExistsWithType(MessageType.ASK, Ask.TOOL)
                            await say(Say.TOOL, completeMessage, undefined, false)
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
                        path: getReadablePath(state.workspaceFolder, removeClosingTag("path", relDirPath)),
                    }
                    try {
                        if (block.partial) {
                            const partialMessage = JSON.stringify({
                                ...sharedMessageProps,
                                content: "",
                            } satisfies ClineSayTool)
                            removeLastPartialMessageIfExistsWithType(MessageType.ASK, Ask.TOOL)
                            await say(Say.TOOL, partialMessage, undefined, block.partial)
                            break
                        }else {
                            if (!relDirPath) {
                                state.consecutiveMistakeCount++
                                pushToolResult(await sayAndCreateMissingParamError("list_files", "path"))
                                await saveCheckpoint()
                                break
                            }
                            state.consecutiveMistakeCount = 0
                            const absolutePath = path.resolve(state.workspaceFolder, relDirPath)
                            const [files, didHitLimit] = await listFiles(absolutePath, recursive, 200)
                            const result = formatResponse.formatFilesList(absolutePath, files, didHitLimit)
                            const completeMessage = JSON.stringify({
                                ...sharedMessageProps,
                                content: result,
                            } satisfies ClineSayTool)
                            removeLastPartialMessageIfExistsWithType(MessageType.ASK, Ask.TOOL)
                            await say(Say.TOOL, completeMessage, undefined, false)
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
                        path: getReadablePath(state.workspaceFolder, removeClosingTag("path", relDirPath)),
                    }
                    try {
                        if (block.partial) {
                            const partialMessage = JSON.stringify({
                                ...sharedMessageProps,
                                content: "",
                            } satisfies ClineSayTool)
                            removeLastPartialMessageIfExistsWithType(MessageType.ASK, Ask.TOOL)
                            await say(Say.TOOL, partialMessage, undefined, block.partial)
                            break
                         } else {
                            if (!relDirPath) {
                                state.consecutiveMistakeCount++
                                pushToolResult(await sayAndCreateMissingParamError("list_code_definition_names", "path"))
                                break
                            }
                            state.consecutiveMistakeCount = 0
                            const absolutePath = path.resolve(state.workspaceFolder, relDirPath)
                            const result = await parseSourceCodeForDefinitionsTopLevel(absolutePath)
                            const completeMessage = JSON.stringify({
                                ...sharedMessageProps,
                                content: result,
                            } satisfies ClineSayTool)
                            removeLastPartialMessageIfExistsWithType(MessageType.SAY, Say.TOOL)
                            await say(Say.TOOL, completeMessage, undefined, false)
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
                        path: getReadablePath(state.workspaceFolder, removeClosingTag("path", relDirPath)),
                        regex: removeClosingTag("regex", regex),
                        filePattern: removeClosingTag("file_pattern", filePattern),
                    }
                    try {
                        if (block.partial) {
                            const partialMessage = JSON.stringify({
                                ...sharedMessageProps,
                                content: "",
                            } satisfies ClineSayTool)
                            removeLastPartialMessageIfExistsWithType(MessageType.ASK, Ask.TOOL)
                            await say(Say.TOOL, partialMessage, undefined, block.partial)
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
                            const absolutePath = path.resolve(state.workspaceFolder, relDirPath)
                            const results = await regexSearchFiles(state.workspaceFolder, absolutePath, regex, filePattern)
                            const completeMessage = JSON.stringify({
                                ...sharedMessageProps,
                                content: results,
                            } satisfies ClineSayTool)
                            removeLastPartialMessageIfExistsWithType(MessageType.SAY, Say.TOOL)
                            await say(Say.TOOL, completeMessage, undefined, false)
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
                    try {
                        if (block.partial) {
                            break
                        } else {
                            if (!command) {
                                state.consecutiveMistakeCount++
                                pushToolResult(await sayAndCreateMissingParamError("execute_command", "command"))
                                await saveCheckpoint()
                                break
                            }
                            state.consecutiveMistakeCount = 0

                            removeLastPartialMessageIfExistsWithType(MessageType.ASK, Ask.COMMAND)
                            await say(Say.COMMAND, command, undefined, false)

                            const [result] = await executeCommandTool(command)
                            console.log(`Tool operation 'execute_command' completed successfully.`);
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
                            await ask(Ask.FOLLOWUP, removeClosingTag("question", question), block.partial).catch(() => {})
                            break
                        } else {
                            if (!question) {
                                state.consecutiveMistakeCount++
                                pushToolResult(await sayAndCreateMissingParamError("ask_followup_question", "question"))
                                await saveCheckpoint()
                                break
                            }
                            state.consecutiveMistakeCount = 0

                            console.log({
                                subtitle: "Clineからの質問",
                                message: question.replace(/\n/g, " "),
                            })

                            const { text, images } = await ask(Ask.FOLLOWUP, question, false)
                            await say(Say.USER_FEEDBACK, text ?? "", images)
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
                            await ask(Ask.PLAN_MODE_RESPONSE, removeClosingTag("response", response), block.partial).catch(() => {})
                            break
                        } else {
                            if (!response) {
                                state.consecutiveMistakeCount++
                                pushToolResult(await sayAndCreateMissingParamError("plan_mode_response", "response"))
                                break
                            }
                            state.isAwaitingPlanResponse = true
                            const { text, images } = await ask(Ask.PLAN_MODE_RESPONSE, response, false)
                            state.isAwaitingPlanResponse = false

                            if (state.didRespondToPlanAskBySwitchingMode) {
                                pushToolResult(
                                    formatResponse.toolResult(
                                        `[ユーザーがACT MODEに切り替えたため、タスクを継続してください。]`,
                                        images,
                                    ),
                                )
                            } else {
                                await say(Say.USER_FEEDBACK, text ?? "", images)
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
                    }

                    try {
                        const lastMessage = state.clineMessages.at(-1)
                        if (block.partial) {
                            if (command) {
                                if (lastMessage && lastMessage.ask === "command") {
                                    await ask(Ask.COMMAND, removeClosingTag("command", command), block.partial).catch(() => {})
                                } else {
                                    await say(Say.COMPLETION_RESULT, removeClosingTag("result", result), undefined, false)
                                    await saveCheckpoint()
                                    await addNewChangesFlagToLastCompletionResultMessage()
                                    await ask(Ask.COMMAND, removeClosingTag("command", command), block.partial).catch(() => {})
                                }
                            } else {
                                await say(
                                    Say.COMPLETION_RESULT,
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

                            console.log({
                                subtitle: "タスク完了",
                                message: result.replace(/\n/g, " "),
                            })

                            let commandResult: ToolResponse | undefined
                            if (command) {
                                if (lastMessage && lastMessage.ask !== "command") {
                                    await say(Say.COMPLETION_RESULT, result, undefined, false)
                                    await saveCheckpoint()
                                    await addNewChangesFlagToLastCompletionResultMessage()
                                } else {
                                    await saveCheckpoint()
                                }

                                await askApproval(Ask.COMMAND, command)
                                const [execCommandResult] = await executeCommandTool(command!)
                                commandResult = execCommandResult
                            } else {
                                await say(Say.COMPLETION_RESULT, result, undefined, false)
                                await saveCheckpoint()
                                await addNewChangesFlagToLastCompletionResultMessage()
                            }

                            const { response, text, images } = await ask(Ask.COMPLETION_RESULT, "", false)
                            console.log("ユーザーの完了試行フィードバック: ", response)
                            console.log("ユーザーの完了試行テキスト: ", text)
                            console.log("ユーザーの完了試行画像: ", images)
                            if (response === "yesButtonClicked") {
                                console.log("再帰ループ停止のシグナルを送信します。")
                                state.taskCompleted = true; // Add this line
                                pushToolResult("") // 再帰ループ停止のシグナル
                                break
                            }
                            await say(Say.USER_FEEDBACK, text ?? "", images)

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
    console.log("Setting presentAssistantMessageLocked to false");
    state.presentAssistantMessageLocked = false // ロック解除
    if (!block.partial || state.didRejectTool || state.didAlreadyUseTool) {
        if (state.currentStreamingContentIndex === state.assistantMessageContent.length - 1) {
            state.userMessageContentReady = true
            console.log("[presentAssistantMessage] すべてのブロックの処理が完了しました。")
        }
        // 次のブロックが存在する場合は再帰的に処理を呼び出す
        state.currentStreamingContentIndex++
        if (state.currentStreamingContentIndex < state.assistantMessageContent.length) {
            console.log(`[presentAssistantMessage] 次のブロック（インデックス: ${state.currentStreamingContentIndex}, ${ state.assistantMessageContent.length}）の処理を再帰的に処理を呼び出し開始します。`, {
                locked: state.presentAssistantMessageLocked,
                pendingUpdates: state.presentAssistantMessageHasPendingUpdates,
                index: state.currentStreamingContentIndex
            });
            await presentAssistantMessage()
            return
        }
    }
    // 部分的なブロックであっても、更新が保留されていれば再呼び出し
    if (state.presentAssistantMessageHasPendingUpdates) {
        console.log("[presentAssistantMessage] 保留中の更新があるため、再度presentAssistantMessageを呼び出します。")
        await presentAssistantMessage()
    }
    console.log("[presentAssistantMessage] 終了") // ログ: 関数実行終了
}

/**
 * ストリーム処理前に各種ストリーム関連状態をリセットする
 */
function resetStreamingState(): void {
    const state = globalStateManager.state;
    state.assistantMessageContent = [];
    state.didCompleteReadingStream = false;
    state.userMessageContent = [];
    state.userMessageContentReady = false;
    state.didRejectTool = false;
    state.didAlreadyUseTool = false;
    state.presentAssistantMessageLocked = false;
    state.presentAssistantMessageHasPendingUpdates = false;
    state.didAutomaticallyRetryFailedApiRequest = false;
    state.currentStreamingContentIndex = 0;
    state.taskCompleted = false; // Add this line
}
