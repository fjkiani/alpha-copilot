/**
 * POST /api/conductor
 *
 * Fast classifier that runs on every new interviewer utterance.
 * Determines:
 *   - which phase we're in
 *   - which question from the bank was asked (or null for cold)
 *   - which agent should handle the response
 *   - a conductorPlan (brief instruction for the answer agent)
 *
 * Model: qwen-plus (fast, cheap — this runs on every turn)
 * Returns: JSON (not SSE), target latency < 1.5s
 */
import { NextRequest, NextResponse } from 'next/server';
import { MODELS, MAX_TOKENS, openRouterJSON } from '@/lib/models';
import type { SessionState } from '@/lib/session';

export const runtime = 'edge';

const SYSTEM = `You are an interview session conductor.
Given the current session state and the latest interviewer utterance, classify the situation and route to the correct agent.

OUTPUT STRICTLY VALID JSON — no markdown, no prose.

Schema:
{
  "phase": "intro | technical | coding | behavioral | close",
  "phaseChanged": boolean,
  "matchedQuestionIndex": number | null,
  "agentType": "answer | code | pivot | rescue",
  "conductorPlan": "string — max 40 words. Specific instruction for the answer agent. What mechanism to lead with. What trap to avoid. What to close on.",
  "urgency": "normal | rescue"
}

ROUTING RULES:
- agentType = "code" if the interviewer asks to write code, implement something, or solve an algorithm
- agentType = "rescue" if the candidate is clearly lost, silent > 10s, or explicitly asks for help
- agentType = "pivot" if the monitor has raised flags (check monitorFlags in session)
- agentType = "answer" for all other technical and behavioral questions
- urgency = "rescue" only when agentType = "rescue"

PHASE DETECTION:
- Use phasePlan.triggerKeywords to detect phase transitions
- phaseChanged = true only when the phase actually changes from the current session phase

QUESTION MATCHING:
- matchedQuestionIndex = the index in questionBank that best matches the interviewer's question
- matchedQuestionIndex = null if no good match (cold question not in bank)
- Match on semantic similarity, not exact wording

conductorPlan must be SPECIFIC to this question. Not generic coaching. Tell the answer agent exactly what mechanism to lead with.`;

export async function POST(req: NextRequest) {
  let body: { session: SessionState; utterance: string };
  try { body = await req.json(); }
  catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }

  const { session, utterance } = body;
  if (!utterance?.trim()) {
    return NextResponse.json({ error: 'utterance is required' }, { status: 400 });
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 6000); // 6s hard limit

  const userMessage = `
CURRENT SESSION STATE:
- Phase: ${session.phase}
- Active question: ${session.activeQuestion ?? 'none'}
- Monitor flags this turn: ${session.monitorFlags.map(f => f.type).join(', ') || 'none'}
- Candidate speaking seconds: ${Math.round((Date.now() - session.currentTurnStartedAt) / 1000)}

QUESTION BANK (${session.questionBank.length} entries):
${session.questionBank.map((q, i) => `[${i}] ${q.question} (phase: ${q.phase}, mechanism: ${q.keyMechanism})`).join('\n')}

PHASE PLAN:
${session.phasePlan.map(p => `${p.phase}: triggers=[${p.triggerKeywords.join(', ')}]`).join('\n')}

LATEST INTERVIEWER UTTERANCE:
"${utterance}"

RECENT CONVERSATION (last 4 turns):
${session.turnHistory.slice(-4).map(t => `${t.speaker}: ${t.text}`).join('\n')}
`.trim();

  try {
    const content = await openRouterJSON(
      MODELS.router,
      [
        { role: 'system', content: SYSTEM },
        { role: 'user', content: userMessage },
      ],
      MAX_TOKENS.conductor,
      0.1, // very low temp — classification task
      controller.signal
    );
    clearTimeout(timeoutId);

    let parsed: {
      phase: string;
      phaseChanged: boolean;
      matchedQuestionIndex: number | null;
      agentType: string;
      conductorPlan: string;
      urgency: string;
    };
    try { parsed = JSON.parse(content); }
    catch {
      console.error('[conductor] JSON parse failed:', content.slice(0, 200));
      // Fallback: route to answer agent, no phase change
      return NextResponse.json({
        phase: session.phase,
        phaseChanged: false,
        matchedQuestionIndex: null,
        agentType: 'answer',
        conductorPlan: 'Answer the question directly. Lead with the core mechanism.',
        urgency: 'normal',
      });
    }

    return NextResponse.json(parsed);

  } catch (err) {
    clearTimeout(timeoutId);
    console.error('[conductor]', err);
    // Fallback on timeout/error — never block the user
    return NextResponse.json({
      phase: session.phase,
      phaseChanged: false,
      matchedQuestionIndex: null,
      agentType: 'answer',
      conductorPlan: 'Answer the question directly. Lead with the core mechanism.',
      urgency: 'normal',
    });
  }
}
