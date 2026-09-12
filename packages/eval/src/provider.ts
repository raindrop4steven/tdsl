/**
 * OpenAI 兼容 chat 调用（C4）：复用 server 同款 env 变量——
 *   TDSL_LLM_BASE_URL / TDSL_LLM_MODEL / TDSL_LLM_API_KEY / TDSL_LLM_COMPAT(JSON)
 * 直发 fetch（不经过 pi SDK），带 GLM 网关超时/重试（5min×5，口径与 M10 一致）。
 */
const TIMEOUT_MS = 5 * 60 * 1000;
const RETRIES = 5;

export interface LlmConfig { baseUrl: string; model: string; apiKey: string; compat?: Record<string, unknown> }

export function llmConfigFromEnv(env: NodeJS.ProcessEnv = process.env): LlmConfig {
  const baseUrl = env.TDSL_LLM_BASE_URL;
  const model = env.TDSL_LLM_MODEL;
  if (!baseUrl || !model) throw new Error('评测需要 TDSL_LLM_BASE_URL/TDSL_LLM_MODEL（与 start-server.sh 同源）');
  return {
    baseUrl,
    model,
    apiKey: env.TDSL_LLM_API_KEY ?? 'placeholder',
    compat: parseCompat(env.TDSL_LLM_COMPAT),
  };
}

function parseCompat(raw: string | undefined): Record<string, unknown> | undefined {
  if (!raw) return undefined;
  try { return JSON.parse(raw) as Record<string, unknown>; } catch { return undefined; }
}

/** 从 LLM 输出中剥出 TDSL 代码（容忍 ```fence 与前后闲话） */
export function stripCodeBlock(text: string): string {
  const m = /```(?:tdsl|ts)?\s*\n([\s\S]*?)```/.exec(text);
  if (m) return m[1].trim();
  // 没有 fence：截取出现实体/application 声明起的整段（保底）
  return text.trim();
}

/** OpenCode Go 网关要求会话路由头（M10 踩坑）——每次跑批固定一个 sessionId */
const SESSION_ID = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;

export async function chatOnce(cfg: LlmConfig, prompt: string): Promise<string> {
  const body: Record<string, unknown> = {
    model: cfg.model,
    messages: [{ role: 'user', content: prompt }],
    temperature: 0.2,
  };
  if (cfg.compat && cfg.compat['maxTokensField'] === 'max_tokens') {
    body['max_tokens'] = 8000;
  } else {
    body['max_output_tokens'] = 8000;
  }
  let lastErr: unknown = null;
  for (let i = 0; i < RETRIES; i++) {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), TIMEOUT_MS);
    try {
      const r = await fetch(`${cfg.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${cfg.apiKey}`,
          'x-opencode-session': SESSION_ID,
        },
        body: JSON.stringify(body),
        signal: ctl.signal,
      });
      if (!r.ok) throw new Error(`HTTP ${r.status} ${await r.text().then((t) => t.slice(0, 200))}`);
      const json = (await r.json()) as { choices?: Array<{ message?: { content?: string } }> };
      const text = json.choices?.[0]?.message?.content ?? '';
      return text;
    } catch (e) {
      lastErr = e;
      // 指数回退 2^n 秒
      await new Promise((res) => setTimeout(res, 2 ** i * 1000));
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error('LLM 调用失败（重试耗尽）');
}
