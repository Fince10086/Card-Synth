/**
 * AI 音色生成器
 * 将自然语言描述转换为 Card Synth Preset
 */

import { callAI } from "./aiClient";
import { normalizePreset } from "../preset/preset";
import type { Preset } from "../types";

// 读取 prompt 文件
async function loadPrompt(): Promise<string> {
  try {
    const response = await fetch("/src/ai/prompt.md");
    if (response.ok) {
      return await response.text();
    }
  } catch {
    // 如果 fetch 失败，使用内置默认 prompt
  }
  return getDefaultPrompt();
}

function getDefaultPrompt(): string {
  return `你是一位专业的音频合成器音色设计师。用户会用自然语言描述想要的音色，请根据描述生成对应的合成器配置。

可用模块类型及参数范围：

**Source（音源）**:
- Oscillator: type(sine/triangle/sawtooth/square), detune(-1200~1200 cents), frequencyOffset(0~2), volume(-48~6dB), pan(-1~1)
- PulseOscillator: width(0.01~0.99), detune(-1200~1200), volume(-48~6dB), pan(-1~1)
- Noise: type(white/pink/brown), playbackRate(0.1~1), volume(-48~6dB), pan(-1~1)

**Envelope（包络）**:
- Envelope: attack(0.01~4s), decay(0.01~4s), sustain(0~1), release(0.01~4s)

**Effect（效果器）**:
- Filter: type(lowpass/highpass/bandpass/notch), frequency(40~12000Hz), Q(0.001~20), rolloff(-12/-24/-48/-96)
- Chorus: frequency(0.1~12Hz), delayTime(0.5~10ms), depth(0~1), wet(0~1)
- Reverb: decay(0.3~12s), preDelay(0~0.25s), wet(0~1)
- Delay 类: delayTime, feedback(0~0.95), wet(0~1)
- Compressor: threshold(-60~0dB), ratio(1~20), attack(0.001~0.5s), release(0.01~1s)
- 以及其它效果器...

**Input（输入）**:
- Pitch: mode(midi/frequency), transpose(-12~12), octave(-4~4)
- Voices: mono(true/false)

请生成完整的 Card Synth preset JSON，严格遵循以下结构：
{
  "name": "描述性音色名称（2-20字）",
  "presetType": "current",
  "global": { "volume": -8, "octave": 4, "velocity": 0.8, "velocityEnabled": true, "polyVoice": 8 },
  "modules": [
    { "type": "Pitch", "category": "input", "enabled": true, "options": {...} },
    { "type": "Oscillator", "category": "source", "enabled": true, "volume": 0, "pan": 0, "options": {...} }
  ],
  "modulations": []
}

规则：
1. 必须包含 Pitch 输入模块
2. 至少包含一个 Source 模块
3. 参数必须在指定范围内
4. 只返回 JSON，不要任何解释文字
5. 根对象必须包含 "name" 字段，值为描述性音色名称`;
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
