/**
 * SessionSetup — Pre-start context input for dynamic keyterms & prompt generation
 * Appears before the session starts. User pastes a job description or company context.
 */
'use client';

import { useState } from 'react';

export interface SessionContext {
  keyterms: string[];
  prompt: string;
}

export default function SessionSetup({
  onContextReady,
  isStreaming,
  sessionContext,
}: {
  onContextReady: (ctx: SessionContext | null) => void;
  isStreaming: boolean;
  sessionContext: SessionContext | null;
}) {
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleGenerate = async () => {
    if (!input.trim()) return;
    setLoading(true);
    setError('');
    try {
      const res = await fetch('/api/generate-context', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ context: input }),
      });
      if (!res.ok) throw new Error(`Failed: ${res.status}`);
      const data = (await res.json()) as { keyterms?: string[]; prompt?: string; error?: string };
      if (data.error) throw new Error(data.error);
      onContextReady({
        keyterms: data.keyterms ?? [],
        prompt: data.prompt ?? 'Technical job interview between two speakers.',
      });
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  };

  if (isStreaming) return null;

  return (
    <div className="border border-zinc-800 rounded-lg p-4 space-y-3 bg-zinc-900/30">
      <div className="flex items-center gap-2">
        <span>🎯</span>
        <span className="text-sm font-semibold text-zinc-300">Session Context</span>
        {sessionContext && (
          <span className="ml-auto text-xs text-green-400">
            ✓ {sessionContext.keyterms.length} keyterms loaded
          </span>
        )}
      </div>

      {!sessionContext ? (
        <>
          <textarea
            className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-zinc-200
              outline-none focus:border-zinc-500 resize-none placeholder-zinc-600"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Paste job description or company context. LLM will generate domain-specific keyterms to boost speech recognition accuracy."
            rows={3}
          />
          <div className="flex gap-2">
            <button
              className="px-4 py-2 bg-blue-700 hover:bg-blue-600 text-white text-sm rounded-lg
                disabled:opacity-50 transition-colors"
              onClick={handleGenerate}
              disabled={loading || !input.trim()}
            >
              {loading ? 'Generating...' : '⚡ Generate Keyterms'}
            </button>
            <button
              className="px-4 py-2 bg-zinc-800 hover:bg-zinc-700 text-zinc-400 text-sm rounded-lg transition-colors"
              onClick={() => onContextReady(null)}
            >
              Skip
            </button>
          </div>
          {error && <p className="text-xs text-red-400">⚠ {error}</p>}
        </>
      ) : (
        <div className="space-y-2">
          <p className="text-xs text-zinc-500">
            <span className="text-zinc-400 font-medium">Prompt:</span> {sessionContext.prompt}
          </p>
          <div className="flex flex-wrap gap-1">
            {sessionContext.keyterms.slice(0, 12).map((t, i) => (
              <span
                key={i}
                className="px-2 py-0.5 bg-zinc-800 text-zinc-400 text-xs rounded border border-zinc-700"
              >
                {t}
              </span>
            ))}
            {sessionContext.keyterms.length > 12 && (
              <span className="text-xs text-zinc-600">
                +{sessionContext.keyterms.length - 12} more
              </span>
            )}
          </div>
          <button
            className="text-xs text-zinc-600 hover:text-zinc-400 transition-colors"
            onClick={() => onContextReady(null)}
          >
            Reset
          </button>
        </div>
      )}
    </div>
  );
}
