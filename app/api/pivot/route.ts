/**
 * POST /api/pivot
 *
 * Pivot agent. Fires when monitor raises shouldPivot = true.
 * Delivers a brief interrupt banner telling the candidate to stop and redirect.
 *
 * Model: qwen-plus (fast — this is time-critical)
 * Format: SSE (text/event-stream)
 *
 * Output format (parsed by parseHUD.ts):
 *   [STOP]
 *   [SAY THIS NOW]
 *   [LAND HERE]
 */
import { NextRequest } from 'next/server';
import { MODELS, MAX_TOKENS, openRouterStream, buildSSEStream } from '@/lib/models';
import type { SessionState } from '@/lib/session';

export const runtime = 'edge';

const SYSTEM = `You are an emergency interview pivot coach. The candidate is going off-track in a live interview.
You have 3 seconds to give them a course correction. Be direct. Be brief. Be specific.

CRITICAL RULES:
1. Output EXACTLY this format:

[STOP]
One sentence. What went wrong. No blame — just the fact.
Example: "You've been speaking for 50 seconds without mentioning the core mechanism."

[SAY THIS NOW]
The exact sentence the candidate should say to pivot. Verbatim. They will read this aloud.
Max 2 sentences. Must sound natural, not robotic.
Example: "Let me step back and focus on the key trade-off here — consistency vs availability in distributed systems."

[LAND HERE]
One sentence. Where they should end up after the pivot. The mechanism or point they need to hit.
Example: "Land on: CAP theorem forces a choice, and the right answer depends on the use case."

2. [SAY THIS NOW] must be something a human would actually say. No jargon dumps.
3. NEVER be harsh or alarming. The candidate is stressed. Be calm and directive.
4. Total output must be under 80 words.`;

export async function POST(req: NextRequest) {
  let body: {
    session: SessionState;
    pivotReason: string;
    transcript: string;
    flags: string[];
  };
  try { body = await req.json(); }
  catch { return new Response('Invalid JSON', { status: 400 }); }

  const { session, pivotReason, transcript, flags } = body;

  const userMessage = `
INTERVIEW PHASE: ${session.phase}
CURRENT QUESTION: ${session.activeQuestion ?? 'unknown'}
MONITOR FLAGS: ${flags.join(', ')}
PIVOT REASON: ${pivotReason}

CANDIDATE TRANSCRIPT SO FAR:
"${transcript.slice(-500)}"

Generate the pivot interrupt now. Follow the 3-section format exactly.
`.trim();

  const stream = await openRouterStream(
    MODELS.pivot,
    [
      { role: 'system', content: SYSTEM },
      { role: 'user', content: userMessage },
    ],
    MAX_TOKENS.pivot,
    0.3
  );

  return buildSSEStream(stream);
}
