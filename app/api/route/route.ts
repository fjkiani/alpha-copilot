import { NextRequest, NextResponse } from 'next/server';
import { ROUTER_MODEL, ROUTER_SYSTEM } from '@/lib/agentConfigs';

export const runtime = 'edge';

export async function POST(req: NextRequest) {
  // Validate input
  let body: { transcript: string; speaker: string; mode: string; context_summary: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const { transcript, speaker, mode, context_summary } = body;

  if (!transcript || typeof transcript !== 'string') {
    return NextResponse.json({ error: 'transcript is required' }, { status: 400 });
  }

  const userPrompt = `Speaker: ${speaker ?? 'UNKNOWN'}
Mode: ${mode ?? 'unknown'}
Context: ${(context_summary ?? '').slice(0, 200)}
Transcript: "${transcript.slice(0, 500)}"`;

  let openRouterRes: Response;
  try {
    openRouterRes = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.OPENROUTER_API_KEY}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000',
        'X-Title': 'Alpha Copilot',
      },
      body: JSON.stringify({
        model: ROUTER_MODEL,
        messages: [
          { role: 'system', content: ROUTER_SYSTEM },
          { role: 'user', content: userPrompt },
        ],
        max_tokens: 80,
        temperature: 0.0,
        response_format: { type: 'json_object' },
      }),
    });
  } catch (err) {
    console.error('[route] OpenRouter fetch failed:', err);
    return NextResponse.json({ error: 'OpenRouter unreachable' }, { status: 502 });
  }

  if (!openRouterRes.ok) {
    const errText = await openRouterRes.text();
    console.error('[route] OpenRouter error:', openRouterRes.status, errText);
    return NextResponse.json(
      { error: `OpenRouter returned ${openRouterRes.status}` },
      { status: 502 }
    );
  }

  let parsed: Record<string, unknown>;
  try {
    const data = await openRouterRes.json();
    const content = data?.choices?.[0]?.message?.content;
    if (!content) throw new Error('Empty content from model');
    parsed = JSON.parse(content);
  } catch (err) {
    console.error('[route] Failed to parse model response:', err);
    return NextResponse.json({ error: 'Model returned unparseable response' }, { status: 500 });
  }

  // Validate required fields exist before returning
  const required = ['intent', 'mode', 'urgency', 'agent', 'confidence'];
  for (const field of required) {
    if (!(field in parsed)) {
      console.error('[route] Missing field in model response:', field, parsed);
      return NextResponse.json({ error: `Model response missing field: ${field}` }, { status: 500 });
    }
  }

  return NextResponse.json(parsed);
}
