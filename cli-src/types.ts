// cli-src/types.ts

export interface Step {
  type: string;
  description: string;
  path?: string;
  content?: string;
  diff?: string;
  // Add other common step properties here
}
