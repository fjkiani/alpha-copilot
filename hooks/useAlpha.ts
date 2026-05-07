'use client';

import { useState, useCallback, useRef } from 'react';
import { TranscriptChunk } from '@/lib/types';

export type AlphaState = {
  insight: string;
  isStreaming: boolean;
  agent: string;
  urgency: 'normal' | 'rescue' | 'override';
  error: string | null;
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
  latency: { routeMs: null, firstTokenMs: null, totalMs: null },
};

export function useAlpha(mode: 'interview' | 'sales' | 'demo') {
  const [state, setState] = useState<AlphaState>(INITIAL_STATE);
  const abortRef = useRef<AbortController | null>(null);
  // Restore turn history from sessionStorage on mount (survives page refresh within same tab)
  const turnHistoryRef = useRef<Array<{ role: string; content: string }>>((() => {
    if (typeof window === 'undefined') return [];
    try {
      const saved = sessionStorage.getItem(`alpha_history_${mode}`);
      return saved ? JSON.parse(saved) : [];
    } catch { return []; }
  })());

  const process = useCallback(async (chunk: TranscriptChunk, problemContext: string) => {
    const t0 = performance.now();
    // Cap context consistently at 500 chars for both route and stream calls
    const cappedContext = problemContext.slice(0, 500);

    // ── Step 1: Route ──────────────────────────────────────────────────────
    let route: { intent: string; agent: string; urgency: string; confidence: number };
    try {
      const routeRes = await fetch('/api/route', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          transcript: chunk.text,
          speaker: chunk.speaker,
          mode,
          context_summary: cappedContext.slice(0, 200),
        }),
      });

      if (!routeRes.ok) {
        throw new Error(`Router returned ${routeRes.status}`);
      }

      route = await routeRes.json();
    } catch (err) {
      console.error('[useAlpha] Route failed:', err);
      setState(prev => ({ ...prev, error: 'Router unavailable. Check API key.' }));
      return;
    }

    const routeMs = Math.round(performance.now() - t0);

    // Skip chitchat and low-confidence classifications
    if (route.intent === 'chitchat' || route.confidence < 0.6) {
      console.log('[useAlpha] Skipping:', route.intent, 'confidence:', route.confidence);
      return;
    }

    // ── Step 2: Abort any in-flight stream ─────────────────────────────────
    abortRef.current?.abort();
    abortRef.current = new AbortController();

    setState({
      insight: '',
      isStreaming: true,
      agent: route.agent,
      urgency: route.urgency as AlphaState['urgency'],
      error: null,
      latency: { routeMs, firstTokenMs: null, totalMs: null },
    });

    // ── Step 3: Stream from agent ──────────────────────────────────────────
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
        }),
      });
    } catch (err: unknown) {
      if ((err as Error).name === 'AbortError') return; // user dismissed
      console.error('[useAlpha] Stream fetch failed:', err);
      setState(prev => ({ ...prev, isStreaming: false, error: 'Stream request failed' }));
      return;
    }

    // Handle 429 (rate limit on free model) — retry with paid fallback
    if (streamRes.status === 429) {
      console.warn('[useAlpha] Rate limited on free model, retrying with paid fallback');
      try {
        streamRes = await fetch('/api/stream', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          signal: abortRef.current.signal,
          body: JSON.stringify({
            agent: 'tactical', // paid fallback
            transcript: chunk.text,
            mode,
            problem_context: cappedContext,
            turn_history: turnHistoryRef.current,
          }),
        });
      } catch {
        setState(prev => ({ ...prev, isStreaming: false, error: 'Rate limited. Try again.' }));
        return;
      }
    }

    if (!streamRes.ok) {
      setState(prev => ({ ...prev, isStreaming: false, error: `Stream error: ${streamRes.status}` }));
      return;
    }

    // ── Step 4: Read SSE stream ────────────────────────────────────────────
    const reader = streamRes.body!.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let fullInsight = '';
    let firstTokenReceived = false;
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

          let event: { type: string; content?: string; message?: string };
          try {
            event = JSON.parse(line.slice(6));
          } catch {
            continue;
          }

          if (event.type === 'chunk' && event.content) {
            if (!firstTokenReceived) {
              firstTokenReceived = true;
              const firstTokenMs = Math.round(performance.now() - tStream);
              setState(prev => ({
                ...prev,
                latency: { ...prev.latency, firstTokenMs },
              }));
            }
            fullInsight += event.content;
            setState(prev => ({ ...prev, insight: fullInsight }));
          } else if (event.type === 'done') {
            const totalMs = Math.round(performance.now() - t0);
            setState(prev => ({
              ...prev,
              isStreaming: false,
              latency: { ...prev.latency, totalMs },
            }));
            // Append to turn history (keep last 5 pairs = 10 messages) and persist
            turnHistoryRef.current = [
              ...turnHistoryRef.current.slice(-8),
              { role: 'user', content: chunk.text },
              { role: 'assistant', content: fullInsight },
            ];
            try {
              sessionStorage.setItem(`alpha_history_${mode}`, JSON.stringify(turnHistoryRef.current));
            } catch { /* storage full or unavailable */ }
            return;
          } else if (event.type === 'error') {
            setState(prev => ({
              ...prev,
              isStreaming: false,
              error: event.message ?? 'Stream error',
            }));
            return;
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
  }, [mode]);

  const dismiss = useCallback(() => {
    // "Dismiss" not "Cancel" — client-side only, Nebius billing continues
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
