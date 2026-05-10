/**
 * Alpha Copilot — Tank-grade Unified Orchestrator
 *
 * Upgrades vs v1:
 * - profilerState passed to process() for KB-aware, context-injected responses
 * - Full keyboard command system (SPACE, ESC, P, H, T, R, N, B, 1/2/3, ?, Ctrl+C)
 * - Profiler panel (P key) with real-time phase detection
 * - HUD visibility toggle (H key)
 * - Force-agent keys (T=terminal, R=rescue, N=negotiation, B=behavioral)
 * - Bullet highlight mode (1/2/3 keys)
 * - Ctrl+C copies current HUD to clipboard
 * - Session start time tracked for StatusBar timer
 * - currentAgent passed to StatusBar
 * - TurnMeta (agent, confidence, latency, truncated) stored in bulletHistory
 * - HotkeyOverlay (? key)
 * - Rescue overlay dismissal (SPACE or ESC when rescue active)
 *
 * BUG-1 FIX (2026-05-09): Auto-stealth dual-signal architecture.
 *
 * BUG-3B FIX (2026-05-09): conversation_context injected into onFire.
 *
 * RESCUE MODAL FIX (2026-05-09):
 *   Root cause: the rescue overlay was rendered inside ConversationTurn →
 *   HistoricalThread → overflow-y-auto. CSS position:fixed inside an overflow
 *   ancestor is clipped — it never covered the full screen. This caused the
 *   broken partial/laggy overlay appearance.
 *
 *   Fix: rescueOverlay state drives a portal rendered as a SIBLING of the
 *   root div — completely outside any scroll/overflow container. The overlay
 *   is populated from alphaState.insight during rescue streaming, auto-dismisses
 *   4s after streaming ends (via useAlpha clearRescue), and can be dismissed
 *   immediately with SPACE or ESC.
 *
 *   HUDResponse no longer renders any fixed overlay. It is a pure inline
 *   renderer. Rescue responses in the history thread render inline via HUDRescue.
 */
'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { useAlpha } from '@/hooks/useAlpha';
import { useTranscription } from '@/hooks/useTranscription';
import type { SpeakerRole } from '@/hooks/useTranscriptProcessor';
import type { TurnMeta } from '@/components/ConversationTurn';
import { parseHUDSections } from '@/lib/parseHUD';

import CoverPage from '@/components/CoverPage';
import RamblingBanner from '@/components/RamblingBanner';
import StatusBar from '@/components/StatusBar';
import ControlBar from '@/components/ControlBar';
import CapabilityPanel, { type Capabilities } from '@/components/CapabilityPanel';
import SessionSetup, { type SessionContext } from '@/components/SessionSetup';
import HistoricalThread, { type HistoryEntry } from '@/components/HistoricalThread';
import ActiveTurn from '@/components/ActiveTurn';
import FollowUpPanel from '@/components/FollowUpPanel';
import ProfilerPanel, { detectPhaseFromTranscript } from '@/components/ProfilerPanel';
import HotkeyOverlay from '@/components/HotkeyOverlay';
import { ModeSelector } from '@/components/ModeSelector';

type Mode = 'interview' | 'sales' | 'demo';
type ForceAgent = 'terminal' | 'rescue' | 'negotiation' | 'behavioral' | null;

// ── Root-level rescue overlay ─────────────────────────────────────────────────
// Rendered as a sibling of the main div — outside all scroll/overflow containers.
// This is the ONLY place the full-screen rescue overlay is rendered.
// HUDResponse no longer renders any fixed overlay.
function RescueOverlay({
  rescue,
  pivot,
  isStreaming,
  onDismiss,
}: {
  rescue: string;
  pivot: string;
  isStreaming: boolean;
  onDismiss: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 bg-zinc-950/95 flex flex-col items-center justify-center p-8 backdrop-blur-sm">
      <div className="max-w-2xl w-full space-y-6">
        {/* Header */}
        <div className="flex items-center gap-3">
          <span className="text-red-500 text-2xl animate-pulse">🆘</span>
          <span className="text-red-400 text-sm font-semibold uppercase tracking-widest">
            Rescue Mode
          </span>
          {isStreaming && (
            <span className="ml-auto text-xs text-green-500 animate-pulse font-mono">streaming...</span>
          )}
        </div>

        {/* [RESCUE] — the exact words to say */}
        {rescue ? (
          <div className="bg-red-950/60 border border-red-700 rounded-xl p-6">
            <p className="text-white text-3xl font-bold leading-tight tracking-tight">
              {rescue}
            </p>
          </div>
        ) : (
          // Skeleton while streaming hasn't produced [RESCUE] content yet
          <div className="bg-red-950/30 border border-red-900 rounded-xl p-6 animate-pulse">
            <div className="h-8 bg-red-900/40 rounded w-3/4" />
          </div>
        )}

        {/* [THE PIVOT] */}
        {pivot && (
          <div className="border-l-2 border-zinc-700 pl-4">
            <p className="text-xs text-zinc-500 uppercase tracking-wider mb-1">Then pivot to</p>
            <p className="text-zinc-300 text-lg">{pivot}</p>
          </div>
        )}

        {/* Dismiss hint */}
        <p className="text-xs text-zinc-700 text-center">
          {isStreaming ? 'Generating...' : 'Press SPACE or ESC to dismiss'}
        </p>

        {/* Manual dismiss button */}
        {!isStreaming && (
          <div className="flex justify-center">
            <button
              onClick={onDismiss}
              className="px-6 py-2 bg-zinc-800 hover:bg-zinc-700 text-zinc-400 text-sm rounded-lg transition-colors"
            >
              Dismiss
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

export default function AlphaPage() {
  // ── Mode & capabilities ──────────────────────────────────────────────────
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

  // ── UI state ─────────────────────────────────────────────────────────────
  const [coverMode, setCoverMode] = useState(false);
  const [showProfiler, setShowProfiler] = useState(false);
  const [showHUD, setShowHUD] = useState(true);
  const [showHotkeys, setShowHotkeys] = useState(false);
  const [forceAgent, setForceAgent] = useState<ForceAgent>(null);
  const [highlightBullet, setHighlightBullet] = useState<number | null>(null);
  const [sessionStartTime, setSessionStartTime] = useState<number | null>(null);

  // ── Rescue overlay state ─────────────────────────────────────────────────
  // Driven by alphaState.urgency + alphaState.insight.
  // Active when urgency='rescue'. Dismissed by clearRescue() or SPACE/ESC.
  const [rescueOverlayActive, setRescueOverlayActive] = useState(false);

  const toggleCapability = useCallback((key: keyof Capabilities) => {
    setCapabilities(prev => ({ ...prev, [key]: !prev[key] }));
  }, []);

  // ── Alpha LLM hook ───────────────────────────────────────────────────────
  const { state: alphaState, process, dismiss, reset: resetAlpha, clearRescue } = useAlpha(mode);

  // Sync refs for gate integration (BUG-B fix: set synchronously in onFire)
  const copilotFiringRef = useRef(false);
  const lastCopilotOutputRef = useRef('');
  const forceAgentRef = useRef<ForceAgent>(null);
  forceAgentRef.current = forceAgent;

  useEffect(() => {
    copilotFiringRef.current = alphaState.isStreaming;
  }, [alphaState.isStreaming]);

  useEffect(() => {
    if (!alphaState.isStreaming && alphaState.insight) {
      lastCopilotOutputRef.current = alphaState.insight;
    }
  }, [alphaState.isStreaming, alphaState.insight]);

  // ── Rescue overlay lifecycle ─────────────────────────────────────────────
  // Open when urgency becomes 'rescue'. Close when it returns to 'normal'.
  // This is the single source of truth for overlay visibility.
  useEffect(() => {
    if (alphaState.urgency === 'rescue') {
      setRescueOverlayActive(true);
    } else {
      setRescueOverlayActive(false);
    }
  }, [alphaState.urgency]);

  // Parse rescue content live from streaming insight
  const rescueParsed = rescueOverlayActive
    ? parseHUDSections(alphaState.insight)
    : null;
  const rescueText = rescueParsed?.rescue ?? '';
  const pivotText = rescueParsed?.pivot ?? '';

  // Dismiss handler — clears both the overlay and the urgency state in useAlpha
  const handleRescueDismiss = useCallback(() => {
    clearRescue();
    setRescueOverlayActive(false);
  }, [clearRescue]);

  // ── Bullet history ───────────────────────────────────────────────────────
  const bulletHistoryRef = useRef<HistoryEntry[]>([]);
  const [bulletHistory, setBulletHistory] = useState<HistoryEntry[]>([]);
  const [activeQuestion, setActiveQuestion] = useState('');

  // profilerState ref — allows onFire to read latest value without being in deps
  const profilerStateRef = useRef<import('@/lib/buildSystemPrompt').ProfilerState | null>(null);

  // taggedTranscriptsRef bridge — allows onFire to read latest transcript lines
  const taggedTranscriptsRef = useRef<string[]>([]);

  // ── onFire — the STT→LLM integration seam ───────────────────────────────
  const onFire = useCallback(
    async (text: string, speaker: SpeakerRole) => {
      copilotFiringRef.current = true;
      setActiveQuestion(text);
      const t0 = Date.now();

      const conversationContext = taggedTranscriptsRef.current.slice(-10).join('\n');

      const completedInsight = await process(
        { text, speaker: speaker === 'candidate' ? 'CANDIDATE' : 'INTERVIEWER', timestamp: t0 },
        conversationContext,
        { profilerState: profilerStateRef.current, isRambling: false }
      );

      if (completedInsight) {
        const meta: TurnMeta = {
          agent: alphaState.agent || 'tactical',
          urgency: alphaState.urgency,
          confidence: undefined,
          firstTokenMs: alphaState.latency.firstTokenMs,
          truncated: alphaState.truncated,
          timestamp: Date.now(),
          latencyMs: Date.now() - t0,
        };
        const entry: HistoryEntry = {
          question: text,
          rawResponse: completedInsight,
          bullets: completedInsight.split('\n').filter(Boolean),
          timestamp: Date.now(),
          latency: Date.now() - t0,
          meta,
        };
        bulletHistoryRef.current = [...bulletHistoryRef.current, entry];
        setBulletHistory([...bulletHistoryRef.current]);
        lastCopilotOutputRef.current = completedInsight;
      }

      setActiveQuestion('');
    },
    [process, alphaState.agent, alphaState.urgency, alphaState.latency.firstTokenMs, alphaState.truncated]
  );

  // ── Transcription hook ───────────────────────────────────────────────────
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

  // Keep profilerStateRef in sync so onFire always reads latest value
  useEffect(() => { profilerStateRef.current = profilerState; }, [profilerState]);

  // Keep taggedTranscriptsRef in sync from transcripts array
  useEffect(() => {
    taggedTranscriptsRef.current = transcripts.map(
      (t) => `${t.speaker === 'candidate' ? 'Me' : 'Interviewer'}: ${t.text}`
    );
  }, [transcripts]);

  // Track session start time for StatusBar timer
  useEffect(() => {
    if (isStreaming && !sessionStartTime) setSessionStartTime(Date.now());
    if (!isStreaming) setSessionStartTime(null);
  }, [isStreaming, sessionStartTime]);

  // ── Follow-up generator ──────────────────────────────────────────────────
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

  // ── Copy current HUD to clipboard ────────────────────────────────────────
  const copyCurrentHUD = useCallback(() => {
    const latest = bulletHistoryRef.current[bulletHistoryRef.current.length - 1];
    if (!latest) return;
    const text = `Q: ${latest.question}\n\n${latest.rawResponse}`;
    navigator.clipboard.writeText(text).catch(() => {});
  }, []);

  // ── Mode change ──────────────────────────────────────────────────────────
  const handleModeChange = useCallback((m: Mode) => {
    if (isStreaming) stop();
    resetAlpha();
    bulletHistoryRef.current = [];
    setBulletHistory([]);
    setMode(m);
  }, [isStreaming, stop, resetAlpha]);

  // ── Profiler export ──────────────────────────────────────────────────────
  const exportProfiler = useCallback(() => {
    const data = JSON.stringify({ profilerState, transcripts: transcripts.slice(-20) }, null, 2);
    const blob = new Blob([data], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `alpha-profiler-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }, [profilerState, transcripts]);

  // ── Auto-scroll ──────────────────────────────────────────────────────────
  const threadRef = useRef<HTMLDivElement>(null);
  const shouldAutoScrollRef = useRef(true);

  useEffect(() => {
    const node = threadRef.current;
    if (!node) return;
    const onScroll = () => {
      shouldAutoScrollRef.current = node.scrollHeight - node.scrollTop - node.clientHeight < 80;
    };
    node.addEventListener('scroll', onScroll, { passive: true });
    return () => node.removeEventListener('scroll', onScroll);
  }, []);

  useEffect(() => {
    if (threadRef.current && shouldAutoScrollRef.current) {
      threadRef.current.scrollTop = threadRef.current.scrollHeight;
    }
  }, [bulletHistory, alphaState.insight, partialText]);

  // ── Keyboard command system ──────────────────────────────────────────────
  const stealthTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    const inInput = e.target instanceof HTMLInputElement
      || e.target instanceof HTMLTextAreaElement
      || (e.target as HTMLElement).isContentEditable;

    // Global: ESC always works
    if (e.key === 'Escape') {
      if (showHotkeys) { setShowHotkeys(false); return; }
      // Dismiss rescue overlay if active
      if (rescueOverlayActive) { handleRescueDismiss(); return; }
      setCoverMode(m => !m);
      return;
    }

    if (inInput) return;

    // SPACE = dismiss rescue overlay (when active)
    if (e.code === 'Space' && rescueOverlayActive) {
      e.preventDefault();
      handleRescueDismiss();
      return;
    }

    // ? = hotkey overlay
    if (e.key === '?') { e.preventDefault(); setShowHotkeys(m => !m); return; }

    // P = profiler panel
    if (e.key === 'p' || e.key === 'P') { e.preventDefault(); setShowProfiler(m => !m); return; }

    // H = toggle HUD
    if (e.key === 'h' || e.key === 'H') { e.preventDefault(); setShowHUD(m => !m); return; }

    // Force agent keys
    if (e.key === 't' || e.key === 'T') { e.preventDefault(); setForceAgent(a => a === 'terminal' ? null : 'terminal'); return; }
    if (e.key === 'r' || e.key === 'R') { e.preventDefault(); setForceAgent(a => a === 'rescue' ? null : 'rescue'); return; }
    if (e.key === 'n' || e.key === 'N') { e.preventDefault(); setForceAgent(a => a === 'negotiation' ? null : 'negotiation'); return; }
    if (e.key === 'b' || e.key === 'B') { e.preventDefault(); setForceAgent(a => a === 'behavioral' ? null : 'behavioral'); return; }

    // Bullet highlight
    if (e.key === '1') { e.preventDefault(); setHighlightBullet(h => h === 0 ? null : 0); return; }
    if (e.key === '2') { e.preventDefault(); setHighlightBullet(h => h === 1 ? null : 1); return; }
    if (e.key === '3') { e.preventDefault(); setHighlightBullet(h => h === 2 ? null : 2); return; }

    // Ctrl+C = copy HUD
    if (e.ctrlKey && e.key === 'c') { copyCurrentHUD(); return; }

    // Ctrl+Shift+S = toggle auto-stealth
    if (e.ctrlKey && e.shiftKey && e.code === 'KeyS') { e.preventDefault(); toggleCapability('autoStealth'); return; }

    // Backspace/Delete = burn context
    if ((e.code === 'Backspace' || e.code === 'Delete') && e.target === document.body) {
      e.preventDefault(); flushActiveContext(); return;
    }
  }, [showHotkeys, rescueOverlayActive, handleRescueDismiss, copyCurrentHUD, toggleCapability, flushActiveContext]);

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown]);

  // ── Auto-stealth ─────────────────────────────────────────────────────────
  // Dual-signal: Signal A = visibilitychange, Signal B = blur + mouseleave compound.
  useEffect(() => {
    if (!capabilities.autoStealth) return;

    let mouseInWindow = true;

    const handleMouseEnter = () => { mouseInWindow = true; };
    const handleMouseLeave = () => { mouseInWindow = false; };

    const handleVis = () => {
      if (document.hidden) {
        if (stealthTimerRef.current) clearTimeout(stealthTimerRef.current);
        stealthTimerRef.current = setTimeout(() => setCoverMode(true), 8000);
      } else {
        if (stealthTimerRef.current) clearTimeout(stealthTimerRef.current);
        setCoverMode(false);
      }
    };

    const handleBlur = () => {
      if (!mouseInWindow) {
        if (stealthTimerRef.current) clearTimeout(stealthTimerRef.current);
        stealthTimerRef.current = setTimeout(() => setCoverMode(true), 8000);
      }
    };

    const handleFocus = () => {
      mouseInWindow = true;
      if (stealthTimerRef.current) clearTimeout(stealthTimerRef.current);
      setCoverMode(false);
    };

    document.addEventListener('visibilitychange', handleVis);
    document.addEventListener('mouseenter', handleMouseEnter);
    document.addEventListener('mouseleave', handleMouseLeave);
    window.addEventListener('blur', handleBlur);
    window.addEventListener('focus', handleFocus);

    return () => {
      if (stealthTimerRef.current) clearTimeout(stealthTimerRef.current);
      document.removeEventListener('visibilitychange', handleVis);
      document.removeEventListener('mouseenter', handleMouseEnter);
      document.removeEventListener('mouseleave', handleMouseLeave);
      window.removeEventListener('blur', handleBlur);
      window.removeEventListener('focus', handleFocus);
    };
  }, [capabilities.autoStealth]);

  useEffect(() => {
    document.title = coverMode ? 'Meeting Notes' : 'Alpha';
  }, [coverMode]);

  // ── Derived state ────────────────────────────────────────────────────────
  const mergedStatus = alphaState.isStreaming ? 'streaming' : status;
  const isActivelyStreaming = mergedStatus === 'thinking' || mergedStatus === 'streaming';
  const latestQuestion = activeQuestion
    || (transcripts.length > 0 ? transcripts[transcripts.length - 1].text : null);

  const realtimePhase = detectPhaseFromTranscript(transcripts);

  const forceAgentLabel: Record<NonNullable<ForceAgent>, string> = {
    terminal: 'T TERMINAL',
    rescue: 'R RESCUE',
    negotiation: 'N NEGOTIATE',
    behavioral: 'B BEHAVIORAL',
  };

  if (coverMode) return <CoverPage />;

  return (
    <>
      {/* ── Root-level rescue overlay portal ──────────────────────────────
          Rendered OUTSIDE the main div — no scroll/overflow ancestor.
          CSS position:fixed works correctly here.
          Previously this was inside ConversationTurn → overflow-y-auto
          which clipped the fixed positioning and caused the broken overlay. */}
      {rescueOverlayActive && (
        <RescueOverlay
          rescue={rescueText}
          pivot={pivotText}
          isStreaming={alphaState.isStreaming}
          onDismiss={handleRescueDismiss}
        />
      )}

      <div className="min-h-screen bg-zinc-950 text-zinc-100 flex flex-col font-sans">
        {/* Overlays */}
        {showHotkeys && <HotkeyOverlay onClose={() => setShowHotkeys(false)} />}

        <RamblingBanner speakingStartRef={speakingStartRef} />

        <StatusBar
          status={mergedStatus}
          isStreaming={isStreaming}
          held={held}
          profilerState={profilerState}
          copilotLatency={alphaState.latency.totalMs ?? 0}
          turnCount={metrics.turnCount}
          currentAgent={alphaState.agent || undefined}
          sessionStartTime={sessionStartTime}
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
          onToggleModes={() => setModesOpen(m => !m)}
        />

        {/* Force-agent indicator */}
        {forceAgent && (
          <div className="px-4 py-1.5 bg-yellow-950/60 border-b border-yellow-800 text-xs text-yellow-400 font-mono flex items-center gap-2">
            <span className="animate-pulse">⚡</span>
            <span>Force mode: {forceAgentLabel[forceAgent]}</span>
            <button onClick={() => setForceAgent(null)} className="ml-auto text-yellow-700 hover:text-yellow-500">✕ clear</button>
          </div>
        )}

        {/* Real-time phase detection banner */}
        {realtimePhase && realtimePhase !== (profilerState?.conversation_phase ?? '') && (
          <div className="px-4 py-1 bg-zinc-900/80 border-b border-zinc-800 text-xs text-zinc-500 flex items-center gap-2">
            <span className="text-zinc-700">Phase detected:</span>
            <span className="text-cyan-600 font-mono">{realtimePhase.replace(/_/g, ' ')}</span>
          </div>
        )}

        <CapabilityPanel
          capabilities={capabilities}
          onToggle={toggleCapability}
          isOpen={modesOpen}
          isStreaming={isStreaming}
        />

        {/* Profiler panel */}
        {showProfiler && (
          <ProfilerPanel
            profilerState={profilerState}
            transcripts={transcripts}
            sessionDurationSec={metrics.sessionDuration}
            onExport={exportProfiler}
          />
        )}

        {error && (
          <div className="mx-4 mt-3 px-4 py-3 bg-red-950/40 border border-red-800 rounded-xl text-sm text-red-300">
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
        <div ref={threadRef} className="flex-1 overflow-y-auto px-4 py-4 space-y-3">
          {bulletHistory.length === 0 && !isActivelyStreaming && !partialText && (
            <div className="text-center text-zinc-700 text-sm py-16 space-y-2">
              <p className="text-zinc-500">
                {isStreaming ? 'Listening — speak or play audio.' : 'Click START, then speak or play audio.'}
              </p>
              <p className="text-xs">
                {isStreaming ? 'HUD appears after each turn.' : 'Press ? for keyboard shortcuts.'}
              </p>
            </div>
          )}

          {showHUD && <HistoricalThread bulletHistory={bulletHistory} />}

          {showHUD && (
            <ActiveTurn
              question={latestQuestion ?? null}
              rawResponse={alphaState.insight}
              partialText={partialText}
              isActive={isActivelyStreaming}
              meta={{
                agent: alphaState.agent || 'tactical',
                urgency: alphaState.urgency,
                firstTokenMs: alphaState.latency.firstTokenMs,
                truncated: alphaState.truncated,
                isStreaming: alphaState.isStreaming,
              }}
            />
          )}

          {!showHUD && isActivelyStreaming && (
            <div className="text-center text-zinc-700 text-xs py-4">HUD hidden — press H to show</div>
          )}
        </div>

        {/* Latency debug strip */}
        {(alphaState.latency.routeMs || alphaState.latency.firstTokenMs) && (
          <div className="px-4 pb-1 text-xs text-zinc-800 font-mono flex gap-4">
            {alphaState.latency.routeMs && <span>route {alphaState.latency.routeMs}ms</span>}
            {alphaState.latency.firstTokenMs && <span>first-token {alphaState.latency.firstTokenMs}ms</span>}
            {alphaState.latency.totalMs && <span>total {alphaState.latency.totalMs}ms</span>}
          </div>
        )}

        <div className="px-4 pb-4">
          <FollowUpPanel followUp={followUp} onCopy={copyFollowUp} />
        </div>
      </div>
    </>
  );
}
