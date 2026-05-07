'use client';

type Mode = 'interview' | 'sales' | 'demo';

const MODE_LABELS: Record<Mode, string> = {
  interview: 'Interview',
  sales: 'Sales',
  demo: 'Demo',
};

export function ModeSelector({
  mode,
  onChange,
  disabled,
}: {
  mode: Mode;
  onChange: (m: Mode) => void;
  disabled?: boolean;
}) {
  return (
    <div className="flex gap-2">
      {(Object.keys(MODE_LABELS) as Mode[]).map(m => (
        <button
          key={m}
          onClick={() => onChange(m)}
          disabled={disabled}
          className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors disabled:opacity-50
            ${mode === m
              ? 'bg-zinc-100 text-zinc-900'
              : 'bg-zinc-800 text-zinc-400 hover:bg-zinc-700'
            }`}
        >
          {MODE_LABELS[m]}
        </button>
      ))}
    </div>
  );
}
