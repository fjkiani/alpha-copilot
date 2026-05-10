/**
 * lib/models.ts — Real multi-model registry
 *
 * Every agent specifies its model explicitly.
 * No shared constant. No "all agents use the same model."
 *
 * Model selection rationale:
 *   router:     qwen-plus — <500ms, pure classification, no reasoning needed
 *   preflight:  deepseek-chat-v3 — strong reasoning, runs once per session
 *   answer:     deepseek-chat-v3 — 4-6s budget, best quality/cost for main answers
 *   behavioral: deepseek-chat-v3 — STAR stories need coherent narrative reasoning
 *   code:       qwen-2.5-coder-32b — best OSS coder, purpose-built for code
 *   rescue:     deepseek-r1 — reasoning model, slow is fine (emergency use)
 *   monitor:    qwen-plus — fast, runs in parallel, low token output
 *   pivot:      qwen-plus — fast interrupt, max 50 tokens output
 *   conductor:  qwen-plus — fast classifier, runs on every turn
 */

export const MODELS = {
  router:     'qwen/qwen-plus-2025-07-28',
  preflight:  'deepseek/deepseek-chat-v3-0324',
  answer:     'deepseek/deepseek-chat-v3-0324',
  behavioral: 'deepseek/deepseek-chat-v3-0324',
  code:       'qwen/qwen-2.5-coder-32b-instruct',
  rescue:     'deepseek/deepseek-r1',
  monitor:    'qwen/qwen-plus-2025-07-28',
  pivot:      'qwen/qwen-plus-2025-07-28',
  conductor:  'qwen/qwen-plus-2025-07-28',
} as const;

export type ModelKey = keyof typeof MODELS;

// Token budgets per agent
export const MAX_TOKENS: Record<ModelKey, number> = {
  router:     80,
  preflight:  4000,
  answer:     600,
  behavioral: 600,
  code:       1200,
  rescue:     800,
  monitor:    150,
  pivot:      120,
  conductor:  200,
};

// Temperature per agent
export const TEMPERATURE: Record<ModelKey, number> = {
  router:     0.0,
  preflight:  0.3,
  answer:     0.3,
  behavioral: 0.4,
  code:       0.1,
  rescue:     0.5,
  monitor:    0.0,
  pivot:      0.2,
  conductor:  0.1,
};

// ── OpenRouter helpers ────────────────────────────────────────────────────────

function openRouterHeaders() {
  return {
    'Authorization': `Bearer ${process.env.OPENROUTER_API_KEY}`,
    'Content-Type': 'application/json',
    'HTTP-Referer': process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000',
    'X-Title': 'Alpha Copilot v2',
  };
}

// Streaming fetch — returns the raw upstream Response (body is SSE stream)
export async function openRouterStream(
  model: string,
  messages: Array<{ role: string; content: string }>,
  maxTokens: number,
  temperature: number,
  signal?: AbortSignal
): Promise<Response> {
  return fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: openRouterHeaders(),
    body: JSON.stringify({
      model,
      messages,
      max_tokens: maxTokens,
      temperature,
      stream: true,
    }),
    signal,
  });
}

// Non-streaming fetch — returns parsed content string
export async function openRouterJSON(
  model: string,
  messages: Array<{ role: string; content: string }>,
  maxTokens: number,
  temperature: number,
  signal?: AbortSignal
): Promise<string> {
  const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: openRouterHeaders(),
    body: JSON.stringify({
      model,
      messages,
      max_tokens: maxTokens,
      temperature,
      stream: false,
      response_format: { type: 'json_object' },
    }),
    signal,
  });
  if (!res.ok) throw new Error(`OpenRouter ${res.status}: ${await res.text()}`);
  const data = await res.json() as { choices: Array<{ message: { content: string } }> };
  return data.choices[0]?.message?.content ?? '';
}

// SSE stream builder — wraps upstream OpenRouter SSE into a proper Next.js Response
// Returns Response (not ReadableStream) so route handlers can return it directly.
export function buildSSEStream(upstream: Response): Response {
  if (!upstream.ok) {
    return new Response(
      JSON.stringify({ error: `Upstream ${upstream.status}` }),
      { status: 502, headers: { 'Content-Type': 'application/json' } }
    );
  }

  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      const reader = upstream.body!.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      const enqueue = (data: string) =>
        controller.enqueue(encoder.encode(`data: ${data}\n\n`));

      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });

          while (true) {
            const lineEnd = buffer.indexOf('\n');
            if (lineEnd === -1) break;
            const line = buffer.slice(0, lineEnd).trim();
            buffer = buffer.slice(lineEnd + 1);
            if (!line.startsWith('data: ')) continue;
            const data = line.slice(6);

            if (data === '[DONE]') {
              enqueue('[DONE]');
              controller.close();
              return;
            }

            let parsed: Record<string, unknown>;
            try { parsed = JSON.parse(data); } catch { continue; }

            if (parsed.error) {
              enqueue(JSON.stringify({ error: (parsed.error as { message?: string })?.message ?? 'Stream error' }));
              controller.close();
              return;
            }

            const choices = parsed.choices as Array<{
              delta: { content?: string; reasoning_content?: string };
              finish_reason?: string;
            }> | undefined;

            const delta = choices?.[0];
            if (!delta) continue;

            if (delta.finish_reason === 'stop' || delta.finish_reason === 'length') {
              enqueue('[DONE]');
              controller.close();
              return;
            }

            // Skip reasoning tokens (deepseek-r1 internal chain-of-thought)
            if (delta.delta?.reasoning_content) continue;

            const content = delta.delta?.content;
            if (content) {
              // Pass through as raw OpenRouter SSE format so client can parse normally
              enqueue(data);
            }
          }
        }
      } catch (err) {
        enqueue(JSON.stringify({ error: String(err) }));
        controller.close();
      } finally {
        reader.cancel().catch(() => {});
      }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    },
  });
}
