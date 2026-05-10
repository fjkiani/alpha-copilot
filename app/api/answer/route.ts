/**
 * POST /api/answer
 *
 * Main answer agent. Streams a structured HUD response for technical
 * and behavioral questions.
 *
 * Model: deepseek-chat-v3-0324
 * Format: SSE (text/event-stream)
 * Target latency: first token < 1.5s, complete < 6s
 *
 * Output format (parsed by parseHUD.ts):
 *   [WHAT THEY'RE TESTING]
 *   [SAY THIS FIRST]
 *   [THE MECHANISM]
 *   [CLOSE WITH]
 */
import { NextRequest } from 'next/server';
import { MODELS, MAX_TOKENS, openRouterStream, buildSSEStream } from '@/lib/models';
import type { SessionState } from '@/lib/session';
import { buildConversationContext } from '@/lib/session';

export const runtime = 'edge';

const SYSTEM = `You are an expert interview coach giving REAL-TIME guidance to a candidate in a live interview.
The candidate can see your output on a private HUD screen. The interviewer cannot see it.

CRITICAL RULES:
1. Output EXACTLY this format — no deviations, no extra sections:

[WHAT THEY'RE TESTING]
One sentence. The underlying concept or skill being evaluated. Not the surface question.

[SAY THIS FIRST]
The opening sentence the candidate should say. Specific. Confident. Mechanism-first.
Max 2 sentences.

[THE MECHANISM]
3-5 bullet points explaining HOW the thing works. Not WHAT it is.
Each bullet = one concrete mechanism, trade-off, or decision point.
Use precise technical vocabulary. No buzzwords without explanation.

[CLOSE WITH]
One sentence to land the answer. Connect to a trade-off, a real-world implication, or a follow-up they should offer.

2. NEVER write a full essay. The candidate is speaking, not reading.
3. NEVER use filler phrases: "Great question", "Certainly", "Of course", "Absolutely".
4. NEVER inject resume content, personal anecdotes, or company-specific references.
5. Bullets in [THE MECHANISM] must explain mechanisms. "Use Redis for caching" = FAIL. "Redis uses single-threaded event loop + in-memory hash tables for O(1) reads, avoiding lock contention" = PASS.
6. [SAY THIS FIRST] is the candidate's FIRST WORDS — make it land immediately.`;

export async function POST(req: NextRequest) {
  let body: {
    session: SessionState;
    utterance: string;
    conductorPlan: string;
    matchedQuestion?: {
      question: string;
      skeleton: string;
      keyMechanism: string;
    } | null;
  };
  try { body = await req.json(); }
  catch { return new Response('Invalid JSON', { status: 400 }); }

  const { session, utterance, conductorPlan, matchedQuestion } = body;

  const conversationContext = buildConversationContext(session, 8);

  const userMessage = `
CONDUCTOR PLAN: ${conductorPlan}

${matchedQuestion ? `MATCHED QUESTION FROM BANK:
Question: ${matchedQuestion.question}
Key mechanism: ${matchedQuestion.keyMechanism}
Answer skeleton: ${matchedQuestion.skeleton}
` : ''}
INTERVIEW PHASE: ${session.phase}

RECENT CONVERSATION:
${conversationContext}

INTERVIEWER JUST ASKED: "${utterance}"

Generate the HUD response now. Follow the 4-section format exactly.
`.trim();

  const stream = await openRouterStream(
    MODELS.answer,
    [
      { role: 'system', content: SYSTEM },
      { role: 'user', content: userMessage },
    ],
    MAX_TOKENS.answer,
    0.4
  );

  return buildSSEStream(stream);
}
