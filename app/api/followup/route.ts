/**
 * POST /api/followup
 *
 * Post-session follow-up brief generator.
 * Streams a markdown debrief via SSE.
 *
 * v2: No KB injection. No resume context. Pure session history analysis.
 * Model: qwen-plus (fast, good at synthesis)
 */
export const runtime = 'edge';

const SYSTEM = `You are an expert interview debrief analyst.
Given a transcript of an interview session (interviewer questions + AI HUD coaching responses),
generate a concise post-session follow-up brief.

OUTPUT FORMAT (markdown):
## What Went Well
- 2-3 specific moments where the candidate's approach was strong

## Watch Out For
- 2-3 patterns or gaps that could hurt in future rounds

## Questions to Prepare
- 3-5 follow-up questions the interviewer is likely to ask next time, based on what was covered

## One Thing to Nail
- The single most important concept or skill to sharpen before the next round. Be specific.

RULES:
- Be specific. Reference actual questions and topics from the transcript.
- No generic advice. Every bullet must be grounded in what actually happened.
- Max 300 words total.
- No filler phrases.`;

export async function POST(request: Request) {
  try {
    const { history } = (await request.json()) as {
      history: Array<{ question: string; bullets?: string[]; rawResponse?: string }>;
    };

    if (!history || history.length === 0) {
      return Response.json({ error: 'No conversation history to analyze' }, { status: 400 });
    }

    const transcript = history
      .map((h, i) => {
        const q = h.question ?? '(unknown question)';
        const a = h.rawResponse ?? (h.bullets ?? []).join('\n') ?? '(no response)';
        return `--- Turn ${i + 1} ---\nInterviewer: ${q}\nHUD Response:\n${a}`;
      })
      .join('\n\n');

    const messages = [
      { role: 'system', content: SYSTEM },
      {
        role: 'user',
        content: `Interview transcript (${history.length} turns):\n\n${transcript}\n\nGenerate the follow-up brief now.`,
      },
    ];

    const apiKey = process.env.OPENROUTER_API_KEY;
    if (!apiKey) return Response.json({ error: 'OPENROUTER_API_KEY not configured' }, { status: 500 });

    const upstream = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000',
        'X-Title': 'Alpha Copilot',
      },
      body: JSON.stringify({
        model: 'qwen/qwen-plus-2025-07-28',
        messages,
        temperature: 0.4,
        max_tokens: 1000,
        stream: true,
      }),
    });

    if (!upstream.ok) {
      return Response.json({ error: `OpenRouter ${upstream.status}` }, { status: 502 });
    }

    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      async start(controller) {
        const reader = upstream.body!.getReader();
        const decoder = new TextDecoder();
        let buffer = '';

        const send = (obj: Record<string, unknown>) => {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(obj)}\n\n`));
        };

        try {
          while (true) {
            const { value, done } = await reader.read();
            if (done) break;
            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split('\n');
            buffer = lines.pop() ?? '';
            for (const line of lines) {
              const trimmed = line.trim();
              if (trimmed.startsWith(':') || trimmed === '') continue;
              if (!trimmed.startsWith('data: ')) continue;
              const data = trimmed.slice(6);
              if (data === '[DONE]') { send({ done: true }); controller.close(); return; }
              try {
                const parsed = JSON.parse(data) as { choices?: Array<{ delta?: { content?: string } }> };
                const token = parsed.choices?.[0]?.delta?.content;
                if (token) send({ token });
              } catch { /* skip */ }
            }
          }
        } catch (e) {
          send({ error: (e as Error).message });
        }
        send({ done: true });
        controller.close();
      },
    });

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
      },
    });
  } catch (err) {
    return Response.json({ error: (err as Error).message }, { status: 500 });
  }
}
