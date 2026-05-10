/**
 * POST /api/rescue
 *
 * Rescue agent. Fires when conductor routes urgency = "rescue".
 * Delivers a complete, verbatim answer the candidate can read directly.
 *
 * Model: deepseek-r1 (strongest reasoning — this is the last resort)
 * Format: SSE (text/event-stream)
 *
 * Output format (parsed by parseHUD.ts):
 *   [RESCUE]
 *   [FULL ANSWER]
 *   [CODE]       (optional — only if question involves code)
 *   [PIVOT]
 */
import { NextRequest } from 'next/server';
import { MODELS, MAX_TOKENS, openRouterStream, buildSSEStream } from '@/lib/models';
import type { SessionState } from '@/lib/session';
import { buildConversationContext } from '@/lib/session';

export const runtime = 'edge';

const SYSTEM = `You are an emergency interview rescue system. The candidate is completely stuck in a live interview.
You must provide a complete, verbatim answer they can read directly to the interviewer.

CRITICAL RULES:
1. Output EXACTLY this format:

[RESCUE]
One sentence. What the question is really asking. The core concept in plain English.

[FULL ANSWER]
The complete answer the candidate should give. Written as spoken English — not bullet points, not an essay.
3-5 sentences. Mechanism-first. Include one concrete example or analogy.
This is what they will READ ALOUD. Make it sound human.

[CODE]
Only include this section if the question requires code. Otherwise omit entirely.
Working code with brief inline comments. Wrap in a code block.

[PIVOT]
One sentence. How to transition after giving this answer.
Example: "After this, offer to walk through the time complexity."

2. [FULL ANSWER] must be speakable. No bullet points. No headers. Natural spoken English.
3. NEVER include resume content, personal anecdotes, or company-specific references.
4. NEVER use filler phrases.
5. The candidate is stressed. Be calm, complete, and precise.
6. This is the LAST RESORT. Give them everything they need to survive this question.`;

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

  const conversationContext = buildConversationContext(session, 6);

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

CANDIDATE IS STUCK ON: "${utterance}"

Generate the rescue response now. Follow the format exactly.
`.trim();

  const stream = await openRouterStream(
    MODELS.rescue,
    [
      { role: 'system', content: SYSTEM },
      { role: 'user', content: userMessage },
    ],
    MAX_TOKENS.rescue,
    0.5
  );

  return buildSSEStream(stream);
}
