import delay from "delay";
import path from "path";
import fs from "fs/promises";
import { serializeError } from "serialize-error";
import { cwd } from "process";
import { OpenRouterHandler } from "../api/providers/openrouter.js";
import { OpenAiHandler } from "../api/providers/openai.js";
import { ask } from "../chat.js";
import { getTruncatedMessages } from "../clineUtils.js";
import { GlobalFileNames } from "../const.js";
import { globalStateManager } from "../globalState.js";
import { SYSTEM_PROMPT, addUserInstructions } from "../prompts/system.js";
import { say } from "../tasks.js";
import { ClineApiReqInfo } from "../types.js";
import { fileExistsAtPath } from "../utils/fs.js";
import Anthropic from "@anthropic-ai/sdk";
import { apiStateManager } from "../apiState.js";
import { buildApiHandler } from "../api/index.js";
import { Ask, Say } from "../database.js";

/**
 * APIリクエスト用のシステムプロンプトを構築する
 */
async function buildSystemPrompt(): Promise<string> {
  const apiHandler = buildApiHandler(apiStateManager.getState());
  const state = globalStateManager.state;
  if (!state.workspaceFolder) {
    throw new Error("Workspace folder not set");
  }
  let prompt = await SYSTEM_PROMPT(state.workspaceFolder, apiHandler.getModel().info.supportsComputerUse ?? false);
  
  // ユーザー固有の設定
  const customInstructions = state.customInstructions?.trim();
  const clineRulesFilePath = path.resolve(state.workspaceFolder, GlobalFileNames.clineRules);
  let clineRulesInstructions: string | undefined;

  // .clinerulesファイルの内容を読み込む
  if (await fileExistsAtPath(clineRulesFilePath)) {
    try {
      const ruleFileContent = (await fs.readFile(clineRulesFilePath, "utf8")).trim();
      if (ruleFileContent) {
        clineRulesInstructions = `# .clinerules\n\nThe following instructions are provided by the .clinerules file for this working directory (${state.workspaceFolder}):\n\n${ruleFileContent}`;
        console.log("[buildSystemPrompt] .clinerulesの内容を取得しました。");
      }
    } catch (error) {
      console.error(`[buildSystemPrompt] .clinerulesファイルの読み込みに失敗しました: ${clineRulesFilePath}`, error);
    }
  }

  // ユーザー設定および.clinerulesの内容をプロンプトに追加
  if (customInstructions || clineRulesInstructions) {
    prompt += addUserInstructions(customInstructions, clineRulesInstructions);
    console.log("[buildSystemPrompt] ユーザー指示をシステムプロンプトに追加しました。");
  }
  return prompt;
}

/**
 * コンテキストウィンドウサイズに応じた最大許容トークン数を計算する
 */
function getMaxAllowedTokens(apiHandler: ReturnType<typeof buildApiHandler>): number {
  // 基本はコンテキストサイズに応じたマージンを引く
  let contextWindow = apiHandler.getModel().info.contextWindow || 128_000;
  if (apiHandler instanceof OpenAiHandler && apiHandler.getModel().id.toLowerCase().includes("deepseek")) {
    contextWindow = 64_000;
  }
  switch (contextWindow) {
    case 64_000:
      return contextWindow - 27_000;
    case 128_000:
      return contextWindow - 30_000;
    case 200_000:
      return contextWindow - 40_000;
    default:
      return Math.max(contextWindow - 40_000, contextWindow * 0.8);
  }
}

/**
 * 前回のリクエストのトークン使用量を確認し、必要なら会話履歴のトリミングを行う
 */
async function trimHistoryIfNeeded(previousApiReqIndex: number): Promise<void> {
  const state = globalStateManager.state;
  if (previousApiReqIndex < 0) {return;}

  const previousRequest = state.clineMessages[previousApiReqIndex];
  if (previousRequest?.text) {
    const { tokensIn, tokensOut, cacheWrites, cacheReads }: ClineApiReqInfo = JSON.parse(previousRequest.text);
    const totalTokens = (tokensIn || 0) + (tokensOut || 0) + (cacheWrites || 0) + (cacheReads || 0);

    const apiHandler = buildApiHandler(apiStateManager.getState());
    const maxAllowed = getMaxAllowedTokens(apiHandler);

    console.log(`[trimHistoryIfNeeded] トークン合計: ${totalTokens} / 最大許容: ${maxAllowed}`);
    if (totalTokens >= maxAllowed) {
      console.log("[trimHistoryIfNeeded] コンテキストウィンドウに近づいたため、履歴をトリミングします。");
      const keep = totalTokens / 2 > maxAllowed ? "quarter" : "half";
      const newRange = getNextTruncationRange(
        state.apiConversationHistory,
        state.conversationHistoryDeletedRange,
        keep
      );
      state.conversationHistoryDeletedRange = newRange;
    }
  }
}

/**
 * attemptApiRequest
 * APIリクエストの最初のチャンク取得を試み、失敗時は自動再試行またはユーザーに再試行可否を問い合わせます。
 *
 * @param previousApiReqIndex 前回のAPIリクエストのインデックス
 */
export async function* attemptApiRequest(
  previousApiReqIndex: number
): AsyncGenerator<any, void, unknown> {
  const state = globalStateManager.state;
  const apiHandler = buildApiHandler(apiStateManager.getState());

  // システムプロンプト構築
  const systemPrompt = await buildSystemPrompt();

  // 履歴トリミングの必要があれば実施
  await trimHistoryIfNeeded(previousApiReqIndex);

  // トリミング済みの会話履歴を取得
  const truncatedHistory = getTruncatedMessages(
    state.apiConversationHistory,
    state.conversationHistoryDeletedRange
  );

  // ストリーム生成
  const stream = apiHandler.createMessage(systemPrompt, truncatedHistory);
  const iterator = stream[Symbol.asyncIterator]();

  // 最初のチャンク取得（失敗時は再試行またはユーザー問い合わせ）
  try {
    state.isWaitingForFirstChunk = true;
    const firstChunk = await iterator.next();
    yield firstChunk.value;
    state.isWaitingForFirstChunk = false;
  } catch (error) {
    const isOpenRouter = apiStateManager.getState() instanceof OpenRouterHandler;
    if (isOpenRouter && !state.didAutomaticallyRetryFailedApiRequest) {
      await delay(1000);
      state.didAutomaticallyRetryFailedApiRequest = true;
    } else {
      const { response } = await ask(
        Ask.API_REQ_FAILED,
        error.message ?? JSON.stringify(serializeError(error), null, 2)
      );
      if (response !== "yesButtonClicked") {
        throw new Error("API request failed");
      }
      await say(Say.API_REQ_RETRIED);
    }
    yield* attemptApiRequest(previousApiReqIndex);
    return;
  }

  // 最初のチャンク受信後、残りのチャンクを順次出力
  for await (const chunk of iterator) {
    console.log("[attemptApiRequest] 次のチャンク", chunk);
    yield chunk;
  }
}

/**
 * 会話履歴トリミング用の次の削除範囲を計算する関数。
 * 常に最初のメッセージ (index=0) は保持し、ユーザー・アシスタントペアを保ったまま削減します。
 *
 * @param messages 全会話メッセージ
 * @param currentDeletedRange これまでに削除した範囲（任意）
 * @param keep "half" なら半分、"quarter" なら4分の1だけ残す
 * @returns [start, end] の削除範囲
 */
export function getNextTruncationRange(
  messages: Anthropic.Messages.MessageParam[],
  currentDeletedRange: [number, number] | undefined = undefined,
  keep: "half" | "quarter" = "half"
): [number, number] {
  // 最初のメッセージは必ず保持するため、削除は index 1 から開始
  const rangeStart = 1;
  const startIndex = currentDeletedRange ? currentDeletedRange[1] + 1 : rangeStart;

  // 削除すべきメッセージ数を算出
  let messagesToRemove: number;
  if (keep === "half") {
    messagesToRemove = Math.floor((messages.length - startIndex) / 4) * 2;
  } else {
    messagesToRemove = Math.floor((messages.length - startIndex) / 8) * 3 * 2;
  }

  // 終了インデックスの計算
  let rangeEnd = startIndex + messagesToRemove - 1;

  // ユーザーとアシスタントのペア構造を保つため、最後がユーザーのメッセージになるよう調整
  if (messages[rangeEnd]?.role !== "user") {
    rangeEnd -= 1;
  }
  return [rangeStart, rangeEnd];
}
