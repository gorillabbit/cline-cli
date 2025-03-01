import { Octokit } from "@octokit/rest"
import { throttling } from "@octokit/plugin-throttling"
import { retry } from "@octokit/plugin-retry"
import * as dotenv from "dotenv"

dotenv.config() // Load environment variables from .env file

// Octokit.js
// https://github.com/octokit/core.js
const MyOctokit = Octokit.plugin(throttling, retry)

const auth = process.env.GITHUB_TOKEN
const owner = process.env.GITHUB_OWNER
const repo = process.env.GITHUB_REPO

if (!auth || !owner || !repo) {
	console.error("GITHUB_TOKEN, GITHUB_OWNER, and GITHUB_REPO must be set in the environment.")
	process.exit(1)
}

const octokit = new MyOctokit({
	auth,
	throttle: {
		onRateLimit: (retryAfter) => {
			console.warn(`Request quota exhausted! Retrying after ${retryAfter} seconds`)
			return true
		},
		onSecondaryRateLimit: (retryAfter) => {
			console.warn(`Secondary rate limit detected! Retrying after ${retryAfter} seconds`)
			return true
		},
	},
	retry: {
		doNotRetry: ["400", "401", "403", "404", "422"],
	},
})

/**
 * Edits an issue on GitHub.  Replaces the entire issue body.
 * @param issue_number The issue number to edit.
 * @param newContent The complete, new content to replace the issue body with.
 * @returns True on success, false on failure.  Throws an error with details on API errors.
 */
export const editGitHubIssue = async (issue_number: number, newContent: string): Promise<boolean> => {
	if (!auth || !owner || !repo) {
		console.error("GITHUB_TOKEN, GITHUB_OWNER, and GITHUB_REPO must be set in the environment.")
		return false
	}
	try {
		const response = await octokit.rest.issues.update({
			owner,
			repo,
			issue_number,
			body: newContent,
		})

		if (response.status === 200) {
			return true
		} else {
			console.error(`Failed to update issue ${issue_number}. Status code: ${response.status}`)
			return false
		}
	} catch (error) {
		console.error(`Error updating issue ${issue_number}:`, error)
		throw new Error(`GitHub API Error: ${error.message}`) // Re-throw the error for handling upstream
	}
}
