/**
 * HistoricalThread — FROZEN during streams
 * React.memo'd — only re-renders when bulletHistory.length changes.
 */
import { memo } from 'react';
import ConversationTurn, { type TurnMeta } from './ConversationTurn';

export interface HistoryEntry {
  question: string;
  rawResponse?: string;
  bullets?: string[];
  timestamp?: number;
  latency?: number;
  meta?: TurnMeta;
}

function HistoricalThreadInner({ bulletHistory }: { bulletHistory: HistoryEntry[] }) {
  if (!bulletHistory || bulletHistory.length === 0) return null;

  return (
    <div className="space-y-3">
      {bulletHistory.map((h, idx) => (
        <ConversationTurn
          key={h.timestamp ?? idx}
          index={idx}
          question={h.question}
          rawResponse={h.rawResponse ?? h.bullets?.join('\n') ?? ''}
          meta={h.meta ?? { timestamp: h.timestamp, latencyMs: h.latency }}
        />
      ))}
    </div>
  );
}

const HistoricalThread = memo(HistoricalThreadInner, (prev, next) => {
  return prev.bulletHistory.length === next.bulletHistory.length;
});

export default HistoricalThread;
