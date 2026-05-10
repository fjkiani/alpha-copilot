/**
 * POST /api/monitor
 *
 * Monitor agent. Runs in parallel with the candidate's answer.
 * Evaluates the candidate's live transcript and raises flags.
 *
 * Model: qwen-plus (fast, cheap — runs continuously)
 * Returns: JSON (not SSE), target latency < 2s
 *
 * Flags:
 *   WRONG_ANSWER       — factually incorrect statement
 *   MISSING_MECHANISM  — 30s elapsed, key mechanism not mentioned
 *   RAMBLING           — speaking > 45s on same turn
 *   MISSED_ANCHOR      — missed opportunity to connect to a strength
 */
import { NextRequest, NextResponse } from 'next/server';
import { MODELS, MAX_TOKENS, openRouterJSON } from '@/lib/models';
import type { SessionState, MonitorFlag } from '@/lib/session';

export const runtime = 'edge';

const SYSTEM = `You are a real-time interview monitor. You evaluate a candidate's live answer transcript and raise flags when coaching intervention is needed.

OUTPUT STRICTLY VALID JSON — no markdown, no prose.

Schema:
{
  "flags": [
    {
      "type": "WRONG_ANSWER | MISSING_MECHANISM | RAMBLING | MISSED_ANCHOR",
      "detail": "string — specific description of what triggered this flag. Max 30 words. Be precise."
    }
  ],
  "shouldPivot": boolean,
  "pivotReason": "string | null"
}

FLAG RULES:
- WRONG_ANSWER: raise ONLY if the candidate stated something factually incorrect. Not just incomplete — actually wrong. Include the incorrect claim in detail.
- MISSING_MECHANISM: raise if speakingSeconds > 30 AND the keyMechanism has not been mentioned. Include what mechanism is missing.
- RAMBLING: raise if speakingSeconds > 45. Include how long they've been speaking.
- MISSED_ANCHOR: raise if there was a clear opportunity to connect to a relevant strength or experience and the candidate missed it. Be specific about what the anchor should have been.

shouldPivot = true if WRONG_ANSWER or RAMBLING flag is raised.
pivotReason = brief instruction for the pivot agent if shouldPivot is true, else null.

If no flags are warranted, return { "flags": [], "shouldPivot": false, "pivotReason": null }.
Do NOT raise flags for minor issues. Only raise when coaching intervention would genuinely help.`;

export async function POST(req: NextRequest) {
  let body: {
    session: SessionState;
    transcript: string;
    speakingSeconds: number;
    keyMechanism: string;
  };
  try { body = await req.json(); }
  catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }

  const { session, transcript, speakingSeconds, keyMechanism } = body;

  if (!transcript?.trim()) {
    return NextResponse.json({ flags: [], shouldPivot: false, pivotReason: null });
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 4000); // 4s hard limit

  const userMessage = `
INTERVIEW PHASE: ${session.phase}
CURRENT QUESTION: ${session.activeQuestion ?? 'unknown'}
KEY MECHANISM TO COVER: ${keyMechanism}
CANDIDATE SPEAKING SECONDS: ${speakingSeconds}

CANDIDATE TRANSCRIPT (this turn):
"${transcript}"

EXISTING FLAGS THIS TURN: ${session.monitorFlags.map(f => f.type).join(', ') || 'none'}

Evaluate and return flags.
`.trim();

  try {
    const content = await openRouterJSON(
      MODELS.monitor,
      [
        { role: 'system', content: SYSTEM },
        { role: 'user', content: userMessage },
      ],
      MAX_TOKENS.monitor,
      0.1,
      controller.signal
    );
    clearTimeout(timeoutId);

    let parsed: { flags: Omit<MonitorFlag, 'timestamp'>[]; shouldPivot: boolean; pivotReason: string | null };
    try { parsed = JSON.parse(content); }
    catch {
      return NextResponse.json({ flags: [], shouldPivot: false, pivotReason: null });
    }

    // Stamp timestamps
    const flags: MonitorFlag[] = (parsed.flags ?? []).map(f => ({
      ...f,
      timestamp: Date.now(),
    }));

    return NextResponse.json({
      flags,
      shouldPivot: parsed.shouldPivot ?? false,
      pivotReason: parsed.pivotReason ?? null,
    });

  } catch (err) {
    clearTimeout(timeoutId);
    console.error('[monitor]', err);
    // Silent failure — never block the candidate
    return NextResponse.json({ flags: [], shouldPivot: false, pivotReason: null });
  }
}
