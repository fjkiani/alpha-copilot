/**
 * HistoricalThread — FROZEN during streams
 * React.memo'd — only re-renders when bulletHistory.length changes.
 * During live LLM streaming this component is completely inert.
 */
import { memo } from 'react';
import ConversationTurn from './ConversationTurn';

interface HistoryEntry {
  question: string;
  rawResponse?: string;
  bullets?: string[];
  timestamp?: number;
}

function HistoricalThreadInner({ bulletHistory }: { bulletHistory: HistoryEntry[] }) {
  if (!bulletHistory || bulletHistory.length === 0) return null;

  return (
    <div className="space-y-3">
      {bulletHistory.map((h, idx) => (
        <ConversationTurn
          key={idx}
          question={h.question}
          rawResponse={h.rawResponse ?? h.bullets?.join('\n') ?? ''}
        />
      ))}
    </div>
  );
}

// Only re-render when array length changes (not during streaming)
const HistoricalThread = memo(HistoricalThreadInner, (prev, next) => {
  return prev.bulletHistory.length === next.bulletHistory.length;
});

export default HistoricalThread;
