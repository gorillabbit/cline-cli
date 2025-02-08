import * as fs from 'fs';
import * as path from 'path';
import { log, logError } from './clineUtils.js';
import { executeAiCommand, runCommand } from './command.js';
import { UserContent } from './types.js';
import { ensureTaskDirectoryExists } from './tasks.js';
import { randomUUID } from 'crypto';
import { globalStateManager } from './globalState.js';
import { apiStateManager } from './apiState.js';
import { ApiProvider } from './shared/api.js';
import { initiateTaskLoop, startTask } from './lifecycle.js';

/**
 * callAiFixCode: ダミーの AI 修正関数
 * 実際には、ここで ChatGPT 等の API を呼び出し、対象コードと指示から修正パッチを取得する。
 */
function callAiFixCode(code: string, instruction: string): string {
    const requestLog = `AI修正要求:\n【コード】\n${code}\n【指示】\n${instruction}\n`
    log(requestLog)
    // ダミーのパッチ（実際は API 応答を利用）
    const patch =
        `--- a/target_file\n` +
        `+++ b/target_file\n` +
        `@@\n-${code}\n+${code}\n` +
        `# Auto-fixed per instruction: ${instruction}\n`
    log(`AI修正応答（パッチ）:\n${patch}`)
    return patch
}

/**
 * applyPatch: 指定ディレクトリ内にパッチ内容を適用する
 */
async function applyPatch(workdir: string, patch: string): Promise<void> {
    const patchFile = path.join(workdir, "temp.patch")
    fs.writeFileSync(patchFile, patch)
    await runCommand(`patch -p1 < temp.patch`, workdir)
    fs.unlinkSync(patchFile)
    log("パッチ適用完了")
}

/**
 * processModificationWithCommand: 各修正タスクの処理を実行する
 *  - 指定ブランチ用の worktree を作成し、
 *  - 対象ファイルの内容を読み込み、AI に修正要求を送りパッチを取得、
 *  - パッチを適用、自動コミット、そして必要なら AI の実行コマンドも実行する。
 */
async function processModificationWithCommand(
    repoPath: string,
    branchName: string,
    filePath: string,
    instruction: string,
    aiCommand?: string,
): Promise<void> {
    const worktreeDir = path.join(path.dirname(repoPath), branchName)
    log(`[${branchName}] 作業ディレクトリ: ${worktreeDir}`)

    // ブランチが既に worktree にない場合は追加
    try {
        await runCommand(`git worktree add ${worktreeDir} ${branchName}`, repoPath)
    } catch (error) {
        logError(`[${branchName}] worktree 作成時のエラー: ${error}`)
        // すでに存在している場合はエラーになるため、必要に応じて無視する
    }

    // 対象ファイルの読み込み
    const targetFile = path.join(worktreeDir, filePath)
    let code: string
    try {
        code = fs.readFileSync(targetFile, "utf8")
    } catch (error) {
        logError(`[${branchName}] 対象ファイル ${filePath} の読み込みに失敗: ${error}`)
        return
    }

    // AI に修正要求してパッチを取得
    const patch = callAiFixCode(code, instruction)
    log(`[${branchName}] AIからパッチ取得完了`)

    // パッチ適用
    await applyPatch(worktreeDir, patch)

    // 自動コミット
    await runCommand("git add .", worktreeDir)
    const commitMsg = `Auto fix applied: ${instruction}`
    await runCommand(`git commit -m "${commitMsg}"`, worktreeDir)
    log(`[${branchName}] 自動コミット完了`)

    // AIから実行すべきコマンドがあれば実行
    if (aiCommand) {
        log(`[${branchName}] AI指示によるコマンド実行開始: ${aiCommand}`)
        await executeAiCommand(aiCommand, worktreeDir)
    }

    // ここで GitHub CLI 等による自動 PR 作成も追加可能
}

/**
 * main: 入力 JSON を読み込み、各修正タスクを並列に実行する。
 */
async function main() {
    // AIによる処理をCLIから実行
    const taskId = randomUUID()
    // コマンドの引数から、指示と対象リポジトリパスを取得
    const workspaceFolder = process.argv[2]
    const instruction = process.argv[3]
    console.log(`instruction: ${instruction}`)
    console.log(`repoPath: ${workspaceFolder}`)
    globalStateManager.updateState({ workspaceFolder })
    const apiProvider = (process.argv[4] ?? "openai") as ApiProvider
    const apiKey = process.argv[5]
    apiStateManager.updateState({ apiProvider, apiKey, geminiApiKey:apiKey })

    await ensureTaskDirectoryExists(taskId)
    await startTask(instruction);
    console.log("Cline requests completed")
    process.exit(0)
}

main().catch((error) => {
    logError(`メイン処理エラー: ${error}`)
    process.exit(1)
})
