/**
 * POST /api/route
 * Tank-grade intent classifier.
 * - 12-rule router system prompt
 * - 2500ms hard timeout with tactical fallback
 * - Validates all required fields
 * - Returns phase_hint for profiler
 */
import { NextRequest, NextResponse } from 'next/server';
import { ROUTER_MODEL, ROUTER_SYSTEM } from '@/lib/agentConfigs';

export const runtime = 'edge';

const ROUTE_TIMEOUT_MS = 2500;

const FALLBACK_ROUTE = {
  intent: 'question',
  urgency: 'normal',
  agent: 'tactical',
  confidence: 0.5,
  phase_hint: 'unknown',
};

export async function POST(req: NextRequest) {
  let body: {
    transcript: string;
    speaker: string;
    mode: string;
    context_summary: string;
    is_rambling?: boolean;
  };

  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const { transcript, speaker, mode, context_summary, is_rambling } = body;

  if (!transcript || typeof transcript !== 'string') {
    return NextResponse.json({ error: 'transcript is required' }, { status: 400 });
  }

  // Fast-path: rambling override
  if (is_rambling) {
    return NextResponse.json({ ...FALLBACK_ROUTE, urgency: 'override', confidence: 0.95 });
  }

  const userPrompt = `Speaker: ${speaker ?? 'UNKNOWN'}
Mode: ${mode ?? 'unknown'}
Context: ${(context_summary ?? '').slice(0, 200)}
Transcript: "${transcript.slice(0, 600)}"`;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), ROUTE_TIMEOUT_MS);

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
        max_tokens: 100,
        temperature: 0.0,
        response_format: { type: 'json_object' },
      }),
      signal: controller.signal,
    });
  } catch (err) {
    clearTimeout(timeoutId);
    const isTimeout = (err as Error).name === 'AbortError';
    console.warn(`[route] ${isTimeout ? 'TIMEOUT' : 'FETCH_FAIL'} — using tactical fallback`);
    // Graceful degradation: return tactical fallback instead of 502
    return NextResponse.json({ ...FALLBACK_ROUTE, _fallback: true });
  }
  clearTimeout(timeoutId);

  if (!openRouterRes.ok) {
    console.warn('[route] OpenRouter error:', openRouterRes.status, '— using tactical fallback');
    return NextResponse.json({ ...FALLBACK_ROUTE, _fallback: true });
  }

  let parsed: Record<string, unknown>;
  try {
    const data = await openRouterRes.json();
    const content = data?.choices?.[0]?.message?.content;
    if (!content) throw new Error('Empty content');
    parsed = JSON.parse(content);
  } catch (err) {
    console.error('[route] Parse failed:', err, '— using tactical fallback');
    return NextResponse.json({ ...FALLBACK_ROUTE, _fallback: true });
  }

  // Validate and fill missing fields with fallback values
  const result = {
    intent: parsed.intent ?? FALLBACK_ROUTE.intent,
    urgency: parsed.urgency ?? FALLBACK_ROUTE.urgency,
    agent: parsed.agent ?? FALLBACK_ROUTE.agent,
    confidence: typeof parsed.confidence === 'number' ? parsed.confidence : FALLBACK_ROUTE.confidence,
    phase_hint: parsed.phase_hint ?? FALLBACK_ROUTE.phase_hint,
  };

  return NextResponse.json(result);
}
