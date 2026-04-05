import { z } from "zod";

export interface JsonlRecord {
  prompt: string;
  completion: string;
}

export const ExtractRuleSchema = z.object({
  prompt: z.enum(["jsdoc", "line_comment", "ts_declare", "react_component"]),
  completion: z.enum(["next_function", "next_block", "declare_body", "constructor_call"]),
});

export const ExtractConfigSchema = z.object({
  rules: z.array(ExtractRuleSchema).min(1),
});

export type ExtractRule = z.infer<typeof ExtractRuleSchema>;
export type ExtractConfig = z.infer<typeof ExtractConfigSchema>;
