import { logError } from './clineUtils.js';
import { ClineConfig, ensureTaskDirectoryExists } from './tasks.js';
import { randomUUID } from 'crypto';
import { globalStateManager } from './globalState.js';
import { ApiProvider } from './shared/api.js';
import { startTask } from './lifecycle.js';
import { initDB } from './database.js';
import { getConfig, setConfig } from './utils/fs.js';
import * as readline from 'readline';

const requireApiKey = async (config: ClineConfig, keyName: keyof ClineConfig) => {
  if (!config[keyName]) {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    try {
      const answer = await new Promise<string>((resolve) => {
        rl.question(`値が見つかりません。新しい ${keyName} を入力してください: `, resolve);
      });
      await setConfig({ [keyName]: answer });
      console.log(`新しい ${keyName} が設定されました: ${answer}`);
    } catch (err) {
      console.error('エラーが発生しました:', err);
    } finally {
      rl.close();
    }
  }
};

/**
 * main: 入力 JSON を読み込み、各修正タスクを並列に実行する。
 */
async function main() {
    // AIによる処理をCLIから実行
    const taskId = randomUUID()
    await ensureTaskDirectoryExists(taskId)
    // コマンドの引数から、指示と対象リポジトリパスを取得
    const workspaceFolder = process.argv[2]
    const instruction = process.argv[3]
    globalStateManager.state.workspaceFolder = workspaceFolder
    if (process.argv.length > 4) {
      console.log('APIプロバイダを設定します', process.argv.length)
      const apiProvider = process.argv[4]
      await setConfig({ apiProvider: apiProvider as ApiProvider })
    }

    const config = await getConfig()
    switch (config?.apiProvider) {
        case "openai":
          await requireApiKey(config, "openAiApiKey")
          break
        case "ollama":
          await requireApiKey(config, "ollamaModelId")
          break
        case "lmstudio":
          await requireApiKey(config, "lmStudioModelId")
          break
        case "openrouter":
            await requireApiKey(config, "openRouterApiKey")
            break
        case "vertex":
            await requireApiKey(config, "vertexProjectId")
            break
        case "deepseek":
            await requireApiKey(config, "deepSeekApiKey")
            break
        case "mistral":
            await requireApiKey(config, "mistralApiKey")
            break
        case "gemini":
            await requireApiKey(config, "geminiApiKey")
            break
    }
    await initDB()
    await startTask(instruction)
    process.exit(0)
}

main().catch((error) => {
    if (error instanceof Error) {
        console.error('エラーメッセージ:', error.message);
        console.error('スタックトレース:', error.stack);
      } else {
        console.error('予期しないエラー:', error);
      }
    process.exit(1)
})
