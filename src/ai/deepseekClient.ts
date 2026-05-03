/**
 * DeepSeek API 客户端
 * 仅通过环境变量读取 API Key
 */

const DEEPSEEK_BASE_URL = "https://api.deepseek.com";
const DEEPSEEK_MODEL = "deepseek-v4-flash";

function getApiKey(): string | null {
  const envKey = import.meta.env.VITE_DEEPSEEK_API_KEY;
  if (envKey && envKey !== "your_api_key_here") {
    return envKey;
  }
  return null;
}

export async function callDeepSeek(
  prompt: string,
  userDescription: string,
  onReasoning?: (reasoning: string) => void,
  onContentStart?: () => void
): Promise<string> {
  const apiKey = getApiKey();
  if (!apiKey) {
    throw new Error("NO_API_KEY");
  }

  const response = await fetch(`${DEEPSEEK_BASE_URL}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: DEEPSEEK_MODEL,
      messages: [
        {
          role: "system",
          content: prompt,
        },
        {
          role: "user",
          content: userDescription,
        },
      ],
      stream: true,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`API 请求失败 (${response.status}): ${errorText}`);
  }

  const reader = response.body?.getReader();
  if (!reader) {
    throw new Error("无法读取响应流");
  }

  let fullContent = "";
  let fullReasoning = "";
  let hasContentStarted = false;
  const decoder = new TextDecoder();

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    const chunk = decoder.decode(value, { stream: true });
    const lines = chunk.split("\n").filter((line) => line.trim().startsWith("data: "));

    for (const line of lines) {
      const dataStr = line.slice(6).trim();
      if (dataStr === "[DONE]") continue;

      try {
        const data = JSON.parse(dataStr);
        const delta = data.choices?.[0]?.delta;
        if (delta?.reasoning_content) {
          fullReasoning += delta.reasoning_content;
          onReasoning?.(fullReasoning);
        }
        if (delta?.content) {
          if (!hasContentStarted) {
            hasContentStarted = true;
            onContentStart?.();
          }
          fullContent += delta.content;
        }
      } catch {
        // 忽略解析失败的行
      }
    }
  }

  return fullContent;
}
