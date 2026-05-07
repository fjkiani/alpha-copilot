import { NextResponse } from 'next/server';

export const runtime = 'edge';

export async function GET() {
  const start = Date.now();

  try {
    const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.OPENROUTER_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'qwen/qwen-plus-2025-07-28',
        messages: [{ role: 'user', content: 'Reply with exactly: ok' }],
        max_tokens: 5,
        temperature: 0.0,
      }),
    });

    if (!res.ok) {
      return NextResponse.json({ status: 'error', code: res.status }, { status: 502 });
    }

    const data = await res.json();
    const content = data?.choices?.[0]?.message?.content ?? '';

    return NextResponse.json({
      status: 'ok',
      latency_ms: Date.now() - start,
      model_response: content.trim(),
      api_key_valid: true,
    });
  } catch (err) {
    return NextResponse.json(
      { status: 'error', message: String(err) },
      { status: 502 }
    );
  }
}
