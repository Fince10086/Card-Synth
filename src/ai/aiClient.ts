/**
 * 仅通过环境变量读取配置
 */

function getEnvVar(key: string, fallback: string): string {
  const value = import.meta.env[key];
  return value && value !== "your_api_key_here" ? value : fallback;
}

function getApiKey(): string | null {
  const envKey = import.meta.env.VITE_API_KEY;
  if (envKey && envKey !== "your_api_key_here") {
    return envKey;
  }
  return null;
}

export async function callAI(
  prompt: string,
  userDescription: string,
  onReasoning?: (reasoning: string) => void,
  onContentStart?: () => void
): Promise<string> {
  const apiKey = getApiKey();
  if (!apiKey) {
    throw new Error("NO_API_KEY");
  }

  const baseUrl = getEnvVar("VITE_BASE_URL", "https://api.deepseek.com/chat/completions");
  const model = getEnvVar("VITE_MODEL", "deepseek-chat");

  const response = await fetch(`${baseUrl}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
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
