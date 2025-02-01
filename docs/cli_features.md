# Cline CLI Application Features

This document summarizes the features of the Cline CLI application, based on the implementation plan and source code descriptions.

## Core Features

- **Chat Session with Gemini:**
    - Start interactive chat sessions with the Gemini AI model.
    - Specify Gemini model to use via command-line option (`--model`).
    - Provide context to the chat session from files or directories using the `--context` option.
    - Interactive chat loop with user input from stdin and styled Gemini response output to console.
    - Basic error handling and logging for Gemini API interactions.

- **Code File Editing Commands:**
    - **Write File:** Create new files or overwrite existing files with specified content using the `cline code --write <path> --content <content>` command.
    - **Replace Content in File:** Replace the first occurrence of a specific text in a file using the `cline code --replace <path> --search <search_content> --replace_content <replace_content>` command.

## Planned Future Features (from Implementation Plan)

- **Support for Multiple AI Providers:**
    - Extend chat sessions to support other AI providers beyond Gemini (e.g., OpenAI, Anthropic, Bedrock, Vertex, etc.).
    - Implement `--provider` option to select AI provider.
    - Support provider-specific configurations.

- **Enhanced `code` Command Functionality:**
    - Implement `cline code --generate <language>` for code generation.
    - Implement `cline code --refactor <file>` for code refactoring.
    - Implement `cline diff` command to display diffs of code changes.

- **Configuration Management:**
    - Implement configuration files (e.g., `cline.config.json`) to store settings like API keys, default models, and other preferences.

- **Improved Error Handling and Logging:**
    - Provide more detailed error messages and logging, including logging to files and different log levels.

- **Advanced Chat Features:**
    - Implement API conversation history saving and loading.
    - Support system prompts for chat sessions.

- **Integration with VS Code Features (Future):**
    - MCP support for tool execution (potentially to integrate with VS Code extension tools).
    - Explore other potential integrations with VS Code functionalities.

## Note

This document is a summary of planned and currently implemented features. For detailed implementation steps and technical details, please refer to the implementation plan document (`docs/implementation_plan.md`).
