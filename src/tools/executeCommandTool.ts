import delay from "delay"
import { ToolResponse } from "../types.js";
import { ask } from "../chat.js";
import { formatResponse } from "../prompts/responses.js";
import { say } from "../tasks.js";
import { Ask, Say } from "../database.js";
import { exec } from 'child_process';
import { promisify } from 'util';
import { error } from "console";

const execAsync = promisify(exec);

const runCommand = async (command: string) => {
  try {
    const { stdout, stderr } = await execAsync(command);

    if (stderr) {
      return { type: "error", output: stderr };
    }
    return { type: "success", output: stdout };
  } catch (error) {
    console.error(`エラーが発生しました: ${error.message}`);
    return { type: "error", output: error.message };
  }
};

/**
 * コマンドツールを実行し、コマンド出力とユーザーフィードバックを処理します。
 * @param {string} command - 実行するコマンド。
 * @returns {Promise<[boolean, ToolResponse]>} - ユーザーが拒否したフラグとツール応答を含むタプルに解決されるプロミス。
 */
export const executeCommandTool = async (command: string): Promise<[ToolResponse]> => {
    console.log("executeCommandTool started", { command }); // Log: Function execution start with command
    const { type, output } = await runCommand(command);
    await say(Say.COMMAND_OUTPUT, output);
    
    if (type === "error") {
        console.error("Command execution failed:", output);
        return [formatResponse.toolResult(output, undefined)];
    }
    
    return [formatResponse.toolResult(output, undefined)];
}
