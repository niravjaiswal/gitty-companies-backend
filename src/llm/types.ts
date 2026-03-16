export interface LlmMessage {
  role: "user" | "assistant";
  content: string;
}

export interface LlmCallConfig {
  model: string;
  maxTokens: number;
  system: string;
  messages: LlmMessage[];
  temperature?: number;
}

export interface LlmCallResult {
  content: string;
  inputTokens: number;
  outputTokens: number;
  model: string;
  stopReason: string;
}
