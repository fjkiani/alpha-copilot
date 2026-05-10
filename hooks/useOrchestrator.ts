/**
 * hooks/useOrchestrator.ts
 *
 * Replaces useAlpha.ts. The single client-side orchestration layer.
 *
 * Responsibilities:
 *   1. Manage SessionState (in-memory, no DB)
 *   2. Run preflight on START
 *   3. On each new interviewer utterance:
 *      a. Call /api/conductor (fast classify)
 *      b. Route to /api/answer | /api/code | /api/rescue | /api/pivot
 *      c. Stream response to HUD
 *   4. Run /api/monitor in parallel with candidate speaking
 *   5. Fire /api/pivot if monitor raises shouldPivot
 *   6. Expose phase banner state for UI
 *   7. triggerRescue() — bypasses conductor, fires /api/rescue directly (RESCUE button)
 */
'use client';

import { useRef, useState, useCallback } from 'react';
import {
  createSession,
  mergeSessionDiff,
  serializeForTransport,
  addTurn,
  startCandidateTurn,
  appendAnswerDraft,
  buildConversationContext,
  type SessionState,
  type MonitorFlag,
  type InterviewPhase,
} from '@/lib/session';
import { parseHUDSections, type HUDParsed } from '@/lib/parseHUD';

// ── Types ─────────────────────────────────────────────────────────────────────

export type OrchestratorStatus =
  | 'idle'
  | 'preflight'
  | 'ready'
  | 'conducting'
  | 'answering'
  | 'monitoring'
  | 'pivoting'
  | 'rescuing'
  | 'error';

export interface OrchestratorState {
  status: OrchestratorStatus;
  phase: InterviewPhase;
  phaseChanged: boolean;
  hudParsed: HUDParsed | null;
  hudRaw: string;
  pivotActive: boolean;
  pivotParsed: HUDParsed | null;
  rescueActive: boolean;
  rescueParsed: HUDParsed | null;
  rescueRaw: string;           // raw accumulated rescue text — shown immediately during streaming
  monitorFlags: MonitorFlag[];
  briefing: string;
  error: string | null;
  isStreaming: boolean;
}

export interface OrchestratorActions {
  startSession: (context: string) => Promise<void>;
  submitUtterance: (utterance: string) => Promise<void>;
  submitTranscript: (transcript: string, speakingSeconds: number) => Promise<void>;
  triggerRescue: (context?: string) => Promise<void>;  // direct rescue bypass
  dismissPivot: () => void;
  dismissRescue: () => void;
  reset: () => void;
}

// ── Hook ──────────────────────────────────────────────────────────────────────

export function useOrchestrator(): OrchestratorState & OrchestratorActions {
  const sessionRef = useRef<SessionState>(createSession());
  const abortRef = useRef<AbortController | null>(null);
  const monitorAbortRef = useRef<AbortController | null>(null);
  const pivotDismissTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const rescueDismissTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [status, setStatus] = useState<OrchestratorStatus>('idle');
  const [phase, setPhase] = useState<InterviewPhase>('preflight');
  const [phaseChanged, setPhaseChanged] = useState(false);
  const [hudRaw, setHudRaw] = useState('');
  const [hudParsed, setHudParsed] = useState<HUDParsed | null>(null);
  const [pivotActive, setPivotActive] = useState(false);
  const [pivotParsed, setPivotParsed] = useState<HUDParsed | null>(null);
  const [rescueActive, setRescueActive] = useState(false);
  const [rescueParsed, setRescueParsed] = useState<HUDParsed | null>(null);
  const [rescueRaw, setRescueRaw] = useState('');
  const [monitorFlags, setMonitorFlags] = useState<MonitorFlag[]>([]);
  const [briefing, setBriefing] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isStreaming, setIsStreaming] = useState(false);

  // ── Helpers ────────────────────────────────────────────────────────────────

  const cancelActive = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
  }, []);

  const updateSession = useCallback((diff: Partial<SessionState>) => {
    sessionRef.current = mergeSessionDiff(sessionRef.current, diff);
  }, []);

  // ── SSE stream consumer ────────────────────────────────────────────────────

  const consumeSSE = useCallback(async (
    endpoint: string,
    body: object,
    onChunk: (chunk: string, accumulated: string) => void,
    onDone: (full: string) => void,
    signal: AbortSignal
  ) => {
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal,
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`${endpoint} returned ${res.status}: ${text}`);
    }

    const reader = res.body?.getReader();
    if (!reader) throw new Error('No response body');

    const decoder = new TextDecoder();
    let accumulated = '';
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';

      for (const line of lines) {
        if (line.startsWith('data: ')) {
          const data = line.slice(6).trim();
          if (data === '[DONE]') { onDone(accumulated); return; }
          try {
            const parsed = JSON.parse(data);
            const delta = parsed?.choices?.[0]?.delta?.content ?? '';
            if (delta) {
              accumulated += delta;
              onChunk(delta, accumulated);
            }
          } catch { /* skip malformed SSE */ }
        }
      }
    }
    onDone(accumulated);
  }, []);

  // ── Rescue stream helper — shared by triggerRescue and submitUtterance ─────

  const streamRescue = useCallback(async (
    body: object,
    signal: AbortSignal
  ) => {
    setStatus('rescuing');
    setRescueActive(true);
    setRescueParsed(null);
    setRescueRaw('');
    setIsStreaming(true);

    await consumeSSE(
      '/api/rescue',
      body,
      (_chunk, accumulated) => {
        // Always update raw text immediately — shown in overlay before [RESCUE] header arrives
        setRescueRaw(accumulated);
        // Also try to parse structured sections
        const parsed = parseHUDSections(accumulated);
        if (parsed && parsed.phase === 'rescue') {
          setRescueParsed(parsed);
        }
      },
      (full) => {
        setIsStreaming(false);
        setRescueRaw(full);
        const parsed = parseHUDSections(full);
        setRescueParsed(parsed && parsed.phase === 'rescue' ? parsed : null);

        // Auto-dismiss after 10s
        if (rescueDismissTimerRef.current) clearTimeout(rescueDismissTimerRef.current);
        rescueDismissTimerRef.current = setTimeout(() => {
          setRescueActive(false);
          setRescueParsed(null);
          setRescueRaw('');
          setStatus('ready');
        }, 10000);
      },
      signal
    );
  }, [consumeSSE]);

  // ── Preflight ──────────────────────────────────────────────────────────────

  const startSession = useCallback(async (context: string) => {
    cancelActive();
    setStatus('preflight');
    setError(null);
    setHudRaw('');
    setHudParsed(null);
    sessionRef.current = createSession();

    try {
      const res = await fetch('/api/preflight', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ context }),
      });

      if (!res.ok) throw new Error(`Preflight failed: ${res.status}`);
      const data = await res.json();

      updateSession({
        phase: 'intro',
        briefing: data.briefing ?? '',
        questionBank: data.questionBank ?? [],
        phasePlan: data.phasePlan ?? [],
      });

      setBriefing(data.briefing ?? '');
      setPhase('intro');
      setStatus('ready');
    } catch (err) {
      console.error('[orchestrator] preflight error:', err);
      // Don't block the user — fall through to ready state
      setStatus('ready');
    }
  }, [cancelActive, updateSession]);

  // ── Direct rescue trigger (RESCUE button / SPACE hotkey) ──────────────────
  // Bypasses conductor entirely. Reads session context directly.

  const triggerRescue = useCallback(async (context?: string) => {
    cancelActive();

    const ctrl = new AbortController();
    abortRef.current = ctrl;

    const conversationContext = buildConversationContext(sessionRef.current, 10);
    const utterance = context
      || sessionRef.current.activeQuestion
      || 'Candidate needs full rescue — provide complete answer';

    const body = {
      session: serializeForTransport(sessionRef.current),
      utterance,
      conductorPlan: 'Emergency rescue — provide complete verbatim answer immediately',
      matchedQuestion: null,
      conversationContext,
    };

    try {
      await streamRescue(body, ctrl.signal);
    } catch (err) {
      if ((err as Error).name !== 'AbortError') {
        console.error('[orchestrator] rescue error:', err);
        setError('Rescue failed. Try again.');
        setStatus('ready');
      }
      setIsStreaming(false);
    }
  }, [cancelActive, streamRescue]);

  // ── Conductor + agent routing ──────────────────────────────────────────────

  const submitUtterance = useCallback(async (utterance: string) => {
    if (!utterance.trim()) return;
    cancelActive();

    // Record interviewer turn
    sessionRef.current = addTurn(sessionRef.current, 'interviewer', utterance);
    sessionRef.current = startCandidateTurn(sessionRef.current);
    updateSession({ activeQuestion: utterance });

    setStatus('conducting');
    setHudRaw('');
    setHudParsed(null);
    setPivotActive(false);
    setMonitorFlags([]);
    setPhaseChanged(false);
    setError(null);

    // Step 1: Conductor (fast classify)
    let conductorResult: {
      phase: InterviewPhase;
      phaseChanged: boolean;
      matchedQuestionIndex: number | null;
      agentType: string;
      conductorPlan: string;
      urgency: string;
    };

    try {
      const res = await fetch('/api/conductor', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          session: serializeForTransport(sessionRef.current),
          utterance,
        }),
      });
      conductorResult = await res.json();
    } catch {
      conductorResult = {
        phase: sessionRef.current.phase,
        phaseChanged: false,
        matchedQuestionIndex: null,
        agentType: 'answer',
        conductorPlan: 'Answer the question directly. Lead with the core mechanism.',
        urgency: 'normal',
      };
    }

    // Update phase if changed
    if (conductorResult.phaseChanged && conductorResult.phase !== sessionRef.current.phase) {
      updateSession({ phase: conductorResult.phase });
      setPhase(conductorResult.phase);
      setPhaseChanged(true);
      setTimeout(() => setPhaseChanged(false), 4000);
    }

    // Resolve matched question
    const matchedQuestion = conductorResult.matchedQuestionIndex !== null
      ? sessionRef.current.questionBank[conductorResult.matchedQuestionIndex] ?? null
      : null;

    // Step 2: Route to correct agent
    const agentType = conductorResult.urgency === 'rescue' ? 'rescue' : conductorResult.agentType;
    const isRescue = agentType === 'rescue';
    const isPivot = agentType === 'pivot';

    const ctrl = new AbortController();
    abortRef.current = ctrl;

    if (isRescue) {
      // Use shared rescue streamer
      const body = {
        session: serializeForTransport(sessionRef.current),
        utterance,
        conductorPlan: conductorResult.conductorPlan,
        matchedQuestion: matchedQuestion ? {
          question: matchedQuestion.question,
          skeleton: matchedQuestion.skeleton,
          keyMechanism: matchedQuestion.keyMechanism,
        } : null,
      };
      try {
        await streamRescue(body, ctrl.signal);
      } catch (err) {
        if ((err as Error).name !== 'AbortError') {
          setError('Rescue failed.');
          setStatus('ready');
        }
        setIsStreaming(false);
      }
      return;
    }

    const endpoint = agentType === 'code' ? '/api/code'
      : isPivot ? '/api/pivot'
      : '/api/answer';

    if (isPivot) { setStatus('pivoting'); setPivotActive(true); setPivotParsed(null); }
    else { setStatus('answering'); }

    setIsStreaming(true);

    const requestBody = {
      session: serializeForTransport(sessionRef.current),
      utterance,
      conductorPlan: conductorResult.conductorPlan,
      matchedQuestion: matchedQuestion ? {
        question: matchedQuestion.question,
        skeleton: matchedQuestion.skeleton,
        keyMechanism: matchedQuestion.keyMechanism,
      } : null,
      ...(isPivot ? {
        pivotReason: conductorResult.conductorPlan,
        transcript: sessionRef.current.answerDraft,
        flags: sessionRef.current.monitorFlags.map(f => f.type),
      } : {}),
    };

    try {
      await consumeSSE(
        endpoint,
        requestBody,
        (_chunk, accumulated) => {
          if (isPivot) {
            const parsed = parseHUDSections(accumulated);
            setPivotParsed(parsed);
          } else {
            setHudRaw(accumulated);
            const parsed = parseHUDSections(accumulated);
            setHudParsed(parsed);
          }
        },
        (full) => {
          setIsStreaming(false);
          setStatus('ready');

          if (isPivot) {
            const parsed = parseHUDSections(full);
            setPivotParsed(parsed);
            if (pivotDismissTimerRef.current) clearTimeout(pivotDismissTimerRef.current);
            pivotDismissTimerRef.current = setTimeout(() => {
              setPivotActive(false);
              setPivotParsed(null);
            }, 5000);
          } else {
            setHudRaw(full);
            setHudParsed(parseHUDSections(full));
          }

          sessionRef.current = addTurn(
            sessionRef.current,
            'candidate',
            sessionRef.current.answerDraft,
            agentType,
            full
          );
        },
        ctrl.signal
      );
    } catch (err) {
      if ((err as Error).name !== 'AbortError') {
        console.error('[orchestrator] agent error:', err);
        setError('Agent failed. Please try again.');
        setStatus('error');
      }
      setIsStreaming(false);
    }
  }, [cancelActive, updateSession, consumeSSE, streamRescue]);

  // ── Monitor ────────────────────────────────────────────────────────────────

  const submitTranscript = useCallback(async (transcript: string, speakingSeconds: number) => {
    if (!transcript.trim() || status !== 'ready') return;

    sessionRef.current = appendAnswerDraft(sessionRef.current, transcript);

    monitorAbortRef.current?.abort();
    const ctrl = new AbortController();
    monitorAbortRef.current = ctrl;

    const keyMechanism = sessionRef.current.questionBank.find(
      q => q.question === sessionRef.current.activeQuestion
    )?.keyMechanism ?? '';

    try {
      const res = await fetch('/api/monitor', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          session: serializeForTransport(sessionRef.current),
          transcript,
          speakingSeconds,
          keyMechanism,
        }),
        signal: ctrl.signal,
      });

      const data = await res.json();
      const flags: MonitorFlag[] = data.flags ?? [];

      if (flags.length > 0) {
        updateSession({ monitorFlags: [...sessionRef.current.monitorFlags, ...flags] });
        setMonitorFlags(prev => [...prev, ...flags]);
      }

      if (data.shouldPivot && !pivotActive) {
        setPivotActive(true);
        setStatus('pivoting');

        const pivotCtrl = new AbortController();
        abortRef.current = pivotCtrl;

        await consumeSSE(
          '/api/pivot',
          {
            session: serializeForTransport(sessionRef.current),
            pivotReason: data.pivotReason ?? '',
            transcript,
            flags: flags.map(f => f.type),
          },
          (_chunk, accumulated) => {
            setPivotParsed(parseHUDSections(accumulated));
          },
          (full) => {
            setPivotParsed(parseHUDSections(full));
            if (pivotDismissTimerRef.current) clearTimeout(pivotDismissTimerRef.current);
            pivotDismissTimerRef.current = setTimeout(() => {
              setPivotActive(false);
              setPivotParsed(null);
              setStatus('ready');
            }, 5000);
          },
          pivotCtrl.signal
        );
      }
    } catch (err) {
      if ((err as Error).name !== 'AbortError') {
        console.error('[monitor]', err);
      }
    }
  }, [status, pivotActive, updateSession, consumeSSE]);

  // ── Dismiss actions ────────────────────────────────────────────────────────

  const dismissPivot = useCallback(() => {
    if (pivotDismissTimerRef.current) clearTimeout(pivotDismissTimerRef.current);
    setPivotActive(false);
    setPivotParsed(null);
    if (status === 'pivoting') setStatus('ready');
  }, [status]);

  const dismissRescue = useCallback(() => {
    if (rescueDismissTimerRef.current) clearTimeout(rescueDismissTimerRef.current);
    cancelActive();
    setRescueActive(false);
    setRescueParsed(null);
    setRescueRaw('');
    setIsStreaming(false);
    if (status === 'rescuing') setStatus('ready');
  }, [status, cancelActive]);

  const reset = useCallback(() => {
    cancelActive();
    monitorAbortRef.current?.abort();
    sessionRef.current = createSession();
    setStatus('idle');
    setPhase('preflight');
    setPhaseChanged(false);
    setHudRaw('');
    setHudParsed(null);
    setPivotActive(false);
    setPivotParsed(null);
    setRescueActive(false);
    setRescueParsed(null);
    setRescueRaw('');
    setMonitorFlags([]);
    setBriefing('');
    setError(null);
    setIsStreaming(false);
  }, [cancelActive]);

  return {
    // State
    status,
    phase,
    phaseChanged,
    hudParsed,
    hudRaw,
    pivotActive,
    pivotParsed,
    rescueActive,
    rescueParsed,
    rescueRaw,
    monitorFlags,
    briefing,
    error,
    isStreaming,
    // Actions
    startSession,
    submitUtterance,
    submitTranscript,
    triggerRescue,
    dismissPivot,
    dismissRescue,
    reset,
  };
}
