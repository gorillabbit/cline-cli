import { logError } from './clineUtils.js';
import { ensureTaskDirectoryExists } from './tasks.js';
import { randomUUID } from 'crypto';
import { globalStateManager } from './globalState.js';
import { apiStateManager } from './apiState.js';
import { ApiProvider } from './shared/api.js';
import { startTask } from './lifecycle.js';
import { initDB } from './database.js';

/**
 * main: 入力 JSON を読み込み、各修正タスクを並列に実行する。
 */
async function main() {
    // AIによる処理をCLIから実行
    const taskId = randomUUID()
    // コマンドの引数から、指示と対象リポジトリパスを取得
    const workspaceFolder = process.argv[2]
    const instruction = process.argv[3]
    globalStateManager.state.workspaceFolder = workspaceFolder
    const apiProvider = (process.argv[4] ?? "openai") as ApiProvider
    const apiKey = process.argv[5]
    apiStateManager.updateState({ apiProvider, apiKey, geminiApiKey:apiKey })

    await ensureTaskDirectoryExists(taskId)
    await initDB()
    await startTask(instruction)
    process.exit(0)
}

main().catch((error) => {
    logError(`メイン処理エラー: ${error}`)
    process.exit(1)
})
