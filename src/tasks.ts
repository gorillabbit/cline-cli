import * as path from 'path';
import * as fs from 'fs/promises';
import { taskBaseDir, GlobalFileNames } from './const.js';
import { Anthropic } from "@anthropic-ai/sdk"
import { globalStateManager } from './globalState.js';
import { ClineAsk, ClineSay, ToolUseName } from './types.js';
import { getApiMetrics } from './shared/getApiMetrics.js';
import getFolderSize from 'get-folder-size';
import { findLastIndex } from './shared/array.js';
import { combineApiRequests } from './shared/combineApiRequests.js';
import { HistoryItem } from './shared/HistoryItem.js';
import { formatResponse } from './prompts/responses.js';
import { combineCommandSequences } from './clineUtils.js';
import { AppDataSource, Ask, ClineMessage, MessageType, Say } from './database.js';

/**
 * 指定したtaskIdに対応するタスクディレクトリを作成し、必要なファイルを準備します。
 * ディレクトリが既に存在している場合は再帰的に作成され、存在しないファイルには空の配列をJSON化したデータを書き込みます。
 *
 * @param {string} taskId - タスクID
 */
export const ensureTaskDirectoryExists = async (
  taskId: string
) => {
  try {
    // 現在のグローバルステートにtaskIdを設定
    globalStateManager.updateState({ taskId });
    const taskDir = path.join(taskBaseDir, taskId);

    // タスクディレクトリが存在しない場合は再帰的に作成
    await fs.mkdir(taskDir, { recursive: true });

    // 必要なファイルが無い場合は空のデータを書き込んで作成する
    for (const file of Object.values(GlobalFileNames)) {
      const filePath = path.join(taskDir, file);
      await fs.writeFile(filePath, "[]");
    }

    // グローバルステートにタスクディレクトリを登録
    globalStateManager.updateState({ taskDir });
  } catch (error) {
    console.error("タスクディレクトリの作成に失敗しました:", error);
  }
};

/**
 * 保存されたAPI会話履歴を取得する関数
 * @returns {Promise<Anthropic.MessageParam[]>} - 保存されているAPI会話履歴の配列
 */
export const getSavedApiConversationHistory = async (): Promise<Anthropic.MessageParam[]> => {
  const taskDir = globalStateManager.state.taskDir;
  const filePath = path.join(
    taskDir,
    GlobalFileNames.apiConversationHistory
  );
  return JSON.parse(await fs.readFile(filePath, "utf8"));
};

/**
 * API会話履歴にメッセージを追加する関数
 * @param {Anthropic.MessageParam} message - 追加するメッセージオブジェクト
 */
export const addToApiConversationHistory = async (
  message: Anthropic.MessageParam,
) => {
  // 現在の履歴を取得し、メッセージを追加した上で保存
  const apiConversationHistory = await getSavedApiConversationHistory();
  apiConversationHistory.push(message);
  globalStateManager.updateState({ apiConversationHistory });
  await saveApiConversationHistory(apiConversationHistory);
};

/**
 * 新しいAPI会話履歴で既存の履歴を上書きする関数
 * @param {Anthropic.MessageParam[]} newHistory - 新しいAPI会話履歴
 */
export const overwriteApiConversationHistory = async (
  newHistory: Anthropic.MessageParam[],
) => {
  await saveApiConversationHistory(newHistory);
};

/**
 * API会話履歴を保存する関数
 * @param {Anthropic.MessageParam[]} apiConversationHistory - 保存対象のAPI会話履歴
 */
const saveApiConversationHistory = async (
  apiConversationHistory: Anthropic.MessageParam[],
) => {
  try {
    const taskDir = globalStateManager.state.taskDir;
    const filePath = path.join(
      taskDir,
      GlobalFileNames.apiConversationHistory
    );
    // JSON文字列に変換してファイルに書き込む
    await fs.writeFile(filePath, JSON.stringify(apiConversationHistory));
  } catch (error) {
    // 保存に失敗してもタスク自体は停止しない
    console.error("API会話履歴の保存に失敗しました:", error);
  }
};

/**
 * 保存されたClineメッセージを取得する関数
 * @returns {Promise<ClineMessage[]>} - Clineメッセージの配列
 */
export const getSavedClineMessages = async (): Promise<ClineMessage[]> => {
  // const taskDir = globalStateManager.state.taskDir;
  // const filePath = path.join(taskDir, GlobalFileNames.uiMessages);
  // const file = await fs.readFile(filePath, "utf8");
  // return JSON.parse(file);
  return [];
};

/**
 * 新しいClineメッセージをメッセージリストに追加し、保存する関数
 * @param {ClineMessage} message - 追加するClineメッセージオブジェクト
 */
export const addToClineMessages = async (
  message: Partial<ClineMessage>,
) => {
  // conversationHistoryIndexを現在のAPI会話履歴数 - 1 に設定（最後のユーザーメッセージを指す想定）
  const state = globalStateManager.state;
  message.conversationHistoryIndex = state.apiConversationHistory.length - 1;
  message.conversationHistoryDeletedRangeStart = state.conversationHistoryDeletedRange?.start ?? null;
  message.conversationHistoryDeletedRangeEnd = state.conversationHistoryDeletedRange?.end ?? null;
  if (message.type === "say" && !message.text) {
    return;
  }

  // const clineMessages = await getSavedClineMessages();
  // clineMessages.push(message);

  // グローバルステートにも反映
  // state.clineMessages = clineMessages;
  // await saveClineMessages();
  if (!AppDataSource.isInitialized) {
    console.error("Data Source not initialized");
    return;
  }
  const clineMessageRepository = AppDataSource.getRepository(ClineMessage);
  message.ts = message.ts ?? Date.now();
  message.taskId = state.taskId;
  const result = await clineMessageRepository.save(message);
  console.log("Added Cline message:", result);
  if (message.ts !== undefined) {
    state.clineMessages.push(message as ClineMessage);
  } else {
    console.error("Message timestamp is undefined");
  }
};

/**
 * 新しいClineメッセージ配列で既存のメッセージを上書きする関数
 * @param {ClineMessage[]} newMessages - 新しいClineメッセージ配列
 */
export const overwriteClineMessages = async (
  newMessages: ClineMessage[],
) => {
  globalStateManager.state.clineMessages = newMessages;
  // await saveClineMessages();
};

/**
 * Clineメッセージを保存する関数。保存後にタスクヒストリーの更新も行う。
 */
// export const saveClineMessages = async () => {
//   try {
//     const state = globalStateManager.state;
//     const taskDir = state.taskDir;
//     const filePath = path.join(taskDir, GlobalFileNames.uiMessages);
//     const clineMessages = state.clineMessages;

//     // ClineメッセージをファイルにJSONとして書き込み
//     await fs.writeFile(filePath, JSON.stringify(clineMessages));

//     // ChatView上で結合されるのと同様にAPIメトリクスを取得
//     const apiMetrics = getApiMetrics(
//       combineApiRequests(
//         combineCommandSequences(clineMessages.slice(1))
//       )
//     );

//     // 最初のメッセージ（タスク内容）
//     const taskMessage = clineMessages[0];

//     // 「resume_task」や「resume_completed_task」を除いた最後の関連メッセージを検索
//     const lastRelevantMessage =
//       clineMessages[
//         findLastIndex(clineMessages, (m) => !(m.ask === "resume_task" || m.ask === "resume_completed_task"))
//       ];

//     let taskDirSize = 0;
//     try {
//       // getFolderSize.looseはエラーを無視して実行
//       // バイト数が返るので、size / 1000 / 1000 でMB換算可能
//       taskDirSize = await getFolderSize.loose(taskDir);
//     } catch (error) {}

//     // ヒストリーを更新
//     updateTaskHistory({
//       id: state.taskId,
//       ts: lastRelevantMessage.ts,
//       task: taskMessage.text ?? "",
//       tokensIn: apiMetrics.totalTokensIn,
//       tokensOut: apiMetrics.totalTokensOut,
//       cacheWrites: apiMetrics.totalCacheWrites,
//       cacheReads: apiMetrics.totalCacheReads,
//       totalCost: apiMetrics.totalCost,
//       size: taskDirSize,
//       conversationHistoryDeletedRange: state.conversationHistoryDeletedRange,
//     });
//   } catch (error) {
//     console.error("Clineメッセージの保存に失敗しました:", error);}
// };

/**
 * タスク履歴を更新するためのヘルパー関数
 * @param {HistoryItem} item - タスク履歴アイテム
 * @returns {HistoryItem[]} - 更新後のタスク履歴配列
 */
const updateTaskHistory = (item: HistoryItem): HistoryItem[] => {

  const history = globalStateManager.state.taskHistory;
  const existingItemIndex = history.findIndex((h) => h.id === item.id);

  if (existingItemIndex !== -1) {
    // 既存のタスクがある場合は置き換える
    history[existingItemIndex] = item;
  } else {
    // ない場合は新規に追加
    history.push(item);
  }
  return history;
};

/**
 * 指定したタイプ(ClineSay)のメッセージを追加または更新する関数。
 * partialフラグが指定された場合、前回のpartialメッセージを更新または新たにpartialメッセージを作成する。
 *
 * @param {ClineSay} type - メッセージ種別（例: "error", "info"など）
 * @param {string} [text] - メッセージ本文
 * @param {string[]} [images] - 画像URLなどの配列
 * @param {boolean} [partial] - partialフラグ。trueの場合はストリーミング中の未完成メッセージを扱う
 */
export const say = async (type: Say, text?: string, images?: string, partial?: boolean) => {
  const state = globalStateManager.state;
  if (partial !== undefined) {
    const lastMessage = state.clineMessages.at(-1);

    // 直近のメッセージがpartial状態＆同じtypeの場合は更新を行う
    const isUpdatingPreviousPartial =
      lastMessage && lastMessage.partial && lastMessage.type === "say" && lastMessage.say === type;

    if (partial) {
      // partialがtrueの場合
      if (isUpdatingPreviousPartial) {
        // 既存のpartialメッセージを更新
        lastMessage.text = text;
        lastMessage.images = images;
        lastMessage.partial = partial;
      } else {
        // 新しいpartialメッセージを追加
        const sayTs = Date.now();
        state.lastMessageTs = sayTs;
        await addToClineMessages({
          ts: sayTs,
          type:MessageType.SAY,
          say: type,
          text,
          images,
          partial,
        });
      }
    } else {
      // partialがfalseの場合、既存のpartialメッセージを完成版に置き換える
      if (isUpdatingPreviousPartial) {
        // 既存のpartialメッセージを完成形に更新
        state.lastMessageTs = lastMessage.ts;
        lastMessage.text = text;
        lastMessage.images = images;
        lastMessage.partial = false;

        // ディスクに保存
        // saveClineMessages();
      } else {
        // 新しいメッセージとして追加
        const sayTs = Date.now();
        state.lastMessageTs = sayTs;
        await addToClineMessages({
          ts: sayTs,
          type: MessageType.SAY,
          say: type,
          text,
          partial,
          images,
        });
      }
    }
  } else {
    // partialが指定されていない通常メッセージの場合
    const sayTs = Date.now();
    state.lastMessageTs = sayTs;
    await addToClineMessages({
      ts: sayTs,
      type: MessageType.SAY,
      say: type,
      text,
      images,
    });
  }
};

/**
 * 必須パラメータが欠けていることをユーザーに伝え、再試行する際に使用するエラーメッセージを作成する関数
 * @param {ToolUseName} toolName - ツール名
 * @param {string} paramName - 欠けているパラメータ名
 * @param {string} [relPath] - 関連ファイルパス（任意）
 * @returns {Promise<string>} - フォーマットされたエラーメッセージ（再試行用）
 */
export const sayAndCreateMissingParamError = async (toolName: ToolUseName, paramName: string, relPath?: string): Promise<string> => {
  await say(
    Say.ERROR,
    `Clineは${toolName}を使用しようとしましたが、必須パラメータ'${paramName}'に値がありません。${
      relPath ? `対象: '${relPath}'` : ""
    } 再試行します...`
  );
  return formatResponse.toolError(formatResponse.missingToolParameterError(paramName));
};

/**
 * 最後のメッセージが指定したタイプかつpartial状態である場合、配列から取り除く関数。
 * @param {"ask" | "say"} type - メッセージタイプ
 * @param {ClineAsk | ClineSay} askOrSay - "ask"または"say"の具体的な値
 */
export const removeLastPartialMessageIfExistsWithType = (type: MessageType, askOrSay: Ask | Say) => {
  const clineMessages = globalStateManager.state.clineMessages;
  const lastMessage = clineMessages.at(-1);
  if (
    lastMessage?.partial &&
    lastMessage.type === type &&
    (lastMessage.ask === askOrSay || lastMessage.say === askOrSay)
  ) {
    // 対象のpartialメッセージを削除し、保存
    clineMessages.pop();
    // saveClineMessages();
  }
};
