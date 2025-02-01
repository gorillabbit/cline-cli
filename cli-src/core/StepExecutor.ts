// cli-src/core/StepExecutor.ts
import { Step } from '../types';

export interface StepExecutor {
  executeStep(step: Step): Promise<void>;
}

export class DefaultStepExecutor implements StepExecutor {
  async executeStep(step: Step): Promise<void> {
    console.log(`Default Step Executor: Executing step - ${step.type}: ${step.description}`);
    // TODO: Implement default step execution logic
  }
}
