/**
 * POST /api/profiler
 * Background Profiler Agent — "The Shrink"
 * Called every 60s to analyze interviewer psychology.
 *
 * Accepts: { currentProfileState: object|null, latestChunk: string[] }
 * Returns: merged profiler state
 */
import { buildProfilerPrompt, buildProfilerUserMessage, type ProfilerState, type KnowledgeBase } from '@/lib/buildSystemPrompt';

// Knowledge base is loaded from lib/knowledge_base.json at build time
// In production, this is bundled. In dev, it's read from disk.
let _kb: KnowledgeBase | null = null;
function getKnowledgeBase(): KnowledgeBase {
  if (_kb) return _kb;
  try {
    // Dynamic require for server-side only
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const kb = require('@/lib/knowledge_base.json') as KnowledgeBase;
    _kb = kb;
    return kb;
  } catch {
    return {};
  }
}

interface ProfilerDelta {
  new_interviewer_insights?: Array<{
    name?: string;
    emotional_state?: string;
    corporate_trauma?: string;
    the_exploit?: string;
  }>;
  new_pillars_deployed?: string[];
  new_off_script?: { detected: boolean; reason?: string | null };
  conversation_phase?: string;
}

function deepMergeProfilerState(
  currentState: ProfilerState | null,
  delta: ProfilerDelta
): ProfilerState {
  const state: ProfilerState = currentState ?? {
    interviewers: [],
    alpha_telemetry: {
      pillars_deployed: [],
      pillars_missing: [],
      is_off_script: false,
      off_script_reason: null,
    },
    conversation_phase: 'opening',
    room_power: 'Neutral',
  };

  if (delta.new_interviewer_insights?.length) {
    for (const insight of delta.new_interviewer_insights) {
      const existing = state.interviewers?.find((i) => i.name === insight.name);
      if (existing) {
        if (insight.emotional_state) existing.emotional_state = insight.emotional_state;
        if (insight.corporate_trauma) existing.corporate_trauma = insight.corporate_trauma;
        if (insight.the_exploit) existing.the_exploit = insight.the_exploit;
      } else {
        state.interviewers = [...(state.interviewers ?? []), insight];
      }
    }
  }

  if (delta.new_pillars_deployed?.length) {
    const deployed = new Set(state.alpha_telemetry?.pillars_deployed ?? []);
    for (const p of delta.new_pillars_deployed) deployed.add(p);
    const allPillars = getKnowledgeBase()?.candidate?.campaign_pillars ?? [];
    state.alpha_telemetry = {
      ...state.alpha_telemetry,
      pillars_deployed: [...deployed],
      pillars_missing: allPillars.filter((p) => !deployed.has(p)),
    };
  }

  if (!state.alpha_telemetry) state.alpha_telemetry = {};
  state.alpha_telemetry.is_off_script = delta.new_off_script?.detected ?? false;
  state.alpha_telemetry.off_script_reason = delta.new_off_script?.detected
    ? (delta.new_off_script.reason ?? null)
    : null;

  if (delta.conversation_phase) state.conversation_phase = delta.conversation_phase;

  return state;
}

function parseJSON(text: string): ProfilerDelta {
  try {
    return JSON.parse(text) as ProfilerDelta;
  } catch {
    const cleaned = text.replace(/```json?\n?/gi, '').replace(/```/g, '').trim();
    try {
      return JSON.parse(cleaned) as ProfilerDelta;
    } catch {
      return { new_interviewer_insights: [], new_pillars_deployed: [] };
    }
  }
}

export async function POST(request: Request) {
  try {
    const { currentProfileState, latestChunk } = (await request.json()) as {
      currentProfileState: ProfilerState | null;
      latestChunk: string[];
    };

    if (!latestChunk || latestChunk.length === 0) {
      return Response.json(
        currentProfileState ?? { interviewers: [], conversation_phase: 'opening', room_power: 'Neutral' }
      );
    }

    const kb = getKnowledgeBase();
    const systemPrompt = buildProfilerPrompt(kb);
    const userMessage = buildProfilerUserMessage(currentProfileState, latestChunk);

    const messages = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userMessage },
    ];

    const apiKey = process.env.OPENROUTER_API_KEY;
    if (!apiKey) throw new Error('OPENROUTER_API_KEY not configured');

    const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000',
        'X-Title': 'Alpha Copilot',
      },
      body: JSON.stringify({
        model: 'qwen/qwen-plus-2025-07-28',
        messages,
        temperature: 0.2,
        max_tokens: 400,
        response_format: { type: 'json_object' },
      }),
    });

    if (!res.ok) throw new Error(`OpenRouter ${res.status}: ${await res.text()}`);
    const data = (await res.json()) as { choices: Array<{ message: { content: string } }> };
    const text = data.choices?.[0]?.message?.content ?? '';
    const delta = parseJSON(text);
    const mergedState = deepMergeProfilerState(currentProfileState, delta);
    return Response.json(mergedState);
  } catch (err) {
    console.error('[profiler] Error:', err);
    return Response.json(
      { interviewers: [], conversation_phase: 'unknown', room_power: 'Neutral' },
      { status: 200 }
    );
  }
}
