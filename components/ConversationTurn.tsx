/**
 * ConversationTurn — Single Q&A pair with HUD response
 * Used by both HistoricalThread (frozen) and ActiveTurn (hot).
 */
import HUDResponse from './hud/HUDResponse';

export default function ConversationTurn({
  question,
  rawResponse,
}: {
  question: string;
  rawResponse: string;
}) {
  return (
    <div className="border border-zinc-800 rounded-lg p-4 space-y-3 bg-zinc-900/50">
      <div className="flex gap-2 items-start">
        <span className="shrink-0 w-5 h-5 rounded bg-zinc-700 text-zinc-300 text-xs font-bold flex items-center justify-center mt-0.5">
          Q
        </span>
        <p className="text-sm text-zinc-400 leading-snug">{question}</p>
      </div>
      <div className="pl-7">
        <HUDResponse raw={rawResponse} />
      </div>
    </div>
  );
}
