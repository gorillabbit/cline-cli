import fs from "fs/promises"
import * as path from "path"
import { configPath } from '../const.js';
import { ClineConfig } from "../tasks.js";
import { apiStateManager } from "../apiState.js";

export async function getConfig(): Promise<ClineConfig | undefined> {
    try {
        const data = await fs.readFile(configPath, 'utf-8');
        const config: ClineConfig = JSON.parse(data);
        apiStateManager.updateState(config);
        return config;
    } catch (error) {
        console.error("Error reading config from file:", error);
        return undefined;
    }
}

export async function setConfig(input: Partial<ClineConfig>): Promise<void> {
    try {
        const currentConfig = await getConfig();
		if (!currentConfig) {
			throw new Error("No config file found");
		}
        const config: ClineConfig = {
			...currentConfig,
			...input
		};
		apiStateManager.updateState(config);
        await fs.writeFile(configPath, JSON.stringify(config, null, 2));
    } catch (error) {
        console.error("Error writing API key to config file:", error);
    }
}

/**
 * Asynchronously creates all non-existing subdirectories for a given file path
 * and collects them in an array for later deletion.
 *
 * @param filePath - The full path to a file.
 * @returns A promise that resolves to an array of newly created directories.
 */
export async function createDirectoriesForFile(filePath: string): Promise<string[]> {
	const newDirectories: string[] = []
	const normalizedFilePath = path.normalize(filePath) // Normalize path for cross-platform compatibility
	const directoryPath = path.dirname(normalizedFilePath)

	let currentPath = directoryPath
	const dirsToCreate: string[] = []

	// Traverse up the directory tree and collect missing directories
	while (!(await fileExistsAtPath(currentPath))) {
		dirsToCreate.push(currentPath)
		currentPath = path.dirname(currentPath)
	}

	// Create directories from the topmost missing one down to the target directory
	for (let i = dirsToCreate.length - 1; i >= 0; i--) {
		await fs.mkdir(dirsToCreate[i])
		newDirectories.push(dirsToCreate[i])
	}

	return newDirectories
}

/**
 * Helper function to check if a path exists.
 *
 * @param path - The path to check.
 * @returns A promise that resolves to true if the path exists, false otherwise.
 */
export async function fileExistsAtPath(filePath: string): Promise<boolean> {
	try {
		await fs.access(filePath)
		return true
	} catch {
		return false
	}
}
