/**
 * useTranscriptProcessor — Handles AssemblyAI WebSocket Turn messages
 *
 * Responsibilities:
 *   - Process interim (partial) and final (end_of_turn) transcripts
 *   - Speaker tagging using AssemblyAI's native speaker_label field
 *   - Turn counting and latency tracking
 *   - Rambling detection (speaking > 90s)
 *
 * Speaker Detection:
 *   - First non-UNKNOWN label = interviewer
 *   - Second non-UNKNOWN label = candidate
 *   - "UNKNOWN" inherits lastSpeakerRoleRef
 */
'use client';

import { useRef, useState, useCallback } from 'react';

export type SpeakerRole = 'interviewer' | 'candidate';

export interface TranscriptEntry {
  text: string;
  id: number;
  latency: number;
  speaker: SpeakerRole;
  speakerLabel: string | null;
  languageCode: string | null;
  turnDurationMs: number | null;
  wordCount: number;
}

export interface TranscriptMetrics {
  turnCount: number;
  avgLatency: number;
  sessionDuration: number;
}

export interface TranscriptProcessorHook {
  processMessage: (msg: Record<string, unknown>) => void;
  startSession: () => void;
  stopSession: () => void;
  resetAll: () => void;
  transcripts: TranscriptEntry[];
  partialText: string;
  setPartialText: (t: string) => void;
  metrics: TranscriptMetrics;
  taggedTranscriptsRef: React.MutableRefObject<string[]>;
  speakingStartRef: React.MutableRefObject<number | null>;
  speakerMapRef: React.MutableRefObject<Record<string, SpeakerRole>>;
  lastSpeakerRoleRef: React.MutableRefObject<SpeakerRole | null>;
}

export function useTranscriptProcessor({
  onEndOfTurn,
}: {
  onEndOfTurn: (text: string, speaker: SpeakerRole) => void;
}): TranscriptProcessorHook {
  const [transcripts, setTranscripts] = useState<TranscriptEntry[]>([]);
  const [partialText, setPartialText] = useState('');
  const [metrics, setMetrics] = useState<TranscriptMetrics>({
    turnCount: 0,
    avgLatency: 0,
    sessionDuration: 0,
  });

  const turnStartRef = useRef<number | null>(null);
  const turnCountRef = useRef(0);
  const latenciesRef = useRef<number[]>([]);
  const taggedTranscriptsRef = useRef<string[]>([]);
  const speakingStartRef = useRef<number | null>(null);
  const sessionStartRef = useRef<number | null>(null);
  const sessionIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const speakerMapRef = useRef<Record<string, SpeakerRole>>({});
  const interviewerLabelRef = useRef<string | null>(null);
  const candidateLabelRef = useRef<string | null>(null);
  const lastSpeakerRoleRef = useRef<SpeakerRole | null>(null);

  const updateMetrics = useCallback(() => {
    const lats = latenciesRef.current;
    const avg = lats.length > 0 ? lats.reduce((a, b) => a + b, 0) / lats.length : 0;
    setMetrics({
      avgLatency: Math.round(avg),
      turnCount: turnCountRef.current,
      sessionDuration: sessionStartRef.current
        ? Math.round((Date.now() - sessionStartRef.current) / 1000)
        : 0,
    });
  }, []);

  const getSpeakerRole = useCallback((speakerLabel: string | null): SpeakerRole => {
    if (!speakerLabel) return lastSpeakerRoleRef.current ?? 'interviewer';

    if (speakerLabel === 'UNKNOWN') {
      const inherited = lastSpeakerRoleRef.current ?? 'interviewer';
      return inherited;
    }

    if (speakerMapRef.current[speakerLabel]) {
      const role = speakerMapRef.current[speakerLabel];
      lastSpeakerRoleRef.current = role;
      return role;
    }

    if (!interviewerLabelRef.current) {
      interviewerLabelRef.current = speakerLabel;
      speakerMapRef.current[speakerLabel] = 'interviewer';
      lastSpeakerRoleRef.current = 'interviewer';
      console.log(`[speaker] "${speakerLabel}" = INTERVIEWER`);
      return 'interviewer';
    }

    if (!candidateLabelRef.current) {
      candidateLabelRef.current = speakerLabel;
      speakerMapRef.current[speakerLabel] = 'candidate';
      lastSpeakerRoleRef.current = 'candidate';
      console.log(`[speaker] "${speakerLabel}" = CANDIDATE`);
      return 'candidate';
    }

    console.warn(`[speaker] Unexpected 3rd label "${speakerLabel}". Defaulting to last known.`);
    return lastSpeakerRoleRef.current ?? 'interviewer';
  }, []);

  const processMessage = useCallback(
    (msg: Record<string, unknown>) => {
      if (msg.type !== 'Turn') return;

      const transcript = (msg.transcript as string) ?? '';
      const endOfTurn = (msg.end_of_turn as boolean) ?? false;
      const speakerLabel = (msg.speaker_label as string | null) ?? null;
      const languageCode = (msg.language_code as string | null) ?? null;
      const words = (msg.words as Array<{ start: number; end: number }>) ?? [];

      const turnDurationMs =
        words.length >= 2 ? words[words.length - 1].end - words[0].start : null;

      if (!turnStartRef.current && transcript.trim()) {
        turnStartRef.current = Date.now();
      }

      if (endOfTurn && transcript.trim()) {
        turnCountRef.current += 1;
        const sttLatency = turnStartRef.current ? Date.now() - turnStartRef.current : 0;
        latenciesRef.current.push(sttLatency);
        turnStartRef.current = null;

        const speaker = getSpeakerRole(speakerLabel);
        const isCandidateSpeaking = speaker === 'candidate';

        setTranscripts((prev) => [
          ...prev,
          {
            text: transcript,
            id: Date.now(),
            latency: sttLatency,
            speaker,
            speakerLabel,
            languageCode,
            turnDurationMs,
            wordCount: words.length,
          },
        ]);

        taggedTranscriptsRef.current.push(
          `${isCandidateSpeaking ? 'Me' : 'Interviewer'}: ${transcript}`
        );

        if (isCandidateSpeaking) {
          if (!speakingStartRef.current) speakingStartRef.current = Date.now();
        } else {
          speakingStartRef.current = null;
        }

        updateMetrics();
        onEndOfTurn(transcript, speaker);
      } else if (!endOfTurn && transcript.trim()) {
        setPartialText(transcript);
      }
    },
    [onEndOfTurn, updateMetrics, getSpeakerRole]
  );

  const startSession = useCallback(() => {
    sessionStartRef.current = Date.now();
    sessionIntervalRef.current = setInterval(updateMetrics, 1000);
  }, [updateMetrics]);

  const stopSession = useCallback(() => {
    if (sessionIntervalRef.current) {
      clearInterval(sessionIntervalRef.current);
      sessionIntervalRef.current = null;
    }
    updateMetrics();
  }, [updateMetrics]);

  const resetAll = useCallback(() => {
    setTranscripts([]);
    setPartialText('');
    setMetrics({ turnCount: 0, avgLatency: 0, sessionDuration: 0 });
    turnStartRef.current = null;
    turnCountRef.current = 0;
    latenciesRef.current = [];
    taggedTranscriptsRef.current = [];
    speakingStartRef.current = null;
    sessionStartRef.current = null;
    speakerMapRef.current = {};
    interviewerLabelRef.current = null;
    candidateLabelRef.current = null;
    lastSpeakerRoleRef.current = null;
  }, []);

  return {
    processMessage,
    startSession,
    stopSession,
    resetAll,
    transcripts,
    partialText,
    setPartialText,
    metrics,
    taggedTranscriptsRef,
    speakingStartRef,
    speakerMapRef,
    lastSpeakerRoleRef,
  };
}
