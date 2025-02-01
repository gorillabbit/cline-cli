# CLI Application Implementation Plan for VS Code Extension (CLI-Only, Gemini First)

## Goal
To create a CLI application that provides similar functionalities as the VS Code extension, but implemented independently in the `cli-src` directory, without reusing code from the `src` directory. Initially, only Gemini AI provider will be supported.

## Implementation Approach
Create a new directory `cli-src` and implement the CLI application there from scratch.  Do not directly reuse any existing code from the `src` directory, but use the `src` directory as a reference to understand the functionalities and implementation details. The CLI application will be designed to operate independently and will initially focus on Gemini AI provider integration.

## CLI Application Structure
- `cli-src/cli.ts`: Main entry point for the CLI application. Handles command-line arguments, command routing, and overall application flow.
- `cli-src/commands/`: Directory to organize different commands of the CLI application. Each command will be in its own file.
    - `cli-src/commands/chat.ts`: Command for initiating a chat session. Handles chat-specific logic, argument parsing for chat commands, and interaction with Gemini AI provider.  (Reference: `src/extension.ts`, `src/core/webview/ClineProvider.ts` for chat session initiation and message handling logic)
    - `cli-src/commands/code.ts`: Command for code-related functionalities (e.g., code generation, refactoring).  Handles code-specific logic, argument parsing for code commands, and code manipulation functionalities (initially may not be implemented). (Reference: `src/extension.ts`, `src/core/webview/ClineProvider.ts` for code related command handling)
    - `cli-src/providers/`: Directory to handle AI provider integrations.
        - `cli-src/providers/gemini.ts`:  Specific implementation for Gemini AI provider, including API interactions and response handling. (Reference: `src/api/providers/gemini.ts`, `src/api/index.ts` for Gemini API interaction and request/response formats)
    - ... (other commands/providers as needed):  As the CLI application expands, new command files and provider integrations will be added.

## CLI Commands and Options (Detailed, Gemini Focus)
- `cline chat`: Start an interactive chat session.
    - **Detailed Options:**
        - `--model <model>` or `-m <model>`: Specify the Gemini model to use. Examples: `gemini-pro`, `gemini-ultra`. If not provided, a default Gemini model (`gemini-pro`) will be used. (Reference: `src/shared/ChatSettings.ts` for model options and default model)
        - `--context <path>` or `-c <path>`: Provide context to the chat session from a specified file or directory. The CLI will read the contents of the file or files in the directory and include them as context in the chat. (Reference: `src/core/Cline.ts` for context handling logic)
- `cline code`: Perform code-related operations, including file editing.
    - **Detailed Options:**
        - `--generate <language>`: Generate code in a specific programming language.  The user will also need to provide a prompt or instructions for the code generation. (Future implementation)
        - `--refactor <file>`: Refactor the code in a specified file. The user will need to provide instructions or specify the type of refactoring to perform. (Future implementation)
        - `--write <path> --content <content>`: Write the given content to a new file at the specified path. Overwrites existing files.
        - `--replace <path> --search <search_content> --replace_content <replace_content>`: Replace the first occurrence of `search_content` with `replace_content` in the file at the specified path.

## User Input and Output (Detailed)
- **Input:**
    - Command-line arguments:  Primary method for providing input to the CLI application. Use `commander` library for parsing. (Reference: `cli-src/cli.ts` and `commander` documentation)
    - Standard Input (stdin): For interactive commands like `chat`, the user can provide chat messages via stdin. (Reference: Node.js `process.stdin`)
- **Output:**
    - Console Output (stdout):  Primary method for displaying output to the user.
        - Plain text output for chat responses, code generation results, and command execution feedback.
        - Use `chalk` for colored output to improve readability. (Reference: `chalk` library documentation)
    - Standard Error (stderr): For displaying error messages and debugging information. (Reference: Node.js `console.error`)

## Error Handling and Logging (Detailed)
- **Error Handling:**
    - Implement try-catch blocks to handle exceptions in command handlers and API calls. (Reference: standard JavaScript try-catch)
    - Provide informative error messages to the user, including error type and possible solutions.
    - Differentiate between user errors (e.g., invalid arguments) and system errors (e.g., API connection issues, Gemini API errors).
- **Logging:**
    - Use `console.log` for basic logging of command execution, API requests/responses, and errors.
    - Log application events, errors, API requests, and debugging information.  Consider adding timestamps and log levels for better logging.

## Detailed Steps (Gemini Focus)
1. **Set up CLI project:** (Already done)
    - Ensure `cli-src` directory exists and has necessary files and dependencies (`package.json`, `tsconfig.json`, `cli.ts`, `typescript`, `ts-node`, `commander`, `@types/node`, `chalk`, `dotenv`).

2. **Implement argument parsing and command structure:** (Refine `cli.ts`, Reference: `cli-src/cli.ts` and `commander` documentation)
    - Modify `cli-src/cli.ts` to:
        - Remove `--provider` option from `chat` command.
        - Keep `--model` and `--context` options for `chat` command.
        - Update descriptions of `cline`, `chat`, and `code` commands to reflect Gemini-only focus and CLI functionality.
        - Keep basic action handlers for `chat` and `code` commands, initially logging options to console.  These action handlers will be expanded in later steps to implement command logic.

3. **Implement Gemini provider integration:** (Create `cli-src/providers/gemini.ts`, Reference: `src/api/providers/gemini.ts`, `src/api/index.ts`)
    - Create `cli-src/providers` directory.
    - Create `cli-src/providers/gemini.ts`.
    - In `gemini.ts`, implement basic Gemini API interaction:
        - **`initGeminiClient(apiKey: string)` function:**  Initialize Gemini API client using API key from environment variables.
        - **`sendChatMessage(client: GeminiAPIClient, model: string, message: string, context?: string)` function:** Send chat message to Gemini API and return response.

4. **Implement core `chat` command logic (Gemini):** (Modify `cli-src/commands/chat.ts`, Reference: `src/extension.ts`, `src/core/webview/ClineProvider.ts`)
    - Create `cli-src/commands` directory if it doesn't exist.
    - Create `cli-src/commands/chat.ts`.
    - In `chat.ts`, implement the logic for the `chat` command:
        - Import Gemini provider functions from `cli-src/providers/gemini.ts`.
        - In the `chat` command action handler:
            - Parse `--model` and `--context` options using `commander`.
            - Get user chat message from stdin using `process.stdin`.
            - Call `initGeminiClient()` to initialize the Gemini API client.
            - Call `sendChatMessage()` to send the user message to Gemini API and get the response.
            - Display Gemini response to the console using `console.log` and style it using `chalk`.

5. **Implement user input/output for `chat` command (Gemini):** (Refine `cli-src/commands/chat.ts`, Reference: `src/core/Cline.ts`, Node.js `process.stdin`, `process.stdout`)
    - Refine `cli-src/commands/chat.ts` to:
        - **Context Loading:** Implement context loading from file/directory.
        - **Interactive Chat Loop:** Implement interactive chat loop using `readline` to prompt user for messages and display responses.

6. **Implement error handling and basic logging (Gemini):** (Modify `cli-src/providers/gemini.ts` and `cli-src/commands/chat.ts`, Reference: standard JavaScript try-catch, Node.js `console.error`, `console.log`)
    - Add error handling for Gemini API calls and context loading.
    - Implement basic logging using `console.log` and `console.error`.

7. **Test and refine (Gemini):** (Run CLI and test, Reference: testing best practices)
    - Build and run CLI, test `chat` command with Gemini, refine chat flow and response display.

8. **Implement basic `code` command logic:** (Placeholder for now, Modify `cli-src/commands/code.ts`)
    - `code` command can be a placeholder.

9. **Document CLI usage (Gemini focused):** 
    - Update `README.md` in `cli-src` to document the `cline chat` command, including:
        - Installation and setup instructions (Node.js, npm, Gemini API key in `.env`).
        - Command syntax and options (`--model`, `--context`).
        - Usage examples.

## Future Considerations
- Add support for more AI providers (e.g., OpenAI, Anthropic, Bedrock, Vertex, etc.).
    - Implement `--provider` option to `cline chat`.
    - Create provider-specific modules in `cli-src/providers/`.
    - Implement configuration to select and configure different providers.
- Implement full functionality for `code` command (code generation, refactoring, code explanation etc.).
- Implement more comprehensive configuration management (e.g., `cline.config.json` for storing settings).
- Improve error handling and logging (e.g., more detailed error messages, logging to files, log levels).
- Implement API conversation history saving and loading.
- Implement system prompts.
- Implement Diff View for code changes.
- Implement MCP support for tool execution.
- Package and distribute the CLI application as a standalone executable or npm package.
