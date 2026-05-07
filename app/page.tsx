/**
 * Alpha Copilot — Unified Orchestrator
 *
 * Single app. AssemblyAI STT → OpenRouter LLM → HUD.
 *
 * Architecture:
 *   useTranscription (AssemblyAI WS + audio pipeline + profiler)
 *     └─ onFire → useAlpha.process (OpenRouter route → stream)
 *   useAlpha owns: rawResponse, bulletHistory, copilotLatency, activeQuestion
 *   useTranscription owns: transcripts, partialText, status, profilerState
 *
 * Keyboard shortcuts:
 *   SPACE     → SOS Rescue (handled in useTranscription)
 *   ESC       → Toggle cover mode
 *   Ctrl+Shift+S → Toggle auto-stealth
 *   Backspace/Delete → Burn active context
 *
 * Bug fixes vs v1:
 *   BUG-A: onFire no longer reads alphaState.insight (stale closure).
 *          useAlpha.process() now returns the completed insight string directly.
 *          bulletHistory is built from the return value, not from state.
 *   BUG-B: copilotFiringRef.current = true set SYNCHRONOUSLY at top of onFire,
 *          not via useEffect (which runs one render late).
 *   BUG-C: alphaState.insight removed from onFire deps — no more spurious
 *          flush recreation on every stream completion.
 */
'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { useAlpha } from '@/hooks/useAlpha';
import { useTranscription } from '@/hooks/useTranscription';
import type { SpeakerRole } from '@/hooks/useTranscriptProcessor';

import CoverPage from '@/components/CoverPage';
import RamblingBanner from '@/components/RamblingBanner';
import StatusBar from '@/components/StatusBar';
import ControlBar from '@/components/ControlBar';
import CapabilityPanel, { type Capabilities } from '@/components/CapabilityPanel';
import SessionSetup, { type SessionContext } from '@/components/SessionSetup';
import HistoricalThread from '@/components/HistoricalThread';
import ActiveTurn from '@/components/ActiveTurn';
import FollowUpPanel from '@/components/FollowUpPanel';
import { ModeSelector } from '@/components/ModeSelector';

type Mode = 'interview' | 'sales' | 'demo';

export default function AlphaPage() {
  // ── Mode & capabilities ──
  const [mode, setMode] = useState<Mode>('interview');
  const [capabilities, setCapabilities] = useState<Capabilities>({
    terminalMode: false,
    clipboardCapture: true,
    autoStealth: true,
    keyterms: true,
    profiler: true,
    autoCopilot: true,
  });
  const [modesOpen, setModesOpen] = useState(false);
  const [sessionContext, setSessionContext] = useState<SessionContext | null>(null);
  const [coverMode, setCoverMode] = useState(false);

  const toggleCapability = useCallback((key: keyof Capabilities) => {
    setCapabilities((prev) => ({ ...prev, [key]: !prev[key] }));
  }, []);

  // ── Alpha LLM hook (OpenRouter) ──
  const { state: alphaState, process, dismiss, reset: resetAlpha } = useAlpha(mode);

  // ── BUG-B FIX: copilotFiringRef set synchronously in onFire, not via useEffect ──
  // useEffect runs after render — too late to block the debounce gate from double-firing.
  // We still sync from alphaState.isStreaming for the case where process() is cancelled
  // externally (dismiss()), but the primary guard is the synchronous set in onFire.
  const copilotFiringRef = useRef(false);
  const lastCopilotOutputRef = useRef('');

  useEffect(() => {
    // Sync for external cancellation (dismiss button, pause, etc.)
    copilotFiringRef.current = alphaState.isStreaming;
  }, [alphaState.isStreaming]);

  useEffect(() => {
    if (!alphaState.isStreaming && alphaState.insight) {
      lastCopilotOutputRef.current = alphaState.insight;
    }
  }, [alphaState.isStreaming, alphaState.insight]);

  // ── Bullet history — owned here, not in useAlpha ──
  const bulletHistoryRef = useRef<Array<{
    question: string;
    bullets: string[];
    rawResponse: string;
    latency: number;
    timestamp: number;
  }>>([]);
  const [bulletHistory, setBulletHistory] = useState(bulletHistoryRef.current);

  // Active question for display during streaming
  const [activeQuestion, setActiveQuestion] = useState('');

  // ── BUG-A FIX: onFire reads insight from process() return value, not alphaState ──
  // BUG-C FIX: alphaState.insight removed from deps — no stale closure, no spurious flush reset
  const onFire = useCallback(
    async (text: string, speaker: SpeakerRole) => {
      // BUG-B FIX: set synchronously BEFORE await — blocks gate from double-firing
      copilotFiringRef.current = true;

      setActiveQuestion(text);
      const t0 = Date.now();

      // process() returns the completed insight string (see useAlpha patch below)
      const completedInsight = await process(
        { text, speaker: speaker === 'candidate' ? 'CANDIDATE' : 'INTERVIEWER', timestamp: t0 },
        ''
      );

      // BUG-A FIX: use the return value, not alphaState.insight (which is stale here)
      if (completedInsight) {
        const entry = {
          question: text,
          bullets: completedInsight.split('\n').filter(Boolean),
          rawResponse: completedInsight,
          latency: Date.now() - t0,
          timestamp: Date.now(),
        };
        bulletHistoryRef.current = [...bulletHistoryRef.current, entry];
        setBulletHistory([...bulletHistoryRef.current]);
        lastCopilotOutputRef.current = completedInsight;
      }

      setActiveQuestion('');
      // copilotFiringRef.current will be set to false by the useEffect above
      // when alphaState.isStreaming flips to false after process() completes
    },
    [process] // BUG-C FIX: alphaState.insight removed from deps
  );

  // ── Transcription hook (AssemblyAI) ──
  const {
    isStreaming,
    transcripts,
    partialText,
    metrics,
    status,
    error,
    held,
    isPaused,
    speakingStartRef,
    profilerState,
    start,
    stop,
    pause,
    resume,
    emergencyRescue,
    flushActiveContext,
  } = useTranscription(capabilities, sessionContext, onFire, {
    rawResponse: alphaState.insight,
    copilotLatency: alphaState.latency.totalMs ?? 0,
    bulletHistory,
    activeQuestion,
    copilotFiringRef,
    lastCopilotOutputRef,
    cancelInFlight: dismiss,
    flushHistory: () => {
      if (bulletHistoryRef.current.length > 0) {
        bulletHistoryRef.current = bulletHistoryRef.current.slice(0, -1);
        setBulletHistory([...bulletHistoryRef.current]);
      }
    },
  });

  // ── Follow-up generator ──
  const [followUp, setFollowUp] = useState('');
  const [followUpLoading, setFollowUpLoading] = useState(false);

  const generateFollowUp = useCallback(async () => {
    setFollowUpLoading(true);
    setFollowUp('');
    try {
      const res = await fetch('/api/followup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ history: bulletHistory, profilerState }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const reader = res.body!.getReader();
      const decoder = new TextDecoder();
      let fullText = '';
      let buffer = '';
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';
        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed.startsWith('data:')) continue;
          const jsonStr = trimmed.slice(5).trim();
          if (!jsonStr) continue;
          try {
            const event = JSON.parse(jsonStr) as { done?: boolean; token?: string; error?: string };
            if (event.done) break;
            if (event.error) throw new Error(event.error);
            if (event.token) { fullText += event.token; setFollowUp(fullText); }
          } catch { /* skip malformed */ }
        }
      }
    } catch (e) {
      setFollowUp(`⚠ Error: ${(e as Error).message}`);
    } finally {
      setFollowUpLoading(false);
    }
  }, [bulletHistory, profilerState]);

  const copyFollowUp = useCallback(() => {
    navigator.clipboard.writeText(followUp).catch(() => {
      const ta = document.createElement('textarea');
      ta.value = followUp;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
    });
  }, [followUp]);

  // ── Mode change ──
  const handleModeChange = useCallback(
    (m: Mode) => {
      if (isStreaming) stop();
      resetAlpha();
      bulletHistoryRef.current = [];
      setBulletHistory([]);
      setMode(m);
    },
    [isStreaming, stop, resetAlpha]
  );

  // ── Auto-scroll ──
  const threadRef = useRef<HTMLDivElement>(null);
  const shouldAutoScrollRef = useRef(true);

  useEffect(() => {
    const node = threadRef.current;
    if (!node) return;
    const onScroll = () => {
      const distanceFromBottom = node.scrollHeight - node.scrollTop - node.clientHeight;
      shouldAutoScrollRef.current = distanceFromBottom < 80;
    };
    node.addEventListener('scroll', onScroll, { passive: true });
    onScroll();
    return () => node.removeEventListener('scroll', onScroll);
  }, []);

  useEffect(() => {
    if (!threadRef.current) return;
    if (shouldAutoScrollRef.current) {
      threadRef.current.scrollTop = threadRef.current.scrollHeight;
    }
  }, [bulletHistory, alphaState.insight, partialText]);

  // ── Keyboard shortcuts ──
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === 'Escape') setCoverMode((m) => !m);
      if (e.ctrlKey && e.shiftKey && e.code === 'KeyS') {
        e.preventDefault();
        toggleCapability('autoStealth');
      }
      if (
        (e.code === 'Backspace' || e.code === 'Delete') &&
        e.target === document.body
      ) {
        e.preventDefault();
        flushActiveContext();
      }
    },
    [toggleCapability, flushActiveContext]
  );

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown]);

  // ── Auto-stealth ──
  useEffect(() => {
    if (!capabilities.autoStealth) return;
    const handleBlur = () => setCoverMode(true);
    const handleFocus = () => setCoverMode(false);
    const handleVis = () => setCoverMode(document.hidden);
    window.addEventListener('blur', handleBlur);
    window.addEventListener('focus', handleFocus);
    document.addEventListener('visibilitychange', handleVis);
    return () => {
      window.removeEventListener('blur', handleBlur);
      window.removeEventListener('focus', handleFocus);
      document.removeEventListener('visibilitychange', handleVis);
    };
  }, [capabilities.autoStealth]);

  useEffect(() => {
    document.title = coverMode ? 'Meeting Notes' : 'Alpha';
  }, [coverMode]);

  // ── Merged status ──
  const mergedStatus = alphaState.isStreaming ? 'streaming' : status;

  // ── Cover mode ──
  if (coverMode) return <CoverPage />;

  const isActivelyStreaming = mergedStatus === 'thinking' || mergedStatus === 'streaming';
  const latestQuestion =
    activeQuestion ||
    (transcripts.length > 0 ? transcripts[transcripts.length - 1].text : null);

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100 flex flex-col">
      <RamblingBanner speakingStartRef={speakingStartRef} />

      <StatusBar
        status={mergedStatus}
        isStreaming={isStreaming}
        held={held}
        profilerState={profilerState}
        copilotLatency={alphaState.latency.totalMs ?? 0}
        turnCount={metrics.turnCount}
      />

      <ControlBar
        isStreaming={isStreaming}
        isPaused={isPaused}
        hasHistory={bulletHistory.length > 0}
        followUpLoading={followUpLoading}
        modesOpen={modesOpen}
        onStart={start}
        onStop={stop}
        onPause={pause}
        onResume={resume}
        onRescue={emergencyRescue}
        onGenerateFollowUp={generateFollowUp}
        onToggleModes={() => setModesOpen((prev) => !prev)}
      />

      <CapabilityPanel
        capabilities={capabilities}
        onToggle={toggleCapability}
        isOpen={modesOpen}
        isStreaming={isStreaming}
      />

      {error && (
        <div className="mx-4 mt-3 px-4 py-3 bg-red-950/40 border border-red-800 rounded-lg text-sm text-red-300">
          ⚠ {error}
        </div>
      )}

      {/* Mode selector + session setup */}
      <div className="px-4 pt-4 space-y-3">
        <ModeSelector mode={mode} onChange={handleModeChange} disabled={isStreaming} />
        <SessionSetup
          onContextReady={setSessionContext}
          isStreaming={isStreaming}
          sessionContext={sessionContext}
        />
      </div>

      {/* Scrollable conversation thread */}
      <div
        ref={threadRef}
        className="flex-1 overflow-y-auto px-4 py-4 space-y-3"
      >
        {bulletHistory.length === 0 && !isActivelyStreaming && !partialText && (
          <div className="text-center text-zinc-600 text-sm py-12 space-y-2">
            <p>{isStreaming ? 'Listening... speak or play audio.' : 'Click START, then speak or play audio.'}</p>
            <p className="text-zinc-700 text-xs">HUD will appear as the interview progresses.</p>
          </div>
        )}

        {/* FROZEN during streams — React.memo prevents re-renders */}
        <HistoricalThread bulletHistory={bulletHistory} />

        {/* HOT — re-renders freely during streaming */}
        <ActiveTurn
          question={latestQuestion ?? null}
          rawResponse={alphaState.insight}
          partialText={partialText}
          isActive={isActivelyStreaming}
        />
      </div>

      {/* Latency debug strip */}
      {(alphaState.latency.routeMs || alphaState.latency.firstTokenMs) && (
        <div className="px-4 pb-2 text-xs text-zinc-700 font-mono space-x-4">
          {alphaState.latency.routeMs && <span>route: {alphaState.latency.routeMs}ms</span>}
          {alphaState.latency.firstTokenMs && (
            <span>first token: {alphaState.latency.firstTokenMs}ms</span>
          )}
          {alphaState.latency.totalMs && <span>total: {alphaState.latency.totalMs}ms</span>}
        </div>
      )}

      <div className="px-4 pb-4">
        <FollowUpPanel followUp={followUp} onCopy={copyFollowUp} />
      </div>
    </div>
  );
}
