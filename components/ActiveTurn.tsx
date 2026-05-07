/**
 * ActiveTurn — HOT streaming receiver
 * Re-renders freely during LLM streaming.
 * Passes agent/urgency/confidence/firstTokenMs/truncated/isStreaming to HUDResponse.
 */
'use client';

import ConversationTurn, { type TurnMeta } from './ConversationTurn';

export default function ActiveTurn({
  question,
  rawResponse,
  partialText,
  isActive,
  meta,
}: {
  question: string | null;
  rawResponse: string;
  partialText: string;
  isActive: boolean;
  meta?: TurnMeta & { isStreaming?: boolean };
}) {
  if (!isActive && !partialText) return null;

  return (
    <div className="space-y-2">
      {isActive && question && (
        <ConversationTurn
          question={question}
          rawResponse={rawResponse || ''}
          meta={{ ...meta, isStreaming: true } as TurnMeta}
        />
      )}
      {partialText && (
        <div className="px-4 py-2.5 bg-zinc-900/60 rounded-xl border border-zinc-800/80 flex items-center gap-2">
          <span className="w-1.5 h-1.5 bg-green-500 rounded-full animate-pulse shrink-0" />
          <span className="text-sm text-zinc-400 leading-snug">{partialText}</span>
          <span className="inline-block w-0.5 h-4 bg-zinc-500 animate-pulse ml-0.5 align-middle shrink-0" />
        </div>
      )}
    </div>
  );
}
