'use client';

import { useState } from 'react';
import { AlphaState } from '@/hooks/useAlpha';

const AGENT_LABELS: Record<string, string> = {
  tactical: 'Tactical',
  code: 'Code',
  rescue: 'Rescue',
  sales: 'Sales',
};

const URGENCY_STYLES: Record<string, string> = {
  normal: 'border-zinc-700',
  rescue: 'border-red-500',
  override: 'border-yellow-400',
};

export function InsightCard({
  state,
  onDismiss,
}: {
  state: AlphaState;
  onDismiss: () => void;
}) {
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    if (!state.insight) return;
    navigator.clipboard.writeText(state.insight).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };

  if (!state.insight && !state.isStreaming) return null;

  return (
    <div
      className={`
        fixed bottom-6 right-6 w-96
        bg-zinc-900/97 backdrop-blur-sm
        border-2 rounded-xl shadow-2xl
        font-mono text-sm text-zinc-100
        transition-colors duration-200
        ${URGENCY_STYLES[state.urgency] ?? 'border-zinc-700'}
      `}
    >
      {/* Header */}
      <div className="flex items-center justify-between px-4 pt-3 pb-2 border-b border-zinc-800">
        <div className="flex items-center gap-2">
          <span className="text-xs text-zinc-400 uppercase tracking-wider">
            {AGENT_LABELS[state.agent] ?? 'Alpha'}
          </span>
          {state.isStreaming && (
            <span className="flex gap-0.5">
              {[0, 150, 300].map(delay => (
                <span
                  key={delay}
                  className="w-1 h-1 bg-green-400 rounded-full animate-bounce"
                  style={{ animationDelay: `${delay}ms` }}
                />
              ))}
            </span>
          )}
        </div>
        <div className="flex items-center gap-3">
          {state.latency.totalMs && (
            <span className="text-xs text-zinc-600">
              {state.latency.totalMs}ms
            </span>
          )}
          {state.insight && (
            <button
              onClick={handleCopy}
              className="text-zinc-600 hover:text-zinc-400 text-xs"
              title="Copy to clipboard"
            >
              {copied ? '✓' : '⎘'}
            </button>
          )}
          <button
            onClick={onDismiss}
            className="text-zinc-600 hover:text-zinc-400 text-xs"
            title="Dismiss [Esc]"
          >
            ✕
          </button>
        </div>
      </div>

      {/* Content */}
      <div className="px-4 py-3 whitespace-pre-wrap leading-relaxed">
        {state.insight}
        {state.isStreaming && (
          <span className="inline-block w-0.5 h-4 bg-zinc-400 animate-pulse ml-0.5 align-middle" />
        )}
      </div>

      {/* Error state */}
      {state.error && (
        <div className="px-4 pb-3 text-xs text-red-400">
          {state.error}
        </div>
      )}
    </div>
  );
}
