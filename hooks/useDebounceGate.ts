/**
 * useDebounceGate — Accumulates transcript turns and gates copilot firing
 *
 * Responsibilities:
 *   - Accumulate end_of_turn text fragments into a full question
 *   - Debounce timer: flush after DEBOUNCE_MS of silence
 *   - Minimum word gate: skip filler (< MIN_WORDS)
 *   - Minimum turn gate: wait for at least MIN_TURNS end_of_turn events
 *     before firing — prevents sentence-by-sentence rapid-fire during
 *     system design discussions where the interviewer pauses frequently.
 *   - Echo detection: skip transcripts that are Alpha reading copilot output verbatim
 *   - Copilot-in-flight requeue: wait if copilot is already streaming
 *
 * BUG-3 FIX (2026-05-09):
 *   - DEBOUNCE_MS raised 4000 → 5000ms (extra buffer for natural pauses)
 *   - MIN_TURNS = 2: gate only opens after ≥2 end_of_turn events have
 *     accumulated. Single-sentence pings are held until the next sentence
 *     arrives or the debounce timer fires (whichever comes first).
 *   - turnCountRef tracks accumulated turns; resets on flush/reset.
 */
'use client';

import { useRef, useState, useCallback } from 'react';
import type { SpeakerRole } from './useTranscriptProcessor';

const DEBOUNCE_MS = 5000;          // raised from 4000 — extra buffer for natural pauses
const COPILOT_REQUEUE_MS = 2000;
const MIN_WORDS = 5;
const MIN_TURNS = 2;               // NEW: require ≥2 end_of_turn events before firing
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
  const turnCountRef = useRef(0);   // NEW: tracks accumulated end_of_turn events
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
    const turns = turnCountRef.current;

    if (copilotFiringRef.current) {
      console.log('[debounce] Copilot in-flight — re-queuing in 2s');
      timerRef.current = setTimeout(flush, COPILOT_REQUEUE_MS);
      return;
    }

    // MIN_TURNS gate: if we only have 1 turn and the debounce timer fired,
    // it means the interviewer said one sentence and stopped. Hold for more
    // context unless the word count is already substantial (>= 20 words).
    const wordCount = fullQuestion.split(/\s+/).filter((w) => w.length > 0).length;
    if (turns < MIN_TURNS && wordCount < 20) {
      console.log(`[gate] HOLD — only ${turns} turn(s), ${wordCount} words — waiting for more context`);
      // Extend the timer rather than firing — give 3 more seconds
      timerRef.current = setTimeout(flush, 3000);
      return;
    }

    accumulatedRef.current = '';
    turnCountRef.current = 0;
    timerRef.current = null;
    setPreviewText('');

    if (!fullQuestion || !isStreamingRef.current) return;

    if (wordCount < MIN_WORDS) {
      console.log(`[gate] NOISE — ${wordCount} word(s): "${fullQuestion}" — skipping`);
      return;
    }

    if (isEcho(fullQuestion)) return;

    if (isStreamingRef.current && capabilitiesRef.current.autoCopilot) {
      console.log(`[gate] GATE_OPEN (${speaker}, ${turns} turns, ${wordCount} words) — firing copilot`);
      onFire(fullQuestion, speaker);
    }
  }, [onFire, capabilitiesRef, copilotFiringRef, isStreamingRef, isEcho]);

  const accumulate = useCallback(
    (text: string, speaker: SpeakerRole = 'interviewer') => {
      const prev = accumulatedRef.current;
      accumulatedRef.current = prev ? `${prev} ${text}` : text;
      speakerRef.current = speaker;
      turnCountRef.current += 1;   // NEW: count this end_of_turn event
      setPreviewText(accumulatedRef.current);

      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(flush, DEBOUNCE_MS);
    },
    [flush]
  );

  const reset = useCallback(() => {
    accumulatedRef.current = '';
    speakerRef.current = 'interviewer';
    turnCountRef.current = 0;      // NEW: reset turn counter
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    setPreviewText('');
  }, []);

  return { accumulate, flush, reset, previewText };
}
