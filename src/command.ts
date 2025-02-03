import { promisify } from "util";
import { log, logError } from "./clineUtils.js";
import { exec as execCb } from 'child_process';

const exec = promisify(execCb);

/**
 * runCommand: 指定したコマンドを実行して、標準出力を返す。
 */
export async function runCommand(cmd: string, cwd?: string): Promise<string> {
  log(`実行コマンド: ${cmd}`);
  try {
    const { stdout, stderr } = await exec(cmd, { cwd });
    if (stderr) {
      logError(`stderr: ${stderr}`);
    }
    log(`実行結果: ${stdout.trim()}`);
    return stdout.trim();
  } catch (error: any) {
    logError(`コマンド実行失敗: ${error.message}`);
    throw error;
  }
}

/**
 * isCommandSafe: コマンドの先頭単語が許可リストにあるかチェックする。
 */
function isCommandSafe(cmd: string, allowedCommands: string[]): boolean {
  const m = cmd.match(/^\s*(\S+)/);
  if (!m) {
    return false
  };
  const baseCmd = m[1];
  return allowedCommands.includes(baseCmd);
}

/**
 * executeAiCommand: AI から送られたコマンド文字列を、ホワイトリストチェック後に実行する。
 */
export async function executeAiCommand(commandStr: string, workdir?: string): Promise<void> {
  const allowedCommands = ["ls", "echo", "pwd", "git", "make", "npm", "python"];
  if (!isCommandSafe(commandStr, allowedCommands)) {
    logError(`コマンド '${commandStr}' は許可されていません。`);
    return;
  }
  await runCommand(commandStr, workdir);
}