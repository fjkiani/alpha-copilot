/**
 * useTranscription — Thin Orchestrator Hook
 *
 * Wires together:
 *   - useWebSocket        (AssemblyAI WS connection, reconnect)
 *   - useDebounceGate     (accumulate, word-count gate, flush timer)
 *   - useTranscriptProcessor (Turn messages, speaker tagging, metrics)
 *   - audioCapture        (mic + system audio)
 *   - profilerLoop        (60s background profiler)
 *
 * KEY INTEGRATION POINT:
 *   onFire (from debounce gate) → useAlpha.process()
 *   This is where AssemblyAI STT meets OpenRouter LLM.
 *
 * This file owns: start/stop/pause/resume lifecycle, capabilities ref,
 *   clipboard poller, brain freeze detection, SOS hotkey.
 *
 * BUG-2 FIX (2026-05-09):
 *   - emergencyRescue() NO LONGER calls stopInternal(). The WebSocket stays
 *     alive. It only cancels the in-flight LLM request and fires onFire()
 *     with the deep rescue context. The session continues uninterrupted.
 *   - triggerRescue() (auto brain-freeze) fires a SHORT rescue (mouth
 *     autocomplete). emergencyRescue() (manual RESCUE button) fires a DEEP
 *     rescue with the last 10 transcript lines for full A-Z support.
 *   - Deep rescue passes isDeepRescue=true in the onFire call so the router
 *     can select the deep rescue agent.
 */
'use client';

import { useState, useRef, useCallback, useEffect } from 'react';
import { useWebSocket } from './useWebSocket';
import { useDebounceGate } from './useDebounceGate';
import { useTranscriptProcessor, type SpeakerRole } from './useTranscriptProcessor';
import {
  captureMic,
  captureSystemAudio,
  createAudioPipeline,
  stopMediaStream,
  type AudioPipeline,
} from '@/lib/audioCapture';
import { createProfilerLoop } from '@/lib/profilerLoop';
import type { ProfilerState } from '@/lib/buildSystemPrompt';
import type { SessionContext } from '@/components/SessionSetup';
import type { Capabilities } from '@/components/CapabilityPanel';

// ── Types ──────────────────────────────────────────────────────────────────

export interface BulletHistoryEntry {
  question: string;
  bullets?: string[];
  rawResponse?: string;
  latency?: number;
  timestamp?: number;
}

export interface TranscriptionHook {
  isStreaming: boolean;
  transcripts: ReturnType<typeof useTranscriptProcessor>['transcripts'];
  partialText: string;
  rawResponse: string;
  copilotLatency: number;
  bulletHistory: BulletHistoryEntry[];
  metrics: ReturnType<typeof useTranscriptProcessor>['metrics'];
  status: string;
  error: string | null;
  held: boolean;
  isPaused: boolean;
  speakingStartRef: React.MutableRefObject<number | null>;
  profilerState: ProfilerState | null;
  activeQuestion: string;
  start: () => Promise<void>;
  stop: () => void;
  pause: () => void;
  resume: () => Promise<void>;
  emergencyRescue: () => void;
  toggleHold: () => void;
  flushActiveContext: () => void;
  triggerRescue: () => void;
}

// ── Hook ───────────────────────────────────────────────────────────────────

export function useTranscription(
  capabilities: Capabilities,
  sessionContext: SessionContext | null,
  /**
   * onFire — called when the debounce gate opens.
   * This is the integration seam: pass useAlpha.process here.
   * Signature: (text: string, speaker: SpeakerRole) => void
   */
  onFire: (text: string, speaker: SpeakerRole) => void,
  /**
   * rawResponse / copilotLatency / bulletHistory / activeQuestion
   * are owned by useAlpha and passed in for display.
   */
  alphaState: {
    rawResponse: string;
    copilotLatency: number;
    bulletHistory: BulletHistoryEntry[];
    activeQuestion: string;
    copilotFiringRef: React.MutableRefObject<boolean>;
    lastCopilotOutputRef: React.MutableRefObject<string>;
    cancelInFlight: () => void;
    flushHistory: () => void;
  }
): TranscriptionHook {
  const capabilitiesRef = useRef<Capabilities>(capabilities);
  capabilitiesRef.current = capabilities;
  const sessionContextRef = useRef<SessionContext | null>(sessionContext);
  sessionContextRef.current = sessionContext;

  // ── Shared state ──
  const [isStreaming, setIsStreaming] = useState(false);
  const [status, setStatus] = useState('idle');
  const [error, setError] = useState<string | null>(null);
  const [held, setHeld] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [profilerState, setProfilerState] = useState<ProfilerState | null>(null);

  const isStreamingRef = useRef(false);
  const heldRef = useRef(false);
  const profilerStateRef = useRef<ProfilerState | null>(null);
  const profilerTickRef = useRef(0); // BUG-07 fix: separate ref, not piggyback on profilerState
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const displayStreamRef = useRef<MediaStream | null>(null);
  const audioPipelineRef = useRef<AudioPipeline | null>(null);
  const profilerLoopRef = useRef<ReturnType<typeof createProfilerLoop> | null>(null);
  const stopRef = useRef<(() => void) | null>(null);

  // Brain freeze detection
  const lastTranscriptTimeRef = useRef(Date.now());
  const rescueFiredRef = useRef(false);
  const brainFreezeTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // ── Sub-hooks ──

  // 1. Debounce Gate — accumulates turns, gates copilot firing
  const gate = useDebounceGate({
    onFire,
    capabilitiesRef: capabilitiesRef as React.MutableRefObject<Record<string, boolean>>,
    copilotFiringRef: alphaState.copilotFiringRef,
    isStreamingRef,
    lastCopilotOutputRef: alphaState.lastCopilotOutputRef,
  });

  // 2. Transcript Processor — processes AssemblyAI Turn messages
  const transcript = useTranscriptProcessor({
    onEndOfTurn: gate.accumulate,
  });

  // 3. WebSocket message handler
  const handleMessage = useCallback(
    (msg: Record<string, unknown>) => {
      if (msg.type === 'Begin') {
        setStatus('listening');
      } else if (msg.type === 'Turn') {
        if ((msg.transcript as string)?.trim()) {
          lastTranscriptTimeRef.current = Date.now();
          rescueFiredRef.current = false;
        }
        transcript.processMessage(msg);
      } else if (msg.type === 'Termination') {
        setStatus('ended');
        if (stopRef.current) stopRef.current();
      } else if (msg.type === 'Error') {
        setError((msg.error as string) || 'Streaming error');
        if (stopRef.current) stopRef.current();
      }
    },
    [transcript]
  );

  const handleStatusChange = useCallback((wsStatus: string) => {
    if (wsStatus === 'listening') { setStatus('listening'); setError(null); }
    else if (wsStatus === 'disconnected') setStatus('disconnected');
    else if (wsStatus === 'error') setError('WebSocket connection error');
  }, []);

  const ws = useWebSocket({
    capabilitiesRef: capabilitiesRef as React.MutableRefObject<Record<string, boolean>>,
    sessionContextRef,
    onMessage: handleMessage,
    onStatusChange: handleStatusChange,
    audioPipelineRef,
  });

  // ── Clipboard Poller ──
  useEffect(() => {
    const handleCopy = async () => {
      try {
        if (!capabilitiesRef.current.clipboardCapture) return;
        if (!document.hasFocus()) return;
        const text = await navigator.clipboard.readText();
        const looksLikeCode =
          text &&
          ((text.includes('\n') && /[{}();=]/.test(text)) ||
            /^(class|def|function|const|let|var|import|export|if|for|while|return)\b/m.test(text));
        if (looksLikeCode) {
          alphaState.lastCopilotOutputRef.current = text; // reuse ref as clipboard bridge
          console.log('[clipboard] Captured code:', text.slice(0, 60) + '...');
        }
      } catch { /* ignore */ }
    };
    document.addEventListener('copy', handleCopy);
    return () => document.removeEventListener('copy', handleCopy);
  }, [alphaState.lastCopilotOutputRef]);

  // ── Cleanup on page close ──
  const wsDisconnectRef = useRef(ws.disconnect);
  wsDisconnectRef.current = ws.disconnect;
  useEffect(() => {
    const handleUnload = () => wsDisconnectRef.current();
    window.addEventListener('beforeunload', handleUnload);
    return () => {
      window.removeEventListener('beforeunload', handleUnload);
      wsDisconnectRef.current();
    };
  }, []);

  // ── Start ──
  const start = useCallback(async () => {
    setError(null);
    setIsPaused(false);
    setHeld(false);
    heldRef.current = false;
    isStreamingRef.current = true;
    gate.reset();
    transcript.setPartialText('');

    try {
      setStatus('mic');
      const micStream = await captureMic();
      mediaStreamRef.current = micStream;

      const { stream: displayStream, audioStream: systemAudioStream } =
        await captureSystemAudio();
      if (displayStream) displayStreamRef.current = displayStream;

      setStatus('auth');
      const tokenRes = await fetch('/api/token', { method: 'POST' });
      const tokenData = (await tokenRes.json()) as { token?: string; error?: string };
      if (!tokenRes.ok || !tokenData.token)
        throw new Error(tokenData.error ?? 'Failed to get auth token');

      setStatus('connecting');
      const wsInstance = await ws.connect(tokenData.token);

      const pipeline = createAudioPipeline({
        micStream,
        systemAudioStream,
        ws: wsInstance,
      });
      audioPipelineRef.current = pipeline;

      setIsStreaming(true);
      transcript.startSession();

      if (capabilitiesRef.current.profiler) {
        const profilerInst = createProfilerLoop({
          intervalMs: 60000,
          getTaggedTranscripts: () => transcript.taggedTranscriptsRef.current,
          getLastTick: () => profilerTickRef.current,
          setLastTick: (n) => { profilerTickRef.current = n; }, // BUG-07 fix
          getState: () => profilerStateRef.current,
          onUpdate: (newState) => {
            profilerStateRef.current = newState as ProfilerState;
            setProfilerState(newState as ProfilerState);
          },
        });
        profilerLoopRef.current = profilerInst;
        profilerInst.start();
      }
    } catch (err) {
      setError((err as Error).message);
      stopInternal();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ws, gate, transcript]);

  // ── Stop ──
  const stopInternal = useCallback(() => {
    isStreamingRef.current = false;
    setIsStreaming(false);
    if (profilerLoopRef.current) { profilerLoopRef.current.stop(); profilerLoopRef.current = null; }
    ws.disconnect();
    if (audioPipelineRef.current) { audioPipelineRef.current.cleanup(); audioPipelineRef.current = null; }
    stopMediaStream(mediaStreamRef.current); mediaStreamRef.current = null;
    stopMediaStream(displayStreamRef.current); displayStreamRef.current = null;
    gate.reset();
    transcript.setPartialText('');
    transcript.stopSession();
  }, [ws, gate, transcript]);

  stopRef.current = stopInternal;

  const stop = useCallback(() => {
    stopInternal();
    setIsPaused(false);
    setHeld(false);
    heldRef.current = false;
    setStatus('idle');
  }, [stopInternal]);

  const pause = useCallback(() => {
    if (!isStreamingRef.current) return;
    alphaState.cancelInFlight();
    stopInternal();
    setIsPaused(true);
    setHeld(true);
    heldRef.current = true;
    setStatus('paused');
  }, [stopInternal, alphaState]);

  const resume = useCallback(async () => {
    if (isStreamingRef.current) return;
    await start();
  }, [start]);

  const toggleHold = useCallback(() => {
    heldRef.current = !heldRef.current;
    setHeld(heldRef.current);
  }, []);

  // ── Rescue (auto brain-freeze: SHORT rescue — mouth autocomplete) ──
  // Fires automatically after 5s of candidate silence.
  // Sends the last partial sentence to the rescue agent for 5-10 word completion.
  const triggerRescue = useCallback(() => {
    if (!isStreamingRef.current) return;
    if (alphaState.copilotFiringRef.current) return;
    const partialText = gate.previewText || transcript.partialText || '';
    const lastTranscripts = transcript.transcripts.slice(-3).map((t) => t.text).join(' ');
    const rescueContext = partialText || lastTranscripts || 'Alpha is frozen mid-sentence.';
    console.log('[rescue] 🚨 AUTO RESCUE (brain-freeze) — context:', rescueContext.slice(0, 80));
    gate.reset();
    onFire(rescueContext, 'candidate');
    rescueFiredRef.current = true;
  }, [alphaState.copilotFiringRef, gate, transcript, onFire]);

  // ── Emergency Rescue (manual RESCUE button: DEEP rescue — A-Z support) ──
  // BUG-2 FIX: Does NOT call stopInternal(). WebSocket stays alive.
  // Cancels in-flight LLM, builds rich context from last 10 transcript lines,
  // fires onFire() with deep rescue context. Session continues uninterrupted.
  const emergencyRescue = useCallback(() => {
    if (!isStreamingRef.current && !alphaState.copilotFiringRef.current) return;

    // Cancel any in-flight LLM request
    alphaState.cancelInFlight();

    // Build rich context: last 10 transcript lines (tagged with speaker)
    const recentLines = transcript.transcripts
      .slice(-10)
      .map((t) => `${t.speaker === 'candidate' ? 'Me' : 'Interviewer'}: ${t.text}`)
      .join('\n');

    const partialText = gate.previewText || transcript.partialText || '';
    const rescueContext = [
      recentLines,
      partialText ? `[PARTIAL — currently saying]: ${partialText}` : '',
    ]
      .filter(Boolean)
      .join('\n\n')
      .trim() || 'Alpha needs full A-Z support — context unavailable.';

    console.log('[rescue] 🆘 DEEP RESCUE (manual) — context lines:', transcript.transcripts.length);

    // Reset gate so the rescue fires immediately without waiting for debounce
    gate.reset();

    // Fire with 'interviewer' speaker so the tactical agent (not support mode)
    // handles it — but the deep rescue prompt is selected via isDeepRescue flag
    // injected by onFire in page.tsx
    onFire(`[DEEP_RESCUE]\n${rescueContext}`, 'interviewer');
    rescueFiredRef.current = true;

    // Status stays 'listening' — WebSocket is NOT disconnected
    setStatus('listening');
  }, [alphaState, gate, transcript, onFire]);

  const flushActiveContext = useCallback(() => {
    alphaState.flushHistory();
    gate.reset();
    transcript.setPartialText('');
  }, [alphaState, gate, transcript]);

  // ── Brain Freeze Timer ──
  useEffect(() => {
    if (!isStreaming) {
      if (brainFreezeTimerRef.current) clearInterval(brainFreezeTimerRef.current);
      return;
    }
    brainFreezeTimerRef.current = setInterval(() => {
      const lastRole = transcript.lastSpeakerRoleRef?.current;
      if (lastRole !== 'candidate') return;
      if (rescueFiredRef.current) return;
      const silenceDuration = Date.now() - lastTranscriptTimeRef.current;
      if (silenceDuration >= 5000) {
        console.log(`[rescue] 🧊 BRAIN FREEZE — ${Math.round(silenceDuration / 1000)}s silence`);
        triggerRescue();
      }
    }, 1000);
    return () => { if (brainFreezeTimerRef.current) clearInterval(brainFreezeTimerRef.current); };
  }, [isStreaming, transcript, triggerRescue]);

  // ── SOS Hotkey (Spacebar) — triggers DEEP rescue ──
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.code !== 'Space') return;
      if (
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement ||
        (e.target as HTMLElement).isContentEditable
      ) return;
      if (!isStreamingRef.current) return;
      e.preventDefault();
      console.log('[rescue] 🆘 SOS HOTKEY — triggering deep rescue');
      emergencyRescue();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [emergencyRescue]);

  return {
    isStreaming,
    transcripts: transcript.transcripts,
    partialText: gate.previewText || transcript.partialText,
    rawResponse: alphaState.rawResponse,
    copilotLatency: alphaState.copilotLatency,
    bulletHistory: alphaState.bulletHistory,
    metrics: transcript.metrics,
    status,
    error,
    held,
    isPaused,
    speakingStartRef: transcript.speakingStartRef,
    profilerState,
    activeQuestion: alphaState.activeQuestion,
    start,
    stop,
    pause,
    resume,
    emergencyRescue,
    toggleHold,
    flushActiveContext,
    triggerRescue,
  };
}
