export interface GenerateOptions {
  model: string;           // absolute path to MLX model directory
  prompt: string;
  maxTokens?: number;      // default 512
  dryRun?: boolean;        // via CODER_DRY_RUN=1 env var
  adaptor?: string;        // absolute path to adaptor weights directory
  stream?: boolean;        // stream tokens as they arrive
  outputFile?: string;     // write output to file instead of stdout
  contextFiles?: string[]; // prepend these files to the prompt
  systemFile?: string;     // path to system prompt file
}

export interface GenerateResult {
  generatedText: string;
  tokensPerSecond?: number; // undefined if stats line absent
  ttftMs?: number;          // time-to-first-token in milliseconds
}
