/**
 * useDebounceGate — Accumulates transcript turns and gates copilot firing
 *
 * Responsibilities:
 *   - Accumulate end_of_turn text fragments into a full question
 *   - Debounce timer: flush after DEBOUNCE_MS of silence
 *   - Minimum word gate: skip filler (< MIN_WORDS)
 *   - Echo detection: skip transcripts that are Alpha reading copilot output verbatim
 *   - Copilot-in-flight requeue: wait if copilot is already streaming
 */
'use client';

import { useRef, useState, useCallback } from 'react';
import type { SpeakerRole } from './useTranscriptProcessor';

const DEBOUNCE_MS = 4000;
const COPILOT_REQUEUE_MS = 2000;
const MIN_WORDS = 5;
const ECHO_THRESHOLD = 0.70;
const MIN_WORD_LEN = 6;

export interface DebounceGateHook {
  accumulate: (text: string, speaker: SpeakerRole) => void;
  flush: () => void;
  reset: () => void;
  previewText: string;
}

export function useDebounceGate({
  onFire,
  capabilitiesRef,
  copilotFiringRef,
  isStreamingRef,
  lastCopilotOutputRef,
}: {
  onFire: (text: string, speaker: SpeakerRole) => void;
  capabilitiesRef: React.MutableRefObject<Record<string, boolean>>;
  copilotFiringRef: React.MutableRefObject<boolean>;
  isStreamingRef: React.MutableRefObject<boolean>;
  lastCopilotOutputRef: React.MutableRefObject<string>;
}): DebounceGateHook {
  const accumulatedRef = useRef('');
  const speakerRef = useRef<SpeakerRole>('interviewer');
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [previewText, setPreviewText] = useState('');

  const isEcho = useCallback(
    (transcript: string): boolean => {
      const lastOutput = lastCopilotOutputRef?.current ?? '';
      if (!lastOutput || lastOutput.length < 30) return false;

      const getSignificantWords = (text: string): Set<string> =>
        new Set(
          text
            .toLowerCase()
            .split(/\s+/)
            .filter((w) => w.length >= MIN_WORD_LEN)
        );

      const transcriptWords = getSignificantWords(transcript);
      const outputWords = getSignificantWords(lastOutput);

      if (transcriptWords.size < 3) return false;

      let matchCount = 0;
      for (const word of transcriptWords) {
        if (outputWords.has(word)) matchCount++;
      }

      const similarity = matchCount / transcriptWords.size;
      if (similarity >= ECHO_THRESHOLD) {
        console.log(`[gate] ECHO DETECTED (${Math.round(similarity * 100)}%) — suppressing.`);
        return true;
      }
      return false;
    },
    [lastCopilotOutputRef]
  );

  const flush = useCallback(() => {
    const fullQuestion = accumulatedRef.current.trim();
    const speaker = speakerRef.current;

    if (copilotFiringRef.current) {
      console.log('[debounce] Copilot in-flight — re-queuing in 2s');
      timerRef.current = setTimeout(flush, COPILOT_REQUEUE_MS);
      return;
    }

    accumulatedRef.current = '';
    timerRef.current = null;
    setPreviewText('');

    if (!fullQuestion || !isStreamingRef.current) return;

    const wordCount = fullQuestion.split(/\s+/).filter((w) => w.length > 0).length;
    if (wordCount < MIN_WORDS) {
      console.log(`[gate] NOISE — ${wordCount} word(s): "${fullQuestion}" — skipping`);
      return;
    }

    if (isEcho(fullQuestion)) return;

    if (isStreamingRef.current && capabilitiesRef.current.autoCopilot) {
      console.log(`[gate] GATE_OPEN (${speaker}) — firing copilot`);
      onFire(fullQuestion, speaker);
    }
  }, [onFire, capabilitiesRef, copilotFiringRef, isStreamingRef, isEcho]);

  const accumulate = useCallback(
    (text: string, speaker: SpeakerRole = 'interviewer') => {
      const prev = accumulatedRef.current;
      accumulatedRef.current = prev ? `${prev} ${text}` : text;
      speakerRef.current = speaker;
      setPreviewText(accumulatedRef.current);

      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(flush, DEBOUNCE_MS);
    },
    [flush]
  );

  const reset = useCallback(() => {
    accumulatedRef.current = '';
    speakerRef.current = 'interviewer';
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    setPreviewText('');
  }, []);

  return { accumulate, flush, reset, previewText };
}
