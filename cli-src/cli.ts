#!/usr/bin/env node

import * as fs from 'fs/promises';

async function main() {
  const filePath = 'example.txt';
  const initialContent = 'Hello, CLI!';
  const diffContent = `<<<<<<< SEARCH
Hello, CLI!
=======
Hello, World!
>>>>>>> REPLACE`;

  try {
    // Write initial content
    await fs.writeFile(filePath, initialContent);
    console.log(`File written to ${filePath} with initial content`);

    // Replace content using replaceInFile
    await replaceInFile(filePath, diffContent);
    console.log(`File content replaced in ${filePath}`);


    // Read and print final content
    const finalContent = await fs.readFile(filePath, 'utf8');
    console.log(`File content read from ${filePath} after replace:`);
    console.log(finalContent);

    console.log('ReplaceInFile test completed.');

  } catch (error) {
    console.error('ReplaceInFile test failed:', error);
  }
}

async function replaceInFile(path: string, diffContent: string): Promise<void> {
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
  }
}


main().catch(console.error);
