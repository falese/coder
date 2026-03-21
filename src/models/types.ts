export interface ModelConfig {
  model_type?: string;
  quantization?: {
    bits?: number;
    group_size?: number;
  };
}

export interface ModelEntry {
  name: string;
  path: string;
  modelType: string;
  quantBits: number;
  diskSizeBytes: number;
  memoryEstimateGb: number;
}
