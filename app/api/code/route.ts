/**
 * POST /api/code
 *
 * Code agent. Fires when conductor routes agentType = "code".
 * Guides the candidate through a live coding problem step by step.
 *
 * Model: qwen-2.5-coder-32b-instruct (best coding model in registry)
 * Format: SSE (text/event-stream)
 *
 * Output format (parsed by parseHUD.ts):
 *   [CLARIFY FIRST]
 *   [APPROACH]
 *   [THE CODE]
 *   [FOLLOW-UP TRAP]
 */
import { NextRequest } from 'next/server';
import { MODELS, MAX_TOKENS, openRouterStream, buildSSEStream } from '@/lib/models';
import type { SessionState } from '@/lib/session';
import { buildConversationContext } from '@/lib/session';

export const runtime = 'edge';

const SYSTEM = `You are an expert coding interview coach giving REAL-TIME guidance to a candidate in a live coding interview.
The candidate sees your output on a private HUD. The interviewer cannot see it.

CRITICAL RULES:
1. Output EXACTLY this format:

[CLARIFY FIRST]
1-2 clarifying questions the candidate should ask BEFORE writing any code.
These reveal constraints that change the solution. Examples: input size, duplicates allowed, sorted input, in-place required.
If the problem is already fully specified, write "Problem is fully specified — proceed to approach."

[APPROACH]
The algorithm in plain English. 3-5 sentences max.
State: data structure, time complexity, space complexity, and WHY this approach over alternatives.
Example: "Two-pointer on sorted array — O(n) time, O(1) space. Better than hash map because no extra space needed and input is sorted."

[THE CODE]
Working code in the language the interviewer specified (default: Python).
Clean, readable, with inline comments on non-obvious lines.
Include edge case handling.
Wrap in a code block with language tag.

[FOLLOW-UP TRAP]
The most likely follow-up question the interviewer will ask after seeing this solution.
One sentence stating the question, then one sentence with the answer.
Example: "They'll ask: what if the array has duplicates? Answer: add a check to skip duplicate values at both pointers."

2. NEVER write the full solution immediately — always show [CLARIFY FIRST] first.
3. Code in [THE CODE] must be correct and runnable. No pseudocode.
4. [APPROACH] must state complexity. No exceptions.
5. NEVER use filler phrases.`;

export async function POST(req: NextRequest) {
  let body: {
    session: SessionState;
    utterance: string;
    conductorPlan: string;
  };
  try { body = await req.json(); }
  catch { return new Response('Invalid JSON', { status: 400 }); }

  const { session, utterance, conductorPlan } = body;

  const conversationContext = buildConversationContext(session, 6);

  const userMessage = `
CONDUCTOR PLAN: ${conductorPlan}

INTERVIEW PHASE: ${session.phase}

RECENT CONVERSATION:
${conversationContext}

CODING PROBLEM STATED: "${utterance}"

Generate the guided solve HUD now. Follow the 4-section format exactly.
`.trim();

  const stream = await openRouterStream(
    MODELS.code,
    [
      { role: 'system', content: SYSTEM },
      { role: 'user', content: userMessage },
    ],
    MAX_TOKENS.code,
    0.2 // low temp for code
  );

  return buildSSEStream(stream);
}
