import { ClineAsk, ClineAskResponse } from "./types.js"
import { globalStateManager} from "./globalState.js"
import { addToClineMessages, saveClineMessages } from "./tasks.js"
import pWaitFor from "p-wait-for"

export const ask = async (
    type: ClineAsk,
    text?: string,
    partial?: boolean,
): Promise<{
    response: ClineAskResponse
    text?: string
    images?: string[]
}> => {
    let askTs: number = 0
    const clineMessages = globalStateManager.getState().clineMessages

    if (partial !== undefined) {
        const lastMessage = clineMessages.at(-1)
        const isUpdatingPreviousPartial =
            lastMessage && lastMessage.partial && lastMessage.type === "ask" && lastMessage.ask === type
        if (partial) {
            if (isUpdatingPreviousPartial) {
                // existing partial message, so update it
                lastMessage.text = text
                lastMessage.partial = partial
                globalStateManager.updateState({clineMessages:[...clineMessages.slice(0, -1), lastMessage]})
                console.log("Partial message updated:",{
                    type: "partialMessage",
                    partialMessage: lastMessage,
                })
            } else {
                askTs = Date.now()
                globalStateManager.updateState({lastMessageTs:askTs})
                await addToClineMessages({
                    ts: askTs,
                    type: "ask",
                    ask: type,
                    text,
                    partial,
                })
                throw new Error("Current ask promise was ignored 2")
            }
        } else {
            // partial=false means its a complete version of a previously partial message
            if (isUpdatingPreviousPartial) {
                globalStateManager.updateState({
                    askResponse:undefined, 
                    askResponseText:undefined, 
                    askResponseImages:undefined
                })
                // this is the complete version of a previously partial message, so replace the partial with the complete version

                askTs = lastMessage.ts
                lastMessage.text = text
                lastMessage.partial = false
                globalStateManager.updateState({
                    lastMessageTs:askTs,
                    clineMessages:[...clineMessages.slice(0, -1), lastMessage]
                })
                await saveClineMessages()
                console.log("Partial message completed:",{
                    type: "partialMessage",
                    partialMessage: lastMessage,
                })
            } else {
                // this is a new partial=false message, so add it like normal
                askTs = Date.now()
                globalStateManager.updateState({
                    askResponse:undefined, 
                    askResponseText:undefined, 
                    askResponseImages:undefined,
                    lastMessageTs:askTs
                })
                await addToClineMessages({
                    ts: askTs,
                    type: "ask",
                    ask: type,
                    text,
                })
            }
        }
    } else {
        // this is a new non-partial message, so add it like normal
        askTs = Date.now()
        globalStateManager.updateState({
            askResponse:undefined, 
            askResponseText:undefined, 
            askResponseImages:undefined,
            lastMessageTs:askTs
        })
        await addToClineMessages({
            ts: askTs,
            type: "ask",
            ask: type,
            text,
        })
    }

    const state = globalStateManager.getState()

    await pWaitFor(() => state.askResponse !== undefined || state.lastMessageTs !== askTs, { interval: 100 })
    if (state.lastMessageTs !== askTs) {
        throw new Error("Current ask promise was ignored") // could happen if we send multiple asks in a row i.e. with command_output. It's important that when we know an ask could fail, it is handled gracefully
    }
    const result = {
        response: state.askResponse!,
        text: state.askResponseText,
        images: state.askResponseImages,
    }
    globalStateManager.updateState({
        askResponse:undefined, 
        askResponseText:undefined, 
        askResponseImages:undefined
    })
    return result
}
