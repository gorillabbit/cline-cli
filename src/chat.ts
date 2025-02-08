import { ClineAsk, ClineAskResponse } from "./types.js";
import { globalStateManager } from "./globalState.js";
import { addToClineMessages, saveClineMessages } from "./tasks.js";
import pWaitFor from "p-wait-for";
import { prompt } from "./readline.js";

/**
 * askResponse 関連の状態をクリアする
 */
function clearAskResponse(): void {
  globalStateManager.updateState({
    askResponse: undefined,
    askResponseText: undefined,
    askResponseImages: undefined,
  });
}

/**
 * clineMessages の最後のメッセージを更新する
 * @param updatedMessage 更新済みのメッセージ
 */
function updateLastClineMessage(updatedMessage: any): void {
  const messages = globalStateManager.state.clineMessages;
  globalStateManager.updateState({
    clineMessages: [...messages.slice(0, -1), updatedMessage],
  });
}

/**
 * ask 関数
 * ・partial が true の場合は既存の部分更新メッセージがあれば更新、なければ新規追加後エラーで処理を中断
 * ・partial が false の場合は既存の部分メッセージを完結させるか、または新規追加
 * ・partial が undefined の場合は通常の新規 ask として追加
 *
 * 後続で globalStateManager の askResponse が設定されるまで待機し、該当メッセージに対する応答を返します。
 */
export const ask = async (
  type: ClineAsk,
  text?: string,
  partial?: boolean
): Promise<{ response: ClineAskResponse; text?: string; images?: string[] }> => {
  // 念のため askResponse 系をクリア
  clearAskResponse();

  let askTs = 0;
  const state = globalStateManager.state;
  const clineMessages = state.clineMessages;
  const lastMessage = clineMessages.at(-1);
  const isUpdatingPreviousPartial =
    lastMessage &&
    lastMessage.partial &&
    lastMessage.type === "ask" &&
    lastMessage.ask === type;

  if (partial !== undefined) {
    if (partial) {
      // partial === true の場合
      if (isUpdatingPreviousPartial) {
        // 既存の部分メッセージがあるなら更新
        lastMessage.text = text;
        lastMessage.partial = true; // 既に true だが念のため
        updateLastClineMessage(lastMessage);
        console.log("Partial message updated:", {
          type: "partialMessage",
          partialMessage: lastMessage,
        });
      } else {
        // 新規 partial メッセージの場合は、追加後にエラーをスローして以降の処理を中断
        askTs = Date.now();
        state.lastMessageTs = askTs;
        await addToClineMessages({
          ts: askTs,
          type: "ask",
          ask: type,
          text,
          partial: true,
        });
        throw new Error("Current ask promise was ignored 2");
      }
    } else {
      // partial === false の場合（＝既存の部分メッセージを完結させる）
      if (isUpdatingPreviousPartial) {
        // 既存の部分メッセージがあるなら complete 状態に更新
        clearAskResponse();
        askTs = lastMessage.ts;
        lastMessage.text = text;
        lastMessage.partial = false;
        updateLastClineMessage(lastMessage);
        await saveClineMessages();
        console.log("Partial message completed:", {
          type: "partialMessage",
          partialMessage: lastMessage,
        });
      } else {
        // 新規の complete メッセージとして追加
        askTs = Date.now();
        state.lastMessageTs = askTs;
        await addToClineMessages({
          ts: askTs,
          type: "ask",
          ask: type,
          text,
        });
      }
    }
  } else {
    // partial が undefined の場合は通常の新規 ask として追加
    askTs = Date.now();
    state.lastMessageTs = askTs;
    await addToClineMessages({
      ts: askTs,
      type: "ask",
      ask: type,
      text,
    });
  }

  // 後続の処理でこの ask に対する応答が globalStateManager.askResponse に設定されるのを待つ
  const res = await prompt("続きを実行しますか？");
  console.log("res:", res);
    if (res === "yes") {
        console.log("続きを実行します");
        globalStateManager.updateState({ 
            askResponse: "yesButtonClicked",
            askResponseText: "yes",
            askResponseImages: [],
        });
    } else {
        console.log("処理を中断します");
        globalStateManager.updateState({ 
            askResponse: "noButtonClicked",
            askResponseText: "no",
            askResponseImages: [],
        });
    }
  await pWaitFor(
    () => {
      const currentState = globalStateManager.state;
      return currentState.askResponse !== undefined || currentState.lastMessageTs !== askTs;
    },
    { interval: 100 }
  );

  const updatedState = globalStateManager.state;
  if (updatedState.lastMessageTs !== askTs) {
    throw new Error("Current ask promise was ignored");
  }
  const result = {
    response: updatedState.askResponse!,
    text: updatedState.askResponseText,
    images: updatedState.askResponseImages,
  };

  // 結果取得後、askResponse 関連の状態をクリア
  clearAskResponse();

  return result;
};
