// cli-src/core/FileEditStepExecutor.ts
import { StepExecutor } from './StepExecutor';
import { Step } from '../types';
import * as fsTool from '../tools/fs';

export class FileEditStepExecutor implements StepExecutor {
  async executeStep(step: Step): Promise<void> {
    if (step.type === 'writeFile') {
      await this.handleWriteFileStep(step);
    } else if (step.type === 'replaceInFile') {
      await this.handleReplaceInFileStep(step);
    } else {
      console.log(`FileEditStepExecutor: Step type "${step.type}" not supported.`);
    }
  }

  private async handleWriteFileStep(step: any): Promise<void> {
    console.log(`FileEditStepExecutor: Executing writeFile step - ${step.description}`);
    try {
      await fsTool.writeFile(step.path, step.content);
    } catch (error) {
      console.error('File write error:', error);
      throw error;
    }
  }

  private async handleReplaceInFileStep(step: any): Promise<void> {
    console.log(`FileEditStepExecutor: Executing replaceInFile step - ${step.description}`);
    try {
      await fsTool.replaceInFile(step.path, step.diff);
    } catch (error) {
      console.error('File replace error:', error);
      throw error;
    }
  }
}
