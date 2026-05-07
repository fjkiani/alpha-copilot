/**
 * ConversationTurn — Single Q&A pair with tank-grade HUD response
 * Passes agent, confidence, latency, truncated to HUDResponse.
 */
import HUDResponse from './hud/HUDResponse';

export interface TurnMeta {
  agent?: string;
  urgency?: 'normal' | 'rescue' | 'override';
  confidence?: number;
  firstTokenMs?: number | null;
  truncated?: boolean;
  timestamp?: number;
  latencyMs?: number;
}

export default function ConversationTurn({
  question,
  rawResponse,
  meta,
  index,
}: {
  question: string;
  rawResponse: string;
  meta?: TurnMeta;
  index?: number;
}) {
  const timeStr = meta?.timestamp
    ? new Date(meta.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
    : null;

  return (
    <div className="border border-zinc-800 rounded-xl p-4 space-y-3 bg-zinc-900/40 animate-fade-in-up">
      {/* Question header */}
      <div className="flex gap-2 items-start">
        <span className="shrink-0 w-5 h-5 rounded bg-zinc-800 text-zinc-400 text-xs font-bold flex items-center justify-center mt-0.5">
          {index !== undefined ? index + 1 : 'Q'}
        </span>
        <p className="text-sm text-zinc-400 leading-snug flex-1">{question}</p>
        {timeStr && (
          <span className="text-xs text-zinc-700 font-mono shrink-0">{timeStr}</span>
        )}
      </div>

      {/* HUD response */}
      <div className="pl-7">
        <HUDResponse
          raw={rawResponse}
          agent={meta?.agent}
          urgency={meta?.urgency}
          confidence={meta?.confidence}
          firstTokenMs={meta?.firstTokenMs}
          truncated={meta?.truncated}
        />
      </div>

      {/* Latency footer */}
      {meta?.latencyMs && meta.latencyMs > 0 && (
        <div className="pl-7 text-xs text-zinc-700 font-mono">
          {meta.latencyMs}ms total
        </div>
      )}
    </div>
  );
}
