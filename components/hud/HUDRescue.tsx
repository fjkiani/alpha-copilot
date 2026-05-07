/**
 * HUDRescue — Brain freeze / SOS rescue renderer
 * Renders: [RESCUE] → [THE PIVOT]
 * High-contrast, minimal — Alpha reads this aloud immediately.
 */
import type { HUDParsed } from '@/lib/parseHUD';

export default function HUDRescue({ parsed }: { parsed: HUDParsed }) {
  return (
    <div className="space-y-2 border-l-2 border-red-600 pl-3 bg-red-950/30 rounded-r p-2">
      {parsed.rescue && (
        <div>
          <span className="text-xs font-semibold text-red-400 uppercase tracking-wider">🆘 Say This Now</span>
          <p className="text-base text-white mt-1 font-bold leading-snug">{parsed.rescue}</p>
        </div>
      )}
      {parsed.pivot && (
        <div>
          <span className="text-xs font-semibold text-zinc-500 uppercase tracking-wider">Then Pivot</span>
          <p className="text-sm text-zinc-300 mt-0.5">{parsed.pivot}</p>
        </div>
      )}
    </div>
  );
}
