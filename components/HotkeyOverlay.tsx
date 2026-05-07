/**
 * HotkeyOverlay — Full keyboard command reference (hold ? to show)
 */
export default function HotkeyOverlay({ onClose }: { onClose: () => void }) {
  const groups = [
    {
      label: 'Session',
      keys: [
        { key: 'SPACE', action: 'SOS Rescue — fires immediately' },
        { key: 'ESC', action: 'Toggle cover mode (stealth)' },
        { key: '⌫', action: 'Burn active context' },
        { key: 'P', action: 'Toggle profiler panel' },
        { key: 'H', action: 'Toggle HUD visibility' },
        { key: '?', action: 'Show this overlay' },
      ],
    },
    {
      label: 'Force Agent',
      keys: [
        { key: 'T', action: 'Force Terminal (coding) mode' },
        { key: 'R', action: 'Force Rescue on next fire' },
        { key: 'N', action: 'Force Negotiation mode' },
        { key: 'B', action: 'Force Behavioral (STAR) mode' },
      ],
    },
    {
      label: 'Navigation',
      keys: [
        { key: '1 / 2 / 3', action: 'Highlight bullet 1 / 2 / 3' },
        { key: 'Ctrl+C', action: 'Copy current HUD to clipboard' },
        { key: 'Ctrl+Shift+S', action: 'Toggle auto-stealth' },
      ],
    },
  ];

  return (
    <div
      className="fixed inset-0 z-50 bg-zinc-950/90 flex items-center justify-center p-8 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="bg-zinc-900 border border-zinc-700 rounded-2xl p-6 max-w-lg w-full space-y-5 shadow-2xl"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-zinc-300 uppercase tracking-wider">Keyboard Commands</h2>
          <button onClick={onClose} className="text-zinc-600 hover:text-zinc-400 text-lg">✕</button>
        </div>
        {groups.map(g => (
          <div key={g.label} className="space-y-2">
            <p className="text-xs text-zinc-600 uppercase tracking-wider">{g.label}</p>
            <div className="space-y-1.5">
              {g.keys.map(({ key, action }) => (
                <div key={key} className="flex items-center gap-3">
                  <kbd className="px-2 py-0.5 bg-zinc-800 border border-zinc-700 rounded text-xs font-mono text-zinc-300 shrink-0 min-w-[3rem] text-center">
                    {key}
                  </kbd>
                  <span className="text-xs text-zinc-400">{action}</span>
                </div>
              ))}
            </div>
          </div>
        ))}
        <p className="text-xs text-zinc-700 text-center">Click anywhere or press ? to close</p>
      </div>
    </div>
  );
}
