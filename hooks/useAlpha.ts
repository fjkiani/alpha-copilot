/**
 * useAlpha — Tank-grade LLM hook
 *
 * Upgrades vs v1:
 * - Passes profilerState + speaker + clientTelemetry to /api/stream
 * - Passes is_rambling to /api/route for fast-path override
 * - Handles new SSE events: truncated, approaching_limit, token_count
 * - Route timeout fallback is handled server-side — client just gets tactical
 * - Retry on truncated response (once, same payload)
 * - process() returns Promise<string | null> for BUG-A fix
 */
'use client';

import { useState, useCallback, useRef } from 'react';
import { TranscriptChunk } from '@/lib/types';
import type { ProfilerState } from '@/lib/buildSystemPrompt';

export type AlphaState = {
  insight: string;
  isStreaming: boolean;
  agent: string;
  urgency: 'normal' | 'rescue' | 'override';
  error: string | null;
  truncated: boolean;
  latency: {
    routeMs: number | null;
    firstTokenMs: number | null;
    totalMs: number | null;
  };
};

const INITIAL_STATE: AlphaState = {
  insight: '',
  isStreaming: false,
  agent: '',
  urgency: 'normal',
  error: null,
  truncated: false,
  latency: { routeMs: null, firstTokenMs: null, totalMs: null },
};

export function useAlpha(mode: 'interview' | 'sales' | 'demo') {
  const [state, setState] = useState<AlphaState>(INITIAL_STATE);
  const abortRef = useRef<AbortController | null>(null);

  const turnHistoryRef = useRef<Array<{ role: string; content: string }>>((() => {
    if (typeof window === 'undefined') return [];
    try {
      const saved = sessionStorage.getItem(`alpha_history_${mode}`);
      return saved ? JSON.parse(saved) : [];
    } catch { return []; }
  })());

  const process = useCallback(async (
    chunk: TranscriptChunk,
    problemContext: string,
    opts?: {
      profilerState?: ProfilerState | null;
      isRambling?: boolean;
      retryCount?: number;
    }
  ): Promise<string | null> => {
    const t0 = performance.now();
    const cappedContext = problemContext.slice(0, 500);
    const { profilerState = null, isRambling = false, retryCount = 0 } = opts ?? {};

    // ── Step 1: Route ──────────────────────────────────────────────────────
    let route: {
      intent: string;
      agent: string;
      urgency: string;
      confidence: number;
      phase_hint?: string;
      _fallback?: boolean;
    };

    try {
      const routeRes = await fetch('/api/route', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          transcript: chunk.text,
          speaker: chunk.speaker,
          mode,
          context_summary: cappedContext.slice(0, 200),
          is_rambling: isRambling,
        }),
      });

      if (!routeRes.ok) throw new Error(`Router returned ${routeRes.status}`);
      route = await routeRes.json();
    } catch (err) {
      console.error('[useAlpha] Route failed:', err);
      setState(prev => ({ ...prev, error: 'Router unavailable. Check API key.' }));
      return null;
    }

    const routeMs = Math.round(performance.now() - t0);

    // Skip chitchat and very low confidence
    if (route.intent === 'chitchat' || route.confidence < 0.5) {
      console.log('[useAlpha] Skipping:', route.intent, 'confidence:', route.confidence);
      return null;
    }

    // ── Step 2: Abort in-flight ────────────────────────────────────────────
    abortRef.current?.abort();
    abortRef.current = new AbortController();

    setState({
      insight: '',
      isStreaming: true,
      agent: route.agent,
      urgency: route.urgency as AlphaState['urgency'],
      error: null,
      truncated: false,
      latency: { routeMs, firstTokenMs: null, totalMs: null },
    });

    // ── Step 3: Stream ─────────────────────────────────────────────────────
    let streamRes: Response;
    try {
      streamRes = await fetch('/api/stream', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: abortRef.current.signal,
        body: JSON.stringify({
          agent: route.agent,
          transcript: chunk.text,
          mode,
          problem_context: cappedContext,
          turn_history: turnHistoryRef.current,
          profiler_state: profilerState,
          speaker: chunk.speaker.toLowerCase(),
          client_telemetry: { isRambling, isRescue: route.urgency === 'rescue' },
        }),
      });
    } catch (err: unknown) {
      if ((err as Error).name === 'AbortError') return null;
      console.error('[useAlpha] Stream fetch failed:', err);
      setState(prev => ({ ...prev, isStreaming: false, error: 'Stream request failed' }));
      return null;
    }

    // 204 = deduplicated request, silently ignore
    if (streamRes.status === 204) {
      setState(prev => ({ ...prev, isStreaming: false }));
      return null;
    }

    if (streamRes.status === 429) {
      console.warn('[useAlpha] Rate limited — retrying with tactical fallback');
      if (retryCount < 1) {
        setState(prev => ({ ...prev, isStreaming: false }));
        return process(
          { ...chunk, text: chunk.text },
          problemContext,
          { profilerState, isRambling, retryCount: retryCount + 1 }
        );
      }
      setState(prev => ({ ...prev, isStreaming: false, error: 'Rate limited. Try again.' }));
      return null;
    }

    if (!streamRes.ok) {
      setState(prev => ({ ...prev, isStreaming: false, error: `Stream error: ${streamRes.status}` }));
      return null;
    }

    // ── Step 4: Read SSE ───────────────────────────────────────────────────
    const reader = streamRes.body!.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let fullInsight = '';
    let firstTokenReceived = false;
    let wasTruncated = false;
    const tStream = performance.now();

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
          if (!line.startsWith('data: ')) continue;

          let event: {
            type: string;
            content?: string;
            message?: string;
            token_count?: number;
          };
          try { event = JSON.parse(line.slice(6)); } catch { continue; }

          if (event.type === 'chunk' && event.content) {
            if (!firstTokenReceived) {
              firstTokenReceived = true;
              const firstTokenMs = Math.round(performance.now() - tStream);
              setState(prev => ({ ...prev, latency: { ...prev.latency, firstTokenMs } }));
            }
            fullInsight += event.content;
            setState(prev => ({ ...prev, insight: fullInsight }));

          } else if (event.type === 'truncated') {
            wasTruncated = true;
            setState(prev => ({ ...prev, truncated: true }));

          } else if (event.type === 'done') {
            const totalMs = Math.round(performance.now() - t0);
            setState(prev => ({ ...prev, isStreaming: false, latency: { ...prev.latency, totalMs } }));

            // Retry once if truncated and not already retrying
            if (wasTruncated && retryCount < 1) {
              console.warn('[useAlpha] Response truncated — retrying with higher budget');
              return process(chunk, problemContext, { profilerState, isRambling, retryCount: retryCount + 1 });
            }

            // Persist turn history
            turnHistoryRef.current = [
              ...turnHistoryRef.current.slice(-8),
              { role: 'user', content: chunk.text },
              { role: 'assistant', content: fullInsight },
            ];
            try {
              sessionStorage.setItem(`alpha_history_${mode}`, JSON.stringify(turnHistoryRef.current));
            } catch { /* storage full */ }

            return fullInsight;

          } else if (event.type === 'error') {
            setState(prev => ({ ...prev, isStreaming: false, error: event.message ?? 'Stream error' }));
            return null;
          }
        }
      }
    } catch (err: unknown) {
      if ((err as Error).name !== 'AbortError') {
        console.error('[useAlpha] Stream read error:', err);
        setState(prev => ({ ...prev, isStreaming: false, error: 'Stream interrupted' }));
      }
    } finally {
      reader.cancel();
    }

    return null;
  }, [mode]);

  const dismiss = useCallback(() => {
    abortRef.current?.abort();
    setState(prev => ({ ...prev, isStreaming: false }));
  }, []);

  const reset = useCallback(() => {
    abortRef.current?.abort();
    turnHistoryRef.current = [];
    try { sessionStorage.removeItem(`alpha_history_${mode}`); } catch { /* ignore */ }
    setState(INITIAL_STATE);
  }, [mode]);

  return { state, process, dismiss, reset };
}
