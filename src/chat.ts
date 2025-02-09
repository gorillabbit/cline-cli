import { ClineAskResponse } from "./types.js";
import { globalStateManager } from "./globalState.js";
import { addToClineMessages } from "./tasks.js";
import { Ask, MessageType } from "./database.js";
import * as readline from 'readline';

const requireAnswer = async (text: string) => {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  try {
    const answer = await new Promise<string>((resolve) => {
      rl.question(text, resolve);
    });
    const state = globalStateManager.state;
    state.askResponse = "yesButtonClicked";
    state.askResponseText = answer;
    state.askResponseImages = "";
  } catch (err) {
    console.error('エラーが発生しました:', err);
  } finally {
    rl.close();
  }
};


/**
 * askResponse 関連の状態をクリアする
 */
function clearAskResponse(): void {
  const state = globalStateManager.state
  state.askResponse = undefined
  state.askResponseText = undefined
  state.askResponseImages = undefined
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
  type: Ask,
  text?: string,
  partial?: boolean
): Promise<{ response: ClineAskResponse; text?: string; images?: string }> => {
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

  state.askResponse = "yesButtonClicked";
  state.askResponseText = "yes";
  state.askResponseImages = "";

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
        if (text) {
          // テキストがある場合は応答を求める
          clearAskResponse();
          await requireAnswer(text);
        }
      } else {
        // 新規 partial メッセージの場合は、追加後にエラーをスローして以降の処理を中断
        askTs = Date.now();
        state.lastMessageTs = askTs;
        await addToClineMessages({
          ts: askTs,
          type: MessageType.ASK,
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
        askTs = lastMessage.ts;
        lastMessage.text = text;
        lastMessage.partial = false;
        updateLastClineMessage(lastMessage);
        if (text) {
          // テキストがある場合は応答を求める
          clearAskResponse();
          await requireAnswer(text);
        }
      } else {
        // 新規の complete メッセージとして追加
        askTs = Date.now();
        state.lastMessageTs = askTs;
        await addToClineMessages({
          ts: askTs,
          type: MessageType.ASK,
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
      type: MessageType.ASK,
      ask: type,
      text,
    });
  }

  if (state.lastMessageTs !== askTs) {
    throw new Error("Current ask promise was ignored");
  }
  const result = {
    response: state.askResponse,
    text: state.askResponseText,
    images: state.askResponseImages,
  };
  return result;
};
