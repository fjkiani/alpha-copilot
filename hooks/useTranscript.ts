'use client';

import { useRef, useState, useCallback } from 'react';

// Web Speech API — SpeechRecognition is not in TypeScript's lib.dom.d.ts.
// Full interface declaration required for strict mode.
interface SpeechRecognitionInstance extends EventTarget {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  maxAlternatives: number;
  onresult: ((event: SpeechRecognitionEvent) => void) | null;
  onerror: ((event: SpeechRecognitionErrorEvent) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}
interface SpeechRecognitionConstructor {
  new (): SpeechRecognitionInstance;
}
declare global {
  interface Window {
    SpeechRecognition: SpeechRecognitionConstructor;
    webkitSpeechRecognition: SpeechRecognitionConstructor;
  }
}

export type TranscriptChunk = {
  text: string;
  speaker: 'INTERVIEWER' | 'CANDIDATE';
  timestamp: number;
};

export type TranscriptError =
  | 'NOT_SUPPORTED'
  | 'PERMISSION_DENIED'
  | 'NO_SPEECH'
  | 'NETWORK';

export function useTranscript(
  onChunk: (chunk: TranscriptChunk) => void,
  speakerOverride?: 'INTERVIEWER' | 'CANDIDATE'
) {
  const [isListening, setIsListening] = useState(false);
  const [error, setError] = useState<TranscriptError | null>(null);
  const recognitionRef = useRef<SpeechRecognitionInstance | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastEmittedRef = useRef('');

  const emitChunk = useCallback((text: string) => {
    const trimmed = text.trim();
    // Don't emit duplicates or empty strings
    if (!trimmed || trimmed === lastEmittedRef.current) return;
    lastEmittedRef.current = trimmed;

    onChunk({
      text: trimmed,
      // Default INTERVIEWER (what you hear). Set speakerOverride='CANDIDATE' if capturing your own mic.
      speaker: speakerOverride ?? 'INTERVIEWER',
      timestamp: Date.now(),
    });
  }, [onChunk]);

  const start = useCallback(() => {
    setError(null);

    const SpeechRecognitionAPI =
      window.SpeechRecognition ?? window.webkitSpeechRecognition;

    if (!SpeechRecognitionAPI) {
      setError('NOT_SUPPORTED');
      return;
    }

    const recognition = new SpeechRecognitionAPI();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = 'en-US';
    recognition.maxAlternatives = 1;

    recognition.onresult = (event: SpeechRecognitionEvent) => {
      // Concatenate all results (interim + final)
      const transcript = Array.from(event.results)
        .map(r => r[0].transcript)
        .join(' ')
        .trim();

      if (!transcript) return;

      // Clear existing debounce
      if (debounceRef.current) clearTimeout(debounceRef.current);

      // Emit immediately on long chunks (≥80 chars) or after 1.5s silence
      if (transcript.length >= 80) {
        emitChunk(transcript);
      } else {
        debounceRef.current = setTimeout(() => emitChunk(transcript), 1500);
      }
    };

    recognition.onerror = (event: SpeechRecognitionErrorEvent) => {
      console.error('[useTranscript] Recognition error:', event.error);
      if (event.error === 'not-allowed') setError('PERMISSION_DENIED');
      else if (event.error === 'no-speech') setError('NO_SPEECH');
      else if (event.error === 'network') setError('NETWORK');
      setIsListening(false);
    };

    recognition.onend = () => {
      // Auto-restart if we didn't intentionally stop
      if (recognitionRef.current) {
        try { recognition.start(); } catch { /* already started */ }
      }
    };

    recognition.start();
    recognitionRef.current = recognition;
    setIsListening(true);
  }, [emitChunk]);

  const stop = useCallback(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    recognitionRef.current?.stop();
    recognitionRef.current = null;
    setIsListening(false);
  }, []);

  return { isListening, error, start, stop };
}
