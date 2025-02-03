import delay from "delay"
import path from "path"
import fs from "fs/promises"
import { serializeError } from "serialize-error"
import { cwd } from "process"
import { OpenRouterHandler } from "../api/providers/openrouter.js"
import { OpenAiHandler } from "../api/providers/openai.js"
import { ask } from "../chat.js"
import { getTruncatedMessages } from "../clineUtils.js"
import { GlobalFileNames } from "../const.js"
import { globalStateManager } from "../globalState.js"
import { SYSTEM_PROMPT, addUserInstructions } from "../prompts/system.js"
import { saveClineMessages, say } from "../tasks.js"
import { ClineApiReqInfo } from "../types.js"
import { fileExistsAtPath } from "../utils/fs.js"
import Anthropic from "@anthropic-ai/sdk"
import { apiStateManager } from "../apiState.js"
import { buildApiHandler } from "../api/index.js"

/**
 * OpenRouterの失敗に対して再試行するロジックを備えたAPIリクエストを試みる関数です。  
 * まず最初のチャンクを読み取り、失敗した場合は自動再試行を行い、  
 * それでも失敗した場合にはユーザーに再試行の可否を確認します。
 *
 * @param {number} previousApiReqIndex - 前回のAPIリクエストのインデックス
 * @returns {AsyncGenerator<any, void, unknown>} - ストリーミングされるAPIチャンクを返すAsyncGenerator
 */
export const attemptApiRequest = async function* (
  previousApiReqIndex: number
): AsyncGenerator<any, void, unknown> {
  console.log("[attemptApiRequest] 開始：APIリクエストを試行します。"); // ログ：関数実行開始

  // 現在のグローバルステートを取得
  const state = globalStateManager.getState();
  const apiState = apiStateManager.getState()
  const apiHandler = buildApiHandler(apiStateManager.getState())

  // システムプロンプトを構築
  let systemPrompt = await SYSTEM_PROMPT(
    cwd(),
    apiHandler.getModel().info.supportsComputerUse ?? false
  );
  console.log("[attemptApiRequest] システムプロンプトを取得しました。");

  // ユーザー固有の設定や .clinerules があれば付与
  let settingsCustomInstructions = globalStateManager.getState().customInstructions?.trim();
  const clineRulesFilePath = path.resolve(cwd(), GlobalFileNames.clineRules);
  let clineRulesFileInstructions: string | undefined;

  // .clinerulesファイルの読み込み
  if (await fileExistsAtPath(clineRulesFilePath)) {
    try {
      const ruleFileContent = (await fs.readFile(clineRulesFilePath, "utf8")).trim();
      if (ruleFileContent) {
        clineRulesFileInstructions = `# .clinerules\n\nThe following is provided by a root-level .clinerules file where the user has specified instructions for this working directory (${cwd()})\n\n${ruleFileContent}`;
        console.log("[attemptApiRequest] .clinerulesファイルの内容を取得しました。");
      }
    } catch (error) {
      console.error(`[attemptApiRequest] .clinerulesファイルの読み込みに失敗しました: ${clineRulesFilePath}`, error);
    }
  }

  // システムプロンプトへユーザー指示や.clinerulesの内容を追加
  if (settingsCustomInstructions || clineRulesFileInstructions) {
    systemPrompt += addUserInstructions(settingsCustomInstructions, clineRulesFileInstructions);
    console.log("[attemptApiRequest] システムプロンプトにユーザー指示を追加しました。");
  }

  // 前回のAPIリクエストでトークン使用量がコンテキストウィンドウに近い場合、履歴をトリミングする
  if (previousApiReqIndex >= 0) {
    const previousRequest = state.clineMessages[previousApiReqIndex];
    if (previousRequest && previousRequest.text) {
      const { tokensIn, tokensOut, cacheWrites, cacheReads }: ClineApiReqInfo = JSON.parse(previousRequest.text);
      const totalTokens = (tokensIn || 0) + (tokensOut || 0) + (cacheWrites || 0) + (cacheReads || 0);

      // モデルのコンテキストウィンドウサイズを取得
      let contextWindow = apiHandler.getModel().info.contextWindow || 128_000;
      if (
        apiHandler instanceof OpenAiHandler &&
        apiHandler.getModel().id.toLowerCase().includes("deepseek")
      ) {
        contextWindow = 64_000; // DeepSeekモデルの場合
      }

      // トリミングの閾値を計算
      let maxAllowedSize: number;
      switch (contextWindow) {
        case 64_000: // DeepSeekモデル
          maxAllowedSize = contextWindow - 27_000;
          break;
        case 128_000: // 大多数のモデル
          maxAllowedSize = contextWindow - 30_000;
          break;
        case 200_000: // Claudeモデル
          maxAllowedSize = contextWindow - 40_000;
          break;
        default:
          // デフォルトは8割を超えると大きいとみなす
          maxAllowedSize = Math.max(contextWindow - 40_000, contextWindow * 0.8);
      }

      console.log(
        `[attemptApiRequest] トークン合計: ${totalTokens} / コンテキストウィンドウ: ${contextWindow}, トリミング閾値: ${maxAllowedSize}`
      );

      // totalTokensが閾値を超えた場合、会話履歴を一部削除
      if (totalTokens >= maxAllowedSize) {
        console.log("[attemptApiRequest] コンテキストウィンドウに近づいているため、履歴をトリミングします。");
        // ユーザーが別のモデルに切り替えた場合にも対応して、半分で足りなければ4分の1だけ残すなど動的に判断
        const keep = totalTokens / 2 > maxAllowedSize ? "quarter" : "half";
        globalStateManager.updateState({
            conversationHistoryDeletedRange: getNextTruncationRange(
                globalStateManager.getState().apiConversationHistory,
                globalStateManager.getState().conversationHistoryDeletedRange,
                keep
            ),
            });
        // タスク履歴項目を保存して会話履歴の削除範囲を追跡
        await saveClineMessages();
      }
    }
  }

  // 会話履歴の削除範囲に基づいてトリミングされた履歴を取得
  const truncatedConversationHistory = getTruncatedMessages(
    globalStateManager.getState().apiConversationHistory,
    globalStateManager.getState().conversationHistoryDeletedRange
  );
  console.log("[attemptApiRequest] 履歴をトリミングしました。");

  // ストリーム生成
  let stream = apiHandler.createMessage(systemPrompt, truncatedConversationHistory);
  console.log("[attemptApiRequest] ストリームを生成しました。");
  const iterator = stream[Symbol.asyncIterator]();

  try {
    // 最初のチャンクを読み込み、エラーが発生しないかチェック
    console.log("[attemptApiRequest] 最初のチャンクを待機します。");
    globalStateManager.updateState({ isWaitingForFirstChunk: true });
    const firstChunk = await iterator.next();
    yield firstChunk.value;
    console.log("[attemptApiRequest] 最初のチャンク受信。ストリーム続行。");
    globalStateManager.updateState({ isWaitingForFirstChunk: false });
  } catch (error) {
    const isOpenRouter = apiStateManager.getState() instanceof OpenRouterHandler;
    // OpenRouterの場合、最初の失敗時に自動再試行する
    if (isOpenRouter && !state.didAutomaticallyRetryFailedApiRequest) {
      console.log("[attemptApiRequest] 最初のチャンク取得に失敗。1秒待機後に再試行します。", error);
      await delay(1000);
      globalStateManager.updateState({ didAutomaticallyRetryFailedApiRequest: true });
    } else {
      // 自動再試行も失敗した場合、ユーザーに再試行を尋ねる
      console.error("[attemptApiRequest] APIリクエストが失敗しました。ユーザーに再試行可否を確認します。", error);
      const { response } = await ask(
        "api_req_failed",
        error.message ?? JSON.stringify(serializeError(error), null, 2)
      );
      if (response !== "yesButtonClicked") {
        // noButtonClickedの場合、現在のタスクをクリアしてインスタンスを中止
        throw new Error("API request failed");
      }
      // ユーザーが再試行を選択した場合
      await say("api_req_retried");
    }
    // 再帰的に自身を呼び出し、ジェネレーターの出力を委譲
    console.log("[attemptApiRequest] 再試行を開始します。");
    yield* attemptApiRequest(previousApiReqIndex);
    return;
  }

  // 最初のチャンク成功後、残りのチャンクをストリーミング
  for await (const chunk of iterator) {
    yield chunk;
  }

  console.log("[attemptApiRequest] 完了：ストリームをすべて処理しました。"); // ログ：関数実行終了
}

/**
 * 会話履歴をトリムするための次の削除範囲([start, end] 形式)を計算する関数。
 * 
 * - 基本的に最初のメッセージ (index=0) は保持します。
 * - ユーザー-アシスタントのペアを適切に削減することで、会話構造を維持しつつトークンを節約します。
 *
 * @param {Anthropic.Messages.MessageParam[]} messages - 全ての会話メッセージ
 * @param {[number, number] | undefined} currentDeletedRange - これまでに削除した範囲（省略可）
 * @param {"half" | "quarter"} keep - 次のトリム時に半分を残すのか、4分の1だけ残すのかを指定
 * @returns {[number, number]} - 会話から削除する範囲（両端を含むインデックス）のタプル
 */
export function getNextTruncationRange(
    messages: Anthropic.Messages.MessageParam[],
    currentDeletedRange: [number, number] | undefined = undefined,
    keep: "half" | "quarter" = "half",
  ): [number, number] {
    console.log("[getNextTruncationRange] 開始：削除範囲を計算します。");
    // 常に最初のメッセージを残すため、rangeStartIndexは1とする
    // （将来的にはより賢い削除アルゴリズムに差し替える可能性あり）
    const rangeStartIndex = 1;
  
    // 今までに削除した範囲があれば、そのすぐ後ろから削除する
    const startOfRest = currentDeletedRange ? currentDeletedRange[1] + 1 : 1;
    console.log(`[getNextTruncationRange] 現在の削除済み範囲: ${currentDeletedRange}, 次に削除を開始するインデックス: ${startOfRest}`);
  
    // 削除するメッセージ数の計算
    let messagesToRemove: number;
    if (keep === "half") {
      // 会話メッセージの残りの半分をさらに削除
      // ((全メッセージ数 - 削除開始位置) / 4)の整数値に2をかける => ユーザー-アシスタントのペア数を考慮
      messagesToRemove = Math.floor((messages.length - startOfRest) / 4) * 2;
      console.log(`[getNextTruncationRange] keep=halfの場合、削除対象ペア数の計算結果: ${messagesToRemove}`);
    } else {
      // 4分の3を削除し、4分の1だけ残す
      // ((全メッセージ数 - 削除開始位置) / 8)の整数値に3*2をかける => 3ペア分削除（4つのうち3つ削除）
      messagesToRemove = Math.floor((messages.length - startOfRest) / 8) * 3 * 2;
      console.log(`[getNextTruncationRange] keep=quarterの場合、削除対象ペア数の計算結果: ${messagesToRemove}`);
    }
  
    // 削除終了インデックス（両端含む）
    let rangeEndIndex = startOfRest + messagesToRemove - 1;
    console.log(`[getNextTruncationRange] 削除予定範囲仮: [${rangeStartIndex}, ${rangeEndIndex}]`);
  
    // 最後に削除されるメッセージがユーザーのメッセージになるように調整
    // 次のメッセージ開始がアシスタントメッセージになるようにし、ユーザー-アシスタントのペア構造を保つため
    if (messages[rangeEndIndex]?.role !== "user") {
      rangeEndIndex -= 1;
      console.log(`[getNextTruncationRange] 最後の削除対象がユーザーメッセージでないため、endIndexを1つ下げました => ${rangeEndIndex}`);
    }
  
    console.log(`[getNextTruncationRange] 確定した削除範囲: [${rangeStartIndex}, ${rangeEndIndex}]`);
    return [rangeStartIndex, rangeEndIndex];
  }
  