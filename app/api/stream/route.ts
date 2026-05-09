/**
 * POST /api/stream
 * Tank-grade SSE streaming agent endpoint.
 *
 * Upgrades vs v1:
 * - Knowledge base injected into system prompt dynamically
 * - ProfilerState injected per-call for context-aware responses
 * - Per-agent system prompt built from buildSystemPrompt.ts (not flat strings)
 * - Request deduplication: identical transcript+agent within 500ms is dropped
 * - Timeout guard: 8s hard limit on upstream fetch
 * - Truncation detection: signals client if response was cut off
 *
 * BUG-3B FIX (2026-05-09):
 *   - turn_history window expanded from 6 → 16 messages (last 8 pairs).
 *     The LLM now sees the full conversation thread, not just the last 3 pairs.
 *   - conversation_context field added to user message: last 10 tagged transcript
 *     lines injected directly so the model has raw conversation history even
 *     before turn_history is populated.
 *
 * BUG-4 FIX (2026-05-09):
 *   - Deep rescue detection: if transcript starts with [DEEP_RESCUE], the
 *     buildTacticalPrompt() router selects buildDeepRescuePrompt() which
 *     provides full A-Z support with conversation context.
 */
import { NextRequest } from 'next/server';
import { AGENT_CONFIGS, AgentId } from '@/lib/agentConfigs';
import {
  buildTacticalPrompt,
  buildTerminalModePrompt,
  buildRescuePrompt,
  buildDeepRescuePrompt,
  buildFollowUpPrompt,
  type KnowledgeBase,
  type ProfilerState,
  type ClientTelemetry,
} from '@/lib/buildSystemPrompt';
import KB_RAW from '@/lib/knowledge_base.json';

export const runtime = 'edge';

const kb = KB_RAW as unknown as KnowledgeBase;

// ── Deduplication store (edge-scoped, resets per cold start) ──────────────────
const recentRequests = new Map<string, number>();
const DEDUP_WINDOW_MS = 500;

function isDuplicate(key: string): boolean {
  const now = Date.now();
  const last = recentRequests.get(key);
  if (last && now - last < DEDUP_WINDOW_MS) return true;
  recentRequests.set(key, now);
  // Prune old entries
  if (recentRequests.size > 100) {
    for (const [k, t] of recentRequests.entries()) {
      if (now - t > 5000) recentRequests.delete(k);
    }
  }
  return false;
}

// ── System prompt builder — wires KB + profilerState into each agent ──────────
function buildSystemPromptForAgent(
  agentId: AgentId,
  profilerState: ProfilerState | null,
  clientTelemetry: ClientTelemetry,
  speaker: string,
  transcript: string
): string {
  switch (agentId) {
    case 'tactical':
    case 'behavioral':
      // Pass transcript so buildTacticalPrompt can detect [DEEP_RESCUE] prefix
      return buildTacticalPrompt(kb, profilerState, clientTelemetry, speaker, transcript);
    case 'code':
      return buildTerminalModePrompt(kb);
    case 'rescue':
      // If deep rescue flag set, use deep rescue prompt
      if (clientTelemetry?.isDeepRescue || transcript?.startsWith('[DEEP_RESCUE]')) {
        return buildDeepRescuePrompt(kb, profilerState);
      }
      return buildRescuePrompt(kb);
    default:
      // sales, demo, negotiation — use agentConfigs system string (already good)
      return AGENT_CONFIGS[agentId]?.system ?? '';
  }
}

// ── KB context block injected into user message ───────────────────────────────
function buildKBContext(profilerState: ProfilerState | null): string {
  const pillars = kb.candidate?.campaign_pillars ?? [];
  const stats = (kb.playbook as { power_stats?: string[] })?.power_stats ?? [];
  const phase = profilerState?.conversation_phase ?? 'unknown';
  const interviewers = profilerState?.interviewers ?? [];

  const interviewerBlock = interviewers.length > 0
    ? `\n[LIVE PROFILER INTEL]:\n${interviewers.map(i =>
        `  ${i.name ?? 'Interviewer'}: ${i.emotional_state ?? 'unknown'} | exploit: ${i.the_exploit ?? 'none detected'}`
      ).join('\n')}`
    : '';

  return `[CANDIDATE]: ${kb.candidate?.name ?? 'Unknown'} | ${kb.candidate?.current_role ?? 'N/A'}
[PHASE]: ${phase}
[POWER STATS]: ${stats.slice(0, 5).join(' | ')}
[CAMPAIGN PILLARS]: ${pillars.join(' | ')}${interviewerBlock}`;
}

export async function POST(req: NextRequest) {
  let body: {
    agent: AgentId;
    transcript: string;
    mode: string;
    problem_context: string;
    turn_history: Array<{ role: string; content: string }>;
    conversation_context?: string;   // NEW: last 10 tagged transcript lines
    profiler_state?: ProfilerState | null;
    speaker?: string;
    client_telemetry?: ClientTelemetry;
  };

  try {
    body = await req.json();
  } catch {
    return new Response('Invalid JSON', { status: 400 });
  }

  const {
    agent,
    transcript,
    mode,
    problem_context,
    turn_history,
    conversation_context = '',
    profiler_state = null,
    speaker = 'interviewer',
    client_telemetry = {},
  } = body;

  // Deduplication — skip for deep rescue (always unique)
  const isDeepRescue = transcript?.startsWith('[DEEP_RESCUE]') || client_telemetry?.isDeepRescue;
  if (!isDeepRescue) {
    const dedupKey = `${agent}:${transcript.slice(0, 80)}`;
    if (isDuplicate(dedupKey)) {
      return new Response(null, { status: 204 }); // No Content — silently drop
    }
  }

  const config = AGENT_CONFIGS[agent];
  if (!config) {
    return new Response(`Unknown agent: ${agent}`, { status: 400 });
  }

  // Build system prompt — KB-aware, profiler-injected, deep rescue aware
  const systemPrompt = buildSystemPromptForAgent(
    agent, profiler_state, client_telemetry, speaker, transcript
  );

  // Build user message with KB context block
  const kbContext = buildKBContext(profiler_state);

  // For deep rescue, strip the [DEEP_RESCUE] prefix from the transcript
  // so the model sees the clean conversation history
  const cleanTranscript = isDeepRescue
    ? transcript.replace(/^\[DEEP_RESCUE\]\n?/, '').trim()
    : transcript;

  // conversation_context: last 10 tagged transcript lines (raw STT history)
  // This gives the model full conversation context even before turn_history is populated
  const contextBlock = conversation_context
    ? `\n[CONVERSATION HISTORY (last 10 turns)]:\n${conversation_context}`
    : '';

  const userContent = `${kbContext}

[MODE]: ${mode}
[ACTIVE CONTEXT]: ${(problem_context ?? '').slice(0, 400)}${contextBlock}
[SPEAKER]: ${speaker.toUpperCase()}
[LIVE TRANSCRIPT]: ${cleanTranscript}`;

  const messages = [
    { role: 'system', content: systemPrompt || config.system },
    // BUG-3B FIX: expanded from 6 → 16 messages (last 8 pairs)
    ...(turn_history ?? []).slice(-16),
    { role: 'user', content: userContent },
  ];

  const requestBody: Record<string, unknown> = {
    model: config.model,
    messages,
    max_tokens: config.max_tokens,
    temperature: config.temperature,
    stream: true,
  };

  if (config.reasoning) {
    requestBody.reasoning = config.reasoning;
  }

  // ── Upstream fetch with timeout ───────────────────────────────────────────
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 8000);

  let upstream: Response;
  try {
    upstream = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.OPENROUTER_API_KEY}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000',
        'X-Title': 'Alpha Copilot',
      },
      body: JSON.stringify(requestBody),
      signal: controller.signal,
    });
  } catch (err) {
    clearTimeout(timeoutId);
    const isTimeout = (err as Error).name === 'AbortError';
    console.error('[stream] OpenRouter fetch failed:', isTimeout ? 'TIMEOUT' : err);
    return new Response(isTimeout ? 'OpenRouter timeout' : 'OpenRouter unreachable', { status: 502 });
  }
  clearTimeout(timeoutId);

  if (!upstream.ok) {
    const errText = await upstream.text();
    console.error('[stream] OpenRouter pre-stream error:', upstream.status, errText);
    if (upstream.status === 429) {
      return new Response(
        JSON.stringify({ error: 'rate_limited' }),
        { status: 429, headers: { 'Content-Type': 'application/json' } }
      );
    }
    return new Response(`OpenRouter error: ${upstream.status}`, { status: 502 });
  }

  // ── SSE output stream ─────────────────────────────────────────────────────
  const encoder = new TextEncoder();
  let tokenCount = 0;
  const TOKEN_WARN_THRESHOLD = Math.floor(config.max_tokens * 0.92);

  const outputStream = new ReadableStream({
    async start(controller) {
      const reader = upstream.body!.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      const send = (obj: Record<string, unknown>) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(obj)}\n\n`));
      };

      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });

          while (true) {
            const lineEnd = buffer.indexOf('\n');
            if (lineEnd === -1) break;
            const line = buffer.slice(0, lineEnd).trim();
            buffer = buffer.slice(lineEnd + 1);

            if (line.startsWith(':') || line === '') continue;
            if (!line.startsWith('data: ')) continue;

            const data = line.slice(6);
            if (data === '[DONE]') {
              send({ type: 'done', token_count: tokenCount });
              controller.close();
              return;
            }

            let parsed: Record<string, unknown>;
            try { parsed = JSON.parse(data); } catch { continue; }

            if (parsed.error) {
              const errMsg = (parsed.error as { message?: string })?.message ?? 'Unknown stream error';
              send({ type: 'error', message: errMsg });
              controller.close();
              return;
            }

            const delta = (parsed.choices as Array<{ delta: Record<string, unknown>; finish_reason?: string }>)?.[0];
            if (!delta) continue;

            // Detect finish_reason=length (truncated by token limit)
            if (delta.finish_reason === 'length') {
              send({ type: 'truncated', message: 'Response reached token limit' });
              send({ type: 'done', token_count: tokenCount });
              controller.close();
              return;
            }

            if (delta.delta?.reasoning_details) continue; // skip thinking tokens

            const content = delta.delta?.content as string | undefined;
            if (content) {
              tokenCount++;
              // Warn client approaching limit
              if (tokenCount === TOKEN_WARN_THRESHOLD) {
                send({ type: 'approaching_limit' });
              }
              send({ type: 'chunk', content });
            }
          }
        }
      } catch (err) {
        console.error('[stream] Stream read error:', err);
        send({ type: 'error', message: 'Stream interrupted' });
        controller.close();
      } finally {
        reader.cancel();
      }
    },
  });

  return new Response(outputStream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
}
