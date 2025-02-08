import * as fs from 'fs';
import { ToolUseName } from './assistant-message';
import Anthropic from '@anthropic-ai/sdk';
import { ClineMessage } from './types.js';

// シンプルなログ関数。必要に応じて winston などのライブラリに置換可能。
export function log(message: string): void {
  const timestamp = new Date().toISOString();
  console.log(`${timestamp} [INFO] ${message}`);
  fs.appendFileSync('ai_interaction.log', `${timestamp} [INFO] ${message}\n`);
}

export function logError(message: string): void {
  const timestamp = new Date().toISOString();
  console.error(`${timestamp} [ERROR] ${message}`);
  fs.appendFileSync('ai_interaction.log', `${timestamp} [ERROR] ${message}\n`);
}

export const shouldAutoApproveTool = (toolName: ToolUseName): boolean => {
	return true
}

export function getTruncatedMessages(
	messages: Anthropic.Messages.MessageParam[],
	deletedRange: [number, number] | undefined,
): Anthropic.Messages.MessageParam[] {
	if (!deletedRange) {
		return messages
	}

	const [start, end] = deletedRange
	// the range is inclusive - both start and end indices and everything in between will be removed from the final result.
	// NOTE: if you try to console log these, don't forget that logging a reference to an array may not provide the same result as logging a slice() snapshot of that array at that exact moment. The following DOES in fact include the latest assistant message.
	return [...messages.slice(0, start), ...messages.slice(end + 1)]
}

export function combineCommandSequences(messages: ClineMessage[]): ClineMessage[] {
	const combinedCommands: ClineMessage[] = []

	// First pass: combine commands with their outputs
	for (let i = 0; i < messages.length; i++) {
		if (messages[i].ask === "command" || messages[i].say === "command") {
			let combinedText = messages[i].text || ""
			let didAddOutput = false
			let j = i + 1

			while (j < messages.length) {
				if (messages[j].ask === "command" || messages[j].say === "command") {
					// Stop if we encounter the next command
					break
				}
				if (messages[j].ask === "command_output" || messages[j].say === "command_output") {
					if (!didAddOutput) {
						// Add a newline before the first output
						combinedText += `\n${COMMAND_OUTPUT_STRING}`
						didAddOutput = true
					}
					// handle cases where we receive empty command_output (ie when extension is relinquishing control over exit command button)
					const output = messages[j].text || ""
					if (output.length > 0) {
						combinedText += "\n" + output
					}
				}
				j++
			}

			combinedCommands.push({
				...messages[i],
				text: combinedText,
			})

			i = j - 1 // Move to the index just before the next command or end of array
		}
	}

	// Second pass: remove command_outputs and replace original commands with combined ones
	return messages
		.filter((msg) => !(msg.ask === "command_output" || msg.say === "command_output"))
		.map((msg) => {
			if (msg.ask === "command" || msg.say === "command") {
				const combinedCommand = combinedCommands.find((cmd) => cmd.ts === msg.ts)
				return combinedCommand || msg
			}
			return msg
		})
}
export const COMMAND_OUTPUT_STRING = "Output:"
export const COMMAND_REQ_APP_STRING = "REQ_APP"
