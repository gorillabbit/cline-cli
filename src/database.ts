// src/database.ts
import sqlite3 from 'sqlite3';
import { open } from 'sqlite';
import { globalStateManager } from './globalState.js';
import path from 'path';

// データベース接続を初期化する関数
export const initDB = async () => {
  // データベースファイルのパスを指定（ファイルが存在しない場合は自動生成されます）
  const state = globalStateManager.state
  if (!state.workspaceFolder) {
    throw new Error('workspaceFolder is not set');
  }
  const dbPath = path.join(state.workspaceFolder, 'database.sqlite');
  const db = await open({
    filename: dbPath,
    driver: sqlite3.Database,
  });
  // 例: テーブルを作成
  await db.exec(`
    CREATE TABLE IF NOT EXISTS ClineMessage (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        taskId TEXT NOT NULL,
        ts DATETIME DEFAULT CURRENT_TIMESTAMP,
        type TEXT NOT NULL CHECK (type IN ('ask', 'say')),
        ask TEXT DEFAULT NULL CHECK (ask IN (
            'followup', 
            'plan_mode_response', 
            'command', 
            'command_output', 
            'completion_result', 
            'tool', 
            'api_req_failed', 
            'resume_task', 
            'resume_completed_task', 
            'mistake_limit_reached', 
            'auto_approval_max_req_reached', 
            'browser_action_launch', 
            'use_mcp_server'
        )),
        say TEXT DEFAULT NULL CHECK (say IN (
            'task', 
            'error', 
            'api_req_started', 
            'api_req_finished', 
            'text', 
            'completion_result', 
            'user_feedback', 
            'user_feedback_diff', 
            'api_req_retried', 
            'command', 
            'command_output', 
            'tool', 
            'shell_integration_warning', 
            'browser_action_launch', 
            'browser_action', 
            'browser_action_result', 
            'mcp_server_request_started', 
            'mcp_server_response', 
            'use_mcp_server', 
            'diff_error',   
            'deleted_api_reqs'
        )),
        text TEXT DEFAULT NULL,
        partial BOOLEAN DEFAULT FALSE,
        conversationHistoryIndex INTEGER DEFAULT NULL,
        conversationHistoryDeletedRangeStart INTEGER DEFAULT NULL,
        conversationHistoryDeletedRangeEnd INTEGER DEFAULT NULL
    );
  `);
  globalStateManager.state.db = db;
}
