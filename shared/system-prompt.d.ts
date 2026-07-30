export type PromptProfile = {
  name?: string;
  age?: number;
  personality?: string;
  relation?: string;
};

export const DEFAULT_SYSTEM_PROMPT: string;
export function renderSystemPrompt(template: string, profile?: PromptProfile): string;

