/**
 * ActiveTurn — HOT streaming receiver
 * Re-renders freely during LLM streaming. Sibling of HistoricalThread.
 * Its re-renders never touch the historical DOM.
 */
import ConversationTurn from './ConversationTurn';

export default function ActiveTurn({
  question,
  rawResponse,
  partialText,
  isActive,
}: {
  question: string | null;
  rawResponse: string;
  partialText: string;
  isActive: boolean;
}) {
  if (!isActive && !partialText) return null;

  return (
    <div className="space-y-2">
      {isActive && question && (
        <ConversationTurn question={question} rawResponse={rawResponse || ''} />
      )}
      {partialText && (
        <div className="px-4 py-2 bg-zinc-800/50 rounded-lg border border-zinc-700/50">
          <span className="text-sm text-zinc-400">{partialText}</span>
          <span className="inline-block w-0.5 h-4 bg-zinc-500 animate-pulse ml-0.5 align-middle" />
        </div>
      )}
    </div>
  );
}
