/**
 * FollowUpPanel — Post-session follow-up brief display
 */
'use client';

export default function FollowUpPanel({
  followUp,
  onCopy,
}: {
  followUp: string;
  onCopy: () => void;
}) {
  if (!followUp) return null;

  return (
    <div className="border border-zinc-700 rounded-lg p-4 space-y-3 bg-zinc-900/50 mt-4">
      <div className="flex items-center justify-between">
        <span className="text-sm font-semibold text-zinc-300">📋 Follow-Up Brief</span>
        <button
          onClick={onCopy}
          className="text-xs text-zinc-500 hover:text-zinc-300 transition-colors px-2 py-1 rounded border border-zinc-700 hover:border-zinc-500"
        >
          ⎘ Copy
        </button>
      </div>
      <div className="text-sm text-zinc-300 whitespace-pre-wrap leading-relaxed max-h-96 overflow-y-auto">
        {followUp}
      </div>
    </div>
  );
}
