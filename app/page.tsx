'use client';

import { useState, useCallback, useRef, useEffect } from 'react';
import { BrowserCheck } from '@/components/BrowserCheck';
import { ModeSelector } from '@/components/ModeSelector';
import { InsightCard } from '@/components/InsightCard';
import { useTranscript, TranscriptChunk } from '@/hooks/useTranscript';
import { useAlpha } from '@/hooks/useAlpha';

type Mode = 'interview' | 'sales' | 'demo';

export default function Home() {
  const [mode, setMode] = useState<Mode>('interview');
  const [problemContext, setProblemContext] = useState('');
  const [chunks, setChunks] = useState<TranscriptChunk[]>([]);
  const [myVoice, setMyVoice] = useState(false); // false = capturing interviewer, true = capturing own mic
  const processingRef = useRef(false);

  const { state, process, dismiss, reset } = useAlpha(mode);

  const handleChunk = useCallback(async (chunk: TranscriptChunk) => {
    setChunks(prev => [...prev.slice(-9), chunk]);

    // Prevent concurrent processing — one inference at a time
    if (processingRef.current) return;
    processingRef.current = true;
    try {
      await process(chunk, problemContext);
    } finally {
      processingRef.current = false;
    }
  }, [process, problemContext]);

  const { isListening, error: transcriptError, start, stop } = useTranscript(
    handleChunk,
    myVoice ? 'CANDIDATE' : 'INTERVIEWER'
  );

  // Keyboard shortcuts: Space = toggle listen, Esc = dismiss insight
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      // Don't fire when typing in the context input
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (e.code === 'Space') {
        e.preventDefault();
        isListening ? stop() : start();
      }
      if (e.code === 'Escape') {
        dismiss();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [isListening, start, stop, dismiss]);

  const handleModeChange = (m: Mode) => {
    if (isListening) stop();
    reset();
    setChunks([]);
    setMode(m);
  };

  return (
    <BrowserCheck>
      <main className="min-h-screen bg-zinc-950 text-zinc-100 p-8">
        <div className="max-w-2xl mx-auto space-y-6">

          {/* Header */}
          <div className="flex items-center justify-between">
            <h1 className="text-2xl font-bold tracking-tight">Alpha</h1>
            <a
              href="/api/health"
              target="_blank"
              className="text-xs text-zinc-600 hover:text-zinc-400"
            >
              health check
            </a>
          </div>

          {/* Mode selector — disabled while listening */}
          <ModeSelector mode={mode} onChange={handleModeChange} disabled={isListening} />

          {/* Problem context */}
          <input
            type="text"
            placeholder="Active problem / topic (e.g. 'Design a URL shortener')"
            value={problemContext}
            onChange={e => setProblemContext(e.target.value)}
            disabled={isListening}
            className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-4 py-3 text-sm
              outline-none focus:border-zinc-500 disabled:opacity-50 transition-colors"
          />

          {/* Speaker source toggle */}
          <div className="flex items-center gap-3 text-sm">
            <span className="text-zinc-500 text-xs">Capturing:</span>
            <button
              onClick={() => setMyVoice(false)}
              disabled={isListening}
              className={`px-3 py-1 rounded text-xs transition-colors disabled:opacity-50
                ${!myVoice ? 'bg-zinc-100 text-zinc-900 font-medium' : 'bg-zinc-800 text-zinc-400 hover:bg-zinc-700'}`}
            >
              Their voice (tab audio)
            </button>
            <button
              onClick={() => setMyVoice(true)}
              disabled={isListening}
              className={`px-3 py-1 rounded text-xs transition-colors disabled:opacity-50
                ${myVoice ? 'bg-zinc-100 text-zinc-900 font-medium' : 'bg-zinc-800 text-zinc-400 hover:bg-zinc-700'}`}
            >
              My voice (mic)
            </button>
          </div>

          {/* Controls */}
          <div className="flex gap-3 items-center">
            <button
              onClick={isListening ? stop : start}
              className={`px-6 py-3 rounded-lg font-medium transition-colors
                ${isListening
                  ? 'bg-red-600 hover:bg-red-700 text-white'
                  : 'bg-green-600 hover:bg-green-700 text-white'
                }`}
            >
              {isListening ? 'Stop' : 'Start Listening'}
            </button>

            {isListening && (
              <span className="flex items-center gap-2 text-sm text-zinc-400">
                <span className="w-2 h-2 bg-red-500 rounded-full animate-pulse" />
                Listening
              </span>
            )}

            <span className="text-xs text-zinc-700 ml-auto">
              Space = toggle · Esc = dismiss
            </span>
          </div>

          {/* Transcript error */}
          {transcriptError && (
            <div className="text-sm text-red-400 bg-red-950/30 border border-red-900 rounded-lg px-4 py-3">
              {transcriptError === 'PERMISSION_DENIED' && 'Microphone permission denied. Allow microphone access and refresh.'}
              {transcriptError === 'NO_SPEECH' && 'No speech detected. Check your microphone.'}
              {transcriptError === 'NETWORK' && 'Network error in speech recognition. Check your connection.'}
              {transcriptError === 'NOT_SUPPORTED' && 'Speech recognition not supported. Use Chrome or Edge.'}
            </div>
          )}

          {/* Live transcript */}
          <div className="bg-zinc-900 rounded-lg p-4 h-48 overflow-y-auto space-y-2">
            {chunks.length === 0 ? (
              <p className="text-zinc-600 text-sm">
                {isListening ? 'Listening... speak now.' : 'Transcript will appear here.'}
              </p>
            ) : (
              chunks.slice(-5).map((c, i) => (
                <div key={i} className="text-sm">
                  <span className="text-zinc-500 text-xs mr-2">{c.speaker}</span>
                  <span className="text-zinc-300">{c.text}</span>
                </div>
              ))
            )}
          </div>

          {/* Latency debug panel */}
          {(state.latency.routeMs || state.latency.firstTokenMs || state.latency.totalMs) && (
            <div className="text-xs text-zinc-600 font-mono space-x-4">
              {state.latency.routeMs && <span>route: {state.latency.routeMs}ms</span>}
              {state.latency.firstTokenMs && <span>first token: {state.latency.firstTokenMs}ms</span>}
              {state.latency.totalMs && <span>total: {state.latency.totalMs}ms</span>}
            </div>
          )}
        </div>

        {/* Floating insight overlay */}
        <InsightCard state={state} onDismiss={dismiss} />
      </main>
    </BrowserCheck>
  );
}
