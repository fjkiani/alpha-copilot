/**
 * Alpha Copilot v2 — Multi-agent orchestration
 *
 * Architecture:
 *   useOrchestrator → /api/preflight → /api/conductor → /api/answer|code|rescue|pivot
 *   /api/monitor runs in parallel with candidate speaking
 *
 * No resume injection. No knowledge base. No hardcoded context.
 * Session state lives in useOrchestrator (in-memory, no DB).
 */
'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { useOrchestrator } from '@/hooks/useOrchestrator';
import { useTranscription } from '@/hooks/useTranscription';
import type { SpeakerRole } from '@/hooks/useTranscriptProcessor';
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
import HotkeyOverlay from '@/components/HotkeyOverlay';
import { ModeSelector } from '@/components/ModeSelector';
import HUDResponse from '@/components/hud/HUDResponse';

type Mode = 'interview' | 'sales' | 'demo';

// ── Phase banner ──────────────────────────────────────────────────────────────
function PhaseBanner({ phase }: { phase: string }) {
  return (
    <div className="px-4 py-1.5 bg-cyan-950/60 border-b border-cyan-800 text-xs text-cyan-400 font-mono flex items-center gap-2 animate-pulse">
      <span>Phase transition →</span>
      <span className="font-bold uppercase tracking-widest">{phase}</span>
    </div>
  );
}

// ── Pivot interrupt banner ────────────────────────────────────────────────────
function PivotBanner({
  parsed,
  onDismiss,
}: {
  parsed: ReturnType<typeof parseHUDSections>;
  onDismiss: () => void;
}) {
  if (!parsed) return null;
  return (
    <div className="mx-4 mt-2 bg-yellow-950/80 border border-yellow-700 rounded-xl p-4 space-y-2">
      <div className="flex items-center gap-2">
        <span className="text-yellow-400 text-sm font-bold uppercase tracking-widest">Pivot</span>
        <button onClick={onDismiss} className="ml-auto text-yellow-700 hover:text-yellow-500 text-xs">✕</button>
      </div>
      {parsed.stop && (
        <p className="text-yellow-300 text-sm">{parsed.stop}</p>
      )}
      {parsed.sayNow && (
        <div className="bg-yellow-900/40 rounded-lg p-3">
          <p className="text-xs text-yellow-600 uppercase tracking-wider mb-1">Say this now</p>
          <p className="text-white font-medium">{parsed.sayNow}</p>
        </div>
      )}
      {parsed.landHere && (
        <p className="text-xs text-yellow-700">Land on: {parsed.landHere}</p>
      )}
    </div>
  );
}

// ── Rescue overlay ────────────────────────────────────────────────────────────
// Rendered at JSX root — outside all scroll/overflow ancestors.
// rawText is shown immediately during streaming before [RESCUE] header arrives.
// parsed sections are shown once the model outputs the structured headers.
function RescueOverlay({
  parsed,
  rawText,
  isStreaming,
  onDismiss,
}: {
  parsed: ReturnType<typeof parseHUDSections>;
  rawText: string;
  isStreaming: boolean;
  onDismiss: () => void;
}) {
  // Strip section headers from raw text for the fallback display
  const cleanRaw = rawText
    .replace(/\[RESCUE\]/gi, '')
    .replace(/\[FULL ANSWER\]/gi, '')
    .replace(/\[CODE\]/gi, '')
    .replace(/\[PIVOT\]/gi, '')
    .trim();

  const hasStructured = parsed?.phase === 'rescue' && (parsed.rescue || parsed.fullAnswer);

  return (
    <div className="fixed inset-0 z-50 bg-zinc-950/97 flex flex-col items-center justify-center p-8 backdrop-blur-sm">
      <div className="max-w-2xl w-full space-y-5">

        {/* Header */}
        <div className="flex items-center gap-3">
          <span className="text-red-500 text-xl">🆘</span>
          <span className="text-red-400 text-xs font-semibold uppercase tracking-widest">Rescue Mode</span>
          {isStreaming && (
            <span className="ml-auto text-xs text-green-500 animate-pulse font-mono">generating...</span>
          )}
          <button
            onClick={onDismiss}
            className="ml-auto text-zinc-600 hover:text-zinc-400 text-xs px-2 py-1 rounded"
          >
            ESC
          </button>
        </div>

        {/* Structured view — shown once [RESCUE] header arrives */}
        {hasStructured ? (
          <>
            {parsed?.rescue && (
              <div className="bg-red-950/60 border border-red-700 rounded-xl p-5">
                <p className="text-xs text-red-500 uppercase tracking-wider mb-2 font-semibold">Say this</p>
                <p className="text-white text-xl font-bold leading-snug">{parsed.rescue}</p>
              </div>
            )}

            {parsed?.fullAnswer && (
              <div className="bg-zinc-900 border border-zinc-700 rounded-xl p-5">
                <p className="text-xs text-zinc-500 uppercase tracking-wider mb-2">Full answer</p>
                <p className="text-zinc-200 text-base leading-relaxed">{parsed.fullAnswer}</p>
              </div>
            )}

            {parsed?.rescueCode && (
              <div className="bg-zinc-900 border border-zinc-700 rounded-xl p-4">
                <p className="text-xs text-zinc-500 uppercase tracking-wider mb-2">Code</p>
                <pre className="text-green-400 text-sm overflow-x-auto whitespace-pre-wrap">{parsed.rescueCode}</pre>
              </div>
            )}

            {parsed?.pivot && (
              <div className="border-l-2 border-zinc-700 pl-4">
                <p className="text-xs text-zinc-500 uppercase tracking-wider mb-1">Then pivot to</p>
                <p className="text-zinc-300 text-sm">{parsed.pivot}</p>
              </div>
            )}
          </>
        ) : (
          /* Raw streaming fallback — shown immediately while model is generating */
          <div className="bg-zinc-900 border border-zinc-700 rounded-xl p-5 min-h-[120px]">
            {cleanRaw ? (
              <p className="text-zinc-200 text-base leading-relaxed whitespace-pre-wrap">{cleanRaw}</p>
            ) : (
              <div className="space-y-3 animate-pulse">
                <div className="h-5 bg-zinc-800 rounded w-3/4" />
                <div className="h-5 bg-zinc-800 rounded w-full" />
                <div className="h-5 bg-zinc-800 rounded w-2/3" />
              </div>
            )}
          </div>
        )}

        <p className="text-xs text-zinc-700 text-center">
          {isStreaming ? 'Generating rescue...' : 'Press SPACE or ESC to dismiss'}
        </p>

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

// ── Briefing panel ────────────────────────────────────────────────────────────
function BriefingPanel({ briefing }: { briefing: string }) {
  const [open, setOpen] = useState(true);
  if (!briefing) return null;
  return (
    <div className="mx-4 mt-3 bg-zinc-900 border border-zinc-700 rounded-xl overflow-hidden">
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full px-4 py-2 flex items-center gap-2 text-xs text-zinc-400 hover:text-zinc-200 transition-colors"
      >
        <span className="text-cyan-600">◆</span>
        <span className="uppercase tracking-widest font-semibold">Role Briefing</span>
        <span className="ml-auto">{open ? '▲' : '▼'}</span>
      </button>
      {open && (
        <div className="px-4 pb-4">
          <p className="text-zinc-300 text-sm leading-relaxed">{briefing}</p>
        </div>
      )}
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function AlphaPage() {
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
  const [showHUD, setShowHUD] = useState(true);
  const [showHotkeys, setShowHotkeys] = useState(false);
  const [sessionStartTime, setSessionStartTime] = useState<number | null>(null);

  const toggleCapability = useCallback((key: keyof Capabilities) => {
    setCapabilities(prev => ({ ...prev, [key]: !prev[key] }));
  }, []);

  // ── Orchestrator ───────────────────────────────────────────────────────────
  const orchestrator = useOrchestrator();

  // ── Bullet history (for HistoricalThread) ─────────────────────────────────
  const bulletHistoryRef = useRef<HistoryEntry[]>([]);
  const [bulletHistory, setBulletHistory] = useState<HistoryEntry[]>([]);
  const [activeQuestion, setActiveQuestion] = useState('');
  const [followUp, setFollowUp] = useState('');
  const [followUpLoading, setFollowUpLoading] = useState(false);

  // When orchestrator completes a response, add to history
  useEffect(() => {
    if (!orchestrator.isStreaming && orchestrator.hudRaw && orchestrator.hudParsed) {
      const entry: HistoryEntry = {
        question: activeQuestion,
        rawResponse: orchestrator.hudRaw,
        bullets: orchestrator.hudRaw.split('\n').filter(Boolean),
        timestamp: Date.now(),
        latency: 0,
        meta: {
          agent: orchestrator.status,
          urgency: 'normal',
          firstTokenMs: undefined,
          truncated: false,

          timestamp: Date.now(),
          latencyMs: 0,
        },
      };
      bulletHistoryRef.current = [...bulletHistoryRef.current, entry];
      setBulletHistory([...bulletHistoryRef.current]);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orchestrator.isStreaming]);

  // ── onFire — STT → orchestrator integration ────────────────────────────────
  const onFire = useCallback(
    async (text: string, speaker: SpeakerRole) => {
      if (speaker !== 'interviewer') return; // only route interviewer utterances
      setActiveQuestion(text);
      await orchestrator.submitUtterance(text);
      setActiveQuestion('');
    },
    [orchestrator]
  );

  // ── Transcription hook ─────────────────────────────────────────────────────
  const {
    isStreaming,
    transcripts,
    partialText,
    metrics,
    status: transcriptStatus,
    error: transcriptError,
    held,
    isPaused,
    speakingStartRef,
    start,
    stop,
    pause,
    resume,
    emergencyRescue,
    flushActiveContext,
  } = useTranscription(capabilities, sessionContext, onFire, {
    rawResponse: orchestrator.hudRaw,
    copilotLatency: 0,
    bulletHistory,
    activeQuestion,
    copilotFiringRef: { current: orchestrator.isStreaming },
    lastCopilotOutputRef: { current: orchestrator.hudRaw },
    cancelInFlight: () => {},
    flushHistory: () => {
      if (bulletHistoryRef.current.length > 0) {
        bulletHistoryRef.current = bulletHistoryRef.current.slice(0, -1);
        setBulletHistory([...bulletHistoryRef.current]);
      }
    },
  });

  // Feed candidate transcript to monitor
  const monitorDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (!isStreaming || !partialText) return;
    if (monitorDebounceRef.current) clearTimeout(monitorDebounceRef.current);
    monitorDebounceRef.current = setTimeout(() => {
      const speakingSeconds = speakingStartRef.current
        ? Math.round((Date.now() - speakingStartRef.current) / 1000)
        : 0;
      orchestrator.submitTranscript(partialText, speakingSeconds);
    }, 3000); // debounce 3s — don't hammer monitor
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [partialText, isStreaming]);

  // Preflight on START
  const handleStart = useCallback(async () => {
    start();
    setSessionStartTime(Date.now());
    const context = sessionContext
      ? sessionContext.prompt ?? ''
      : 'General software engineering interview';
    await orchestrator.startSession(context);
  }, [start, sessionContext, orchestrator]);

  const handleStop = useCallback(() => {
    stop();
    setSessionStartTime(null);
  }, [stop]);

  // ── Follow-up generator ────────────────────────────────────────────────────
  const generateFollowUp = useCallback(async () => {
    setFollowUpLoading(true);
    setFollowUp('');
    try {
      const res = await fetch('/api/followup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ history: bulletHistory }),
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
      setFollowUp(`Error: ${(e as Error).message}`);
    } finally {
      setFollowUpLoading(false);
    }
  }, [bulletHistory]);

  const copyFollowUp = useCallback(() => {
    navigator.clipboard.writeText(followUp).catch(() => {});
  }, [followUp]);

  const copyCurrentHUD = useCallback(() => {
    const latest = bulletHistoryRef.current[bulletHistoryRef.current.length - 1];
    if (!latest) return;
    navigator.clipboard.writeText(`Q: ${latest.question}\n\n${latest.rawResponse}`).catch(() => {});
  }, []);

  // ── Mode change ────────────────────────────────────────────────────────────
  const handleModeChange = useCallback((m: Mode) => {
    if (isStreaming) stop();
    orchestrator.reset();
    bulletHistoryRef.current = [];
    setBulletHistory([]);
    setMode(m);
  }, [isStreaming, stop, orchestrator]);

  // ── Auto-scroll ────────────────────────────────────────────────────────────
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
  }, [bulletHistory, orchestrator.hudRaw, partialText]);

  // ── Keyboard ───────────────────────────────────────────────────────────────
  const stealthTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    const inInput = e.target instanceof HTMLInputElement
      || e.target instanceof HTMLTextAreaElement
      || (e.target as HTMLElement).isContentEditable;

    if (e.key === 'Escape') {
      if (showHotkeys) { setShowHotkeys(false); return; }
      if (orchestrator.rescueActive) { orchestrator.dismissRescue(); return; }
      if (orchestrator.pivotActive) { orchestrator.dismissPivot(); return; }
      setCoverMode(m => !m);
      return;
    }

    if (inInput) return;

    if (e.code === 'Space') {
      e.preventDefault();
      if (orchestrator.rescueActive) {
        orchestrator.dismissRescue();
      } else if (isStreaming && !orchestrator.isStreaming) {
        // SPACE = trigger rescue when streaming (candidate is speaking)
        orchestrator.triggerRescue();
      }
      return;
    }

    if (e.key === '?') { e.preventDefault(); setShowHotkeys(m => !m); return; }
    if (e.key === 'h' || e.key === 'H') { e.preventDefault(); setShowHUD(m => !m); return; }
    if (e.ctrlKey && e.key === 'c') { copyCurrentHUD(); return; }
    if ((e.code === 'Backspace' || e.code === 'Delete') && e.target === document.body) {
      e.preventDefault(); flushActiveContext(); return;
    }
  }, [showHotkeys, orchestrator, copyCurrentHUD, flushActiveContext]);

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown]);

  // ── Auto-stealth ───────────────────────────────────────────────────────────
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

  // ── Derived ────────────────────────────────────────────────────────────────
  const mergedStatus = orchestrator.isStreaming ? 'streaming'
    : orchestrator.status === 'preflight' ? 'thinking'
    : transcriptStatus;

  const isActivelyStreaming = orchestrator.isStreaming || mergedStatus === 'thinking';
  const latestQuestion = activeQuestion
    || (transcripts.length > 0 ? transcripts[transcripts.length - 1].text : null);

  if (coverMode) return <CoverPage />;

  return (
    <>
      {/* ── Root-level rescue overlay — outside all scroll/overflow ancestors ── */}
      {orchestrator.rescueActive && (
        <RescueOverlay
          parsed={orchestrator.rescueParsed}
          rawText={orchestrator.rescueRaw}
          isStreaming={orchestrator.isStreaming}
          onDismiss={orchestrator.dismissRescue}
        />
      )}

      <div className="min-h-screen bg-zinc-950 text-zinc-100 flex flex-col font-sans">
        {showHotkeys && <HotkeyOverlay onClose={() => setShowHotkeys(false)} />}

        <RamblingBanner speakingStartRef={speakingStartRef} />

        <StatusBar
          status={mergedStatus}
          isStreaming={isStreaming}
          held={held}
          profilerState={null}
          copilotLatency={0}
          turnCount={metrics.turnCount}
          currentAgent={orchestrator.status}
          sessionStartTime={sessionStartTime}
        />

        <ControlBar
          isStreaming={isStreaming}
          isPaused={isPaused}
          hasHistory={bulletHistory.length > 0}
          followUpLoading={followUpLoading}
          modesOpen={modesOpen}
          onStart={handleStart}
          onStop={handleStop}
          onPause={pause}
          onResume={resume}
          onRescue={() => orchestrator.triggerRescue()}
          onGenerateFollowUp={generateFollowUp}
          onToggleModes={() => setModesOpen(m => !m)}
        />

        {/* Phase transition banner */}
        {orchestrator.phaseChanged && (
          <PhaseBanner phase={orchestrator.phase} />
        )}

        {/* Preflight loading state */}
        {orchestrator.status === 'preflight' && (
          <div className="px-4 py-2 bg-zinc-900/60 border-b border-zinc-800 text-xs text-zinc-500 flex items-center gap-2">
            <span className="animate-spin">⟳</span>
            <span>Analyzing role and building question bank...</span>
          </div>
        )}

        <CapabilityPanel
          capabilities={capabilities}
          onToggle={toggleCapability}
          isOpen={modesOpen}
          isStreaming={isStreaming}
        />

        {/* Errors */}
        {(orchestrator.error || transcriptError) && (
          <div className="mx-4 mt-3 px-4 py-3 bg-red-950/40 border border-red-800 rounded-xl text-sm text-red-300">
            {orchestrator.error || transcriptError}
          </div>
        )}

        {/* Mode + session setup */}
        <div className="px-4 pt-4 space-y-3">
          <ModeSelector mode={mode} onChange={handleModeChange} disabled={isStreaming} />
          <SessionSetup
            onContextReady={setSessionContext}
            isStreaming={isStreaming}
            sessionContext={sessionContext}
          />
        </div>

        {/* Role briefing (from preflight) */}
        {orchestrator.briefing && <BriefingPanel briefing={orchestrator.briefing} />}

        {/* Pivot interrupt banner */}
        {orchestrator.pivotActive && (
          <PivotBanner
            parsed={orchestrator.pivotParsed}
            onDismiss={orchestrator.dismissPivot}
          />
        )}

        {/* Monitor flags strip */}
        {orchestrator.monitorFlags.length > 0 && (
          <div className="mx-4 mt-2 px-3 py-1.5 bg-orange-950/40 border border-orange-900 rounded-lg text-xs text-orange-400 flex gap-3 flex-wrap">
            {orchestrator.monitorFlags.map((f, i) => (
              <span key={i} className="font-mono">{f.type}</span>
            ))}
          </div>
        )}

        {/* Scrollable thread */}
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
              rawResponse={orchestrator.hudRaw}
              partialText={partialText}
              isActive={isActivelyStreaming}
              meta={{
                agent: orchestrator.status,
                urgency: 'normal',
                firstTokenMs: undefined,
                truncated: false,
                isStreaming: orchestrator.isStreaming,
              }}
            />
          )}

          {!showHUD && isActivelyStreaming && (
            <div className="text-center text-zinc-700 text-xs py-4">HUD hidden — press H to show</div>
          )}
        </div>

        <div className="px-4 pb-4">
          <FollowUpPanel followUp={followUp} onCopy={copyFollowUp} />
        </div>
      </div>
    </>
  );
}
