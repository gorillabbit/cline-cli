// cli-src/tools/fs.ts

import * as fs from 'fs/promises';

export async function writeFile(path: string, content: string): Promise<void> {
  try {
    await fs.writeFile(path, content);
    console.log(`File written to ${path}`);
  } catch (error: any) {
    console.error(`Error writing to file ${path}: ${error.message}`);
    throw error;
  }
}

export async function replaceInFile(path: string, diffContent: string): Promise<void> {
  try {
    let originalContent = await fs.readFile(path, 'utf8');
    let modifiedContent = originalContent;
    const blocks = diffContent.split('>>>>>>> REPLACE');
    for (const block of blocks) {
      if (!block.includes('<<<<<<< SEARCH')) {
        continue;
      }

      const searchBlock = block.substring(block.indexOf('<<<<<<< SEARCH') + '<<<<<<< SEARCH'.length, block.indexOf('=======')).trim();
      const replaceBlock = block.substring(block.indexOf('=======') + '======='.length).trim();

      modifiedContent = modifiedContent.replace(searchBlock, replaceBlock);
    }
    await fs.writeFile(path, modifiedContent);
    await new Promise(resolve => setTimeout(resolve, 100)); // Add a 100ms delay
    console.log(`File ${path} modified.`);
  } catch (error: any) {
    console.error(`Error replacing in file ${path}: ${error.message}`);
    throw error;
  }
}
