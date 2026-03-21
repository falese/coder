export interface GenerateOptions {
  model: string; // absolute path to MLX model directory
  prompt: string;
  maxTokens?: number; // default 512
  dryRun?: boolean; // used by integration tests via CODER_DRY_RUN=1 env var
}

export interface GenerateResult {
  generatedText: string;
  tokensPerSecond?: number; // undefined if stats line absent
}
