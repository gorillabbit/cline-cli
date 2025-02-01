// cli-src/core/TaskRunner.ts

import { Step } from '../types';
import { StepExecutor, DefaultStepExecutor } from './StepExecutor';
import { FileEditStepExecutor } from './FileEditStepExecutor';

export class TaskRunner {
  private stepExecutor: StepExecutor;

  constructor() {
    this.stepExecutor = new DefaultStepExecutor(); // Default executor
  }

  registerStepExecutor(stepType: string, executor: StepExecutor) {
    // Allows registering custom step executors if needed
  }

  async runTask(taskDescription: string): Promise<void> {
    console.log('Task Description:', taskDescription);
    console.log('Starting task execution...\n');

    // Example steps 
    const steps: Step[] = [
      { type: 'instruction', description: 'Initial instruction step' },
      { type: 'writeFile', description: 'Create a file', path: 'example.txt', content: 'Hello, CLI!' },
      { type: 'replaceInFile', description: 'Replace in file', path: 'example.txt', diff: '<<<<<<< SEARCH\nHello, CLI!\n=======\nHello, World!\n>>>>>>> REPLACE' },
      // ... more steps based on actual task decomposition
    ];

    for (const step of steps) {
      console.log(`Executing step: ${step.type} - ${step.description}`);
      try {
        if (step.type === 'writeFile' || step.type === 'replaceInFile') {
          const fileEditExecutor = new FileEditStepExecutor();
          await fileEditExecutor.executeStep(step);
        }
         else {
          await this.stepExecutor.executeStep(step);
        }
        console.log(`Step "${step.description}" completed.\n`);
      } catch (error) {
        console.error(`Step "${step.description}" failed:`, error);
        console.log('Task execution halted due to error.\n');
        return; // Stop task execution on error
      }
      // TODO: Implement user interaction/approval if needed
    }

    console.log('Task execution completed successfully.\n');
  }
}
