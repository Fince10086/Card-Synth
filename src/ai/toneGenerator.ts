/**
 * AI 音色生成器
 * 将自然语言描述转换为 Card Synth Preset
 */

import { callAI } from "./aiClient";
import { normalizePreset } from "../preset/preset";
import type { Preset } from "../types";

// 读取 prompt 文件
async function loadPrompt(): Promise<string> {
  const response = await fetch("src/ai/prompt.md");
  if (!response.ok) {
    throw new Error("无法加载 prompt.md 文件");
  }
  return await response.text();
}

export interface ToneGenerationResult {
  preset: Preset;
  name: string;
}

export async function generateToneFromDescription(
  description: string,
  onReasoningUpdate?: (reasoning: string) => void,
  onContentStart?: () => void
): Promise<ToneGenerationResult> {
  const prompt = await loadPrompt();
  const content = await callAI(prompt, description, onReasoningUpdate, onContentStart);

  // 提取 JSON
  const jsonMatch = content.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    throw new Error("AI 返回的内容不包含有效的 JSON");
  }

  const parsed = JSON.parse(jsonMatch[0]);

  // 确保有 name
  const name = typeof parsed.name === "string" && parsed.name.trim()
    ? parsed.name.trim()
    : "AI Generated";

  // 使用现有的 normalizePreset 来规范化整个 preset
  const preset = normalizePreset(parsed);

  return {
    preset,
    name,
  };
}
