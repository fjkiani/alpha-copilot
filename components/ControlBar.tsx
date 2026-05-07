/**
 * ControlBar — Session START/STOP/PAUSE + Follow-Up + Modes toggle
 */
export default function ControlBar({
  isStreaming,
  isPaused,
  hasHistory,
  followUpLoading,
  modesOpen,
  onStart,
  onStop,
  onPause,
  onResume,
  onRescue,
  onGenerateFollowUp,
  onToggleModes,
}: {
  isStreaming: boolean;
  isPaused: boolean;
  hasHistory: boolean;
  followUpLoading: boolean;
  modesOpen: boolean;
  onStart: () => void;
  onStop: () => void;
  onPause: () => void;
  onResume: () => void;
  onRescue: () => void;
  onGenerateFollowUp: () => void;
  onToggleModes: () => void;
}) {
  const btn = 'px-4 py-2 rounded-lg text-sm font-medium transition-colors';

  return (
    <div className="flex items-center gap-2 px-4 py-3 border-b border-zinc-800 flex-wrap">
      {!isStreaming && !isPaused ? (
        <button
          className={`${btn} bg-green-600 hover:bg-green-700 text-white`}
          onClick={onStart}
        >
          ● START
        </button>
      ) : isPaused ? (
        <button
          className={`${btn} bg-green-600 hover:bg-green-700 text-white`}
          onClick={onResume}
        >
          ▶ RESUME
        </button>
      ) : (
        <>
          <button
            className={`${btn} bg-red-700 hover:bg-red-800 text-white`}
            onClick={onRescue}
          >
            🚨 RESCUE
          </button>
          <button
            className={`${btn} bg-yellow-600 hover:bg-yellow-700 text-white`}
            onClick={onPause}
          >
            ⏸ PAUSE
          </button>
          <button
            className={`${btn} bg-zinc-700 hover:bg-zinc-600 text-white`}
            onClick={onStop}
          >
            ■ STOP
          </button>
        </>
      )}

      {hasHistory && (
        <button
          className={`${btn} bg-zinc-800 hover:bg-zinc-700 text-zinc-300 disabled:opacity-50`}
          onClick={onGenerateFollowUp}
          disabled={followUpLoading}
        >
          {followUpLoading ? '⏳ Generating...' : '📋 Follow-Up'}
        </button>
      )}

      <button
        className={`${btn} ml-auto text-zinc-400 hover:text-zinc-200 ${
          modesOpen ? 'bg-zinc-800' : ''
        }`}
        onClick={onToggleModes}
      >
        ⚙ Modes {modesOpen ? '▴' : '▾'}
      </button>
    </div>
  );
}
