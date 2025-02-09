import { DataSource, Entity, PrimaryGeneratedColumn, Column, Check } from "typeorm";
import { globalStateManager } from './globalState.js';
import path from 'path';
import 'reflect-metadata';

export enum MessageType {
    ASK = 'ask',
    SAY = 'say',
  }

export enum Say {
    TASK = 'task',
    ERROR = 'error',
    API_REQ_STARTED = 'api_req_started',
    API_REQ_FINISHED = 'api_req_finished',
    TEXT = 'text',
    COMPLETION_RESULT = 'completion_result',
    USER_FEEDBACK = 'user_feedback',
    USER_FEEDBACK_DIFF = 'user_feedback_diff',
    API_REQ_RETRIED = 'api_req_retried',
    COMMAND = 'command',
    COMMAND_OUTPUT = 'command_output',
    TOOL = 'tool',
    SHELL_INTEGRATION_WARNING = 'shell_integration_warning',
    BROWSER_ACTION_LAUNCH = 'browser_action_launch',
    BROWSER_ACTION = 'browser_action',
    BROWSER_ACTION_RESULT = 'browser_action_result',
    MCP_SERVER_REQUEST_STARTED = 'mcp_server_request_started',
    MCP_SERVER_RESPONSE = 'mcp_server_response',
    USE_MCP_SERVER = 'use_mcp_server',
    DIFF_ERROR = 'diff_error',
    DELETED_API_REQS = 'deleted_api_reqs',
}

export enum Ask {
    FOLLOWUP = 'followup',
    PLAN_MODE_RESPONSE = 'plan_mode_response',
    COMMAND = 'command',
    COMMAND_OUTPUT = 'command_output',
    COMPLETION_RESULT = 'completion_result',
    TOOL = 'tool',
    API_REQ_FAILED = 'api_req_failed',
    RESUME_TASK = 'resume_task',
    RESUME_COMPLETED_TASK = 'resume_completed_task',
    MISTAKE_LIMIT_REACHED = 'mistake_limit_reached',
    AUTO_APPROVAL_MAX_REQ_REACHED = 'auto_approval_max_req_reached',
    BROWSER_ACTION_LAUNCH = 'browser_action_launch',
    USE_MCP_SERVER = 'use_mcp_server',
}

@Entity()
@Check(`type IN ('ask', 'say')`)
export class ClineMessage {
    @PrimaryGeneratedColumn()
    id!: number;

    @Column()
    taskId!: string;

    @Column()
    ts!: number;

    // "ask" or "say"
    @Column()
    type!: MessageType;

    @Column({ nullable: true })
    ask!: Ask

    @Column({ nullable: true })
    say!: Say

    @Column({ nullable: true })
    text!: string;

    @Column({ nullable: true })
    images!: string;

    @Column({ nullable: true })
    partial!: boolean;

    @Column({ nullable: true })
    conversationHistoryIndex!: number

    @Column({ nullable: true })
    conversationHistoryDeletedRangeStart!: number

    @Column({ nullable: true })
    conversationHistoryDeletedRangeEnd!: number
}

export let AppDataSource: DataSource;

export const initDB = async () => {
    const state = globalStateManager.state;
    if (!state.workspaceFolder) {
        throw new Error('workspaceFolder is not set');
    }
    const dbPath = path.join(state.workspaceFolder, 'database.sqlite');

    AppDataSource = new DataSource({
        type: "sqlite",
        database: dbPath,
        entities: [ClineMessage],
        synchronize: true,
        logging: false,
    });

    await AppDataSource.initialize()
        .then(() => {
            console.log("Data Source has been initialized!")
        })
        .catch((err) => {
            console.error("Error during Data Source initialization:", err)
        })
}
