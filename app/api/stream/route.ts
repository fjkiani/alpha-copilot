import { NextRequest } from 'next/server';
import { AGENT_CONFIGS, AgentId } from '@/lib/agentConfigs';

export const runtime = 'edge';

export async function POST(req: NextRequest) {
  let body: {
    agent: AgentId;
    transcript: string;
    mode: string;
    problem_context: string;
    turn_history: Array<{ role: string; content: string }>;
  };

  try {
    body = await req.json();
  } catch {
    return new Response('Invalid JSON', { status: 400 });
  }

  const { agent, transcript, mode, problem_context, turn_history } = body;

  const config = AGENT_CONFIGS[agent];
  if (!config) {
    return new Response(`Unknown agent: ${agent}`, { status: 400 });
  }

  const messages = [
    { role: 'system', content: config.system },
    ...(turn_history ?? []).slice(-5),
    {
      role: 'user',
      content: `[MODE]: ${mode}\n[ACTIVE PROBLEM]: ${problem_context ?? ''}\n[LIVE TRANSCRIPT]: ${transcript}`,
    },
  ];

  const requestBody: Record<string, unknown> = {
    model: config.model,
    messages,
    max_tokens: config.max_tokens,
    temperature: config.temperature,
    stream: true,
  };

  // Only add reasoning for agents that need it (rescue mode)
  if (config.reasoning) {
    requestBody.reasoning = config.reasoning;
  }

  let upstream: Response;
  try {
    upstream = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.OPENROUTER_API_KEY}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000',
        'X-Title': 'Alpha Copilot',
      },
      body: JSON.stringify(requestBody),
    });
  } catch (err) {
    console.error('[stream] OpenRouter fetch failed:', err);
    return new Response('OpenRouter unreachable', { status: 502 });
  }

  // Pre-stream errors (401, 402, 429, 503) come back as non-200 before any tokens
  if (!upstream.ok) {
    const errText = await upstream.text();
    console.error('[stream] OpenRouter pre-stream error:', upstream.status, errText);

    // 429 on free model → tell client to retry with paid fallback
    if (upstream.status === 429) {
      return new Response(
        JSON.stringify({ error: 'rate_limited', fallback: 'qwen/qwen-plus-2025-07-28' }),
        { status: 429, headers: { 'Content-Type': 'application/json' } }
      );
    }

    return new Response(`OpenRouter error: ${upstream.status}`, { status: 502 });
  }

  const encoder = new TextEncoder();

  const outputStream = new ReadableStream({
    async start(controller) {
      const reader = upstream.body!.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      const send = (obj: Record<string, unknown>) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(obj)}\n\n`));
      };

      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });

          // Process all complete lines in buffer
          while (true) {
            const lineEnd = buffer.indexOf('\n');
            if (lineEnd === -1) break;

            const line = buffer.slice(0, lineEnd).trim();
            buffer = buffer.slice(lineEnd + 1);

            // Skip OpenRouter keepalive comments (": OPENROUTER PROCESSING")
            if (line.startsWith(':') || line === '') continue;

            if (!line.startsWith('data: ')) continue;

            const data = line.slice(6);
            if (data === '[DONE]') {
              send({ type: 'done' });
              controller.close();
              return;
            }

            let parsed: Record<string, unknown>;
            try {
              parsed = JSON.parse(data);
            } catch {
              continue; // malformed chunk, skip
            }

            // Mid-stream error from OpenRouter
            if (parsed.error) {
              const errMsg = (parsed.error as { message?: string })?.message ?? 'Unknown stream error';
              console.error('[stream] Mid-stream error:', errMsg);
              send({ type: 'error', message: errMsg });
              controller.close();
              return;
            }

            // Skip reasoning_details chunks (thinking tokens) — not shown to user
            const delta = (parsed.choices as Array<{ delta: Record<string, unknown> }>)?.[0]?.delta;
            if (!delta) continue;
            if (delta.reasoning_details) continue; // thinking tokens, skip

            const content = delta.content as string | undefined;
            if (content) {
              send({ type: 'chunk', content });
            }
          }
        }
      } catch (err) {
        console.error('[stream] Stream read error:', err);
        send({ type: 'error', message: 'Stream interrupted' });
        controller.close();
      } finally {
        reader.cancel();
      }
    },
  });

  return new Response(outputStream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
}
