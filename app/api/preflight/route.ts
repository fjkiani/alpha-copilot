/**
 * POST /api/preflight
 *
 * Fires once when user hits START, before recording begins.
 * Reads the job description / session context and produces:
 *   - briefing: 200-word private role briefing
 *   - questionBank: 12 predicted questions with answer skeletons
 *   - phasePlan: predicted phase sequence with time estimates
 *
 * Model: deepseek-chat-v3-0324 (strong reasoning, runs once)
 * Returns: JSON (not SSE)
 */
import { NextRequest, NextResponse } from 'next/server';
import { MODELS, MAX_TOKENS, openRouterJSON } from '@/lib/models';

export const runtime = 'edge';

const SYSTEM = `You are an expert interview preparation analyst.
Given a job description or role context, produce a structured JSON briefing for a candidate about to enter a live interview.

OUTPUT STRICTLY VALID JSON — no markdown, no prose, no trailing commas.

Schema:
{
  "briefing": "string — max 200 words. What this role actually cares about. What the interviewer will probe. What traps to avoid. Written as private coaching notes for the candidate.",
  "questionBank": [
    {
      "question": "string — the exact question the interviewer is likely to ask",
      "likelihood": "high | medium | low",
      "phase": "intro | technical | coding | behavioral | close",
      "skeleton": "string — 3 bullet points of mechanism (HOW things work, not WHAT they are). These are scaffolds, not full answers. Max 60 words total.",
      "keyMechanism": "string — the single concept or skill the interviewer is testing for with this question. Max 15 words."
    }
  ],
  "phasePlan": [
    {
      "phase": "intro | technical | coding | behavioral | close",
      "estimatedMinutes": number,
      "triggerKeywords": ["array", "of", "keywords", "that", "signal", "this", "phase"],
      "description": "string — what typically happens in this phase for this role"
    }
  ]
}

RULES:
- questionBank must have EXACTLY 12 entries. No more, no less.
- Distribute questions across phases: 1-2 intro, 4-5 technical, 2-3 coding, 2-3 behavioral, 1 close.
- skeleton bullets explain mechanisms, not buzzwords. "Use Kafka" = FAIL. "Kafka consumer groups commit offsets for exactly-once delivery" = PASS.
- keyMechanism is what the interviewer is REALLY testing — the underlying concept, not the surface question.
- phasePlan must cover all 5 phases in order.
- briefing must be actionable coaching, not a job description summary.`;

export async function POST(req: NextRequest) {
  let body: { context: string };
  try { body = await req.json(); }
  catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }

  const { context } = body;
  if (!context?.trim()) {
    return NextResponse.json({ error: 'context is required' }, { status: 400 });
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 25000); // 25s — preflight can be slow

  try {
    const content = await openRouterJSON(
      MODELS.preflight,
      [
        { role: 'system', content: SYSTEM },
        { role: 'user', content: `Job description / role context:\n\n${context.slice(0, 3000)}` },
      ],
      MAX_TOKENS.preflight,
      0.3,
      controller.signal
    );
    clearTimeout(timeoutId);

    let parsed: { briefing: string; questionBank: unknown[]; phasePlan: unknown[] };
    try { parsed = JSON.parse(content); }
    catch {
      console.error('[preflight] JSON parse failed:', content.slice(0, 200));
      return NextResponse.json({ error: 'Model returned invalid JSON' }, { status: 502 });
    }

    // Validate structure
    if (!parsed.briefing || !Array.isArray(parsed.questionBank) || !Array.isArray(parsed.phasePlan)) {
      return NextResponse.json({ error: 'Model returned incomplete structure' }, { status: 502 });
    }

    return NextResponse.json({
      briefing: parsed.briefing,
      questionBank: parsed.questionBank,
      phasePlan: parsed.phasePlan,
    });

  } catch (err) {
    clearTimeout(timeoutId);
    const isTimeout = (err as Error).name === 'AbortError';
    console.error('[preflight]', isTimeout ? 'TIMEOUT' : err);
    return NextResponse.json(
      { error: isTimeout ? 'Preflight timed out' : 'Preflight failed' },
      { status: 502 }
    );
  }
}
