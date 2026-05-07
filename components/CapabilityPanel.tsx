/**
 * CapabilityPanel — Toggleable capability controls
 * RF1: keyterms toggle disabled while streaming (evaluated on next Start only)
 */
export interface Capabilities {
  terminalMode: boolean;
  clipboardCapture: boolean;
  autoStealth: boolean;
  keyterms: boolean;
  profiler: boolean;
  autoCopilot: boolean;
  [key: string]: boolean; // index signature for sub-hook compatibility
}

export default function CapabilityPanel({
  capabilities,
  onToggle,
  isOpen,
  isStreaming,
}: {
  capabilities: Capabilities;
  onToggle: (key: keyof Capabilities) => void;
  isOpen: boolean;
  isStreaming: boolean;
}) {
  if (!isOpen) return null;

  const items: Array<{ key: keyof Capabilities; label: string; note?: string }> = [
    { key: 'autoCopilot', label: 'Auto Copilot', note: 'Fire on every turn end' },
    { key: 'profiler', label: 'Profiler', note: '60s background analysis' },
    { key: 'terminalMode', label: 'Terminal Mode', note: 'Coding phase override' },
    { key: 'keyterms', label: 'Keyterms', note: 'STT boosting (next start)' },
    { key: 'clipboardCapture', label: 'Clipboard', note: 'Capture copied code' },
    { key: 'autoStealth', label: 'Auto Stealth', note: 'Cover on blur' },
  ];

  return (
    <div className="px-4 py-3 border-b border-zinc-800 bg-zinc-900/50">
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
        {items.map(({ key, label, note }) => {
          const disabled = key === 'keyterms' && isStreaming;
          const active = capabilities[key];
          return (
            <button
              key={key}
              onClick={() => !disabled && onToggle(key)}
              disabled={disabled}
              className={`flex flex-col items-start px-3 py-2 rounded-lg border text-left transition-colors
                ${active
                  ? 'border-green-700 bg-green-950/40 text-green-300'
                  : 'border-zinc-700 bg-zinc-800/40 text-zinc-500'
                }
                ${disabled ? 'opacity-40 cursor-not-allowed' : 'hover:border-zinc-500 cursor-pointer'}
              `}
            >
              <span className="text-xs font-semibold">{active ? '✓' : '○'} {label}</span>
              {note && <span className="text-xs opacity-60 mt-0.5">{note}</span>}
            </button>
          );
        })}
      </div>
    </div>
  );
}
