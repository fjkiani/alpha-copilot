/**
 * HUDStandard — Standard 5-section HUD renderer
 * Renders: [MOTIVE] → [DELIVERY] → [THE MOVE] → [THE BAIT] → [THE DIAGNOSTIC]
 */
import { parseSegments, type HUDParsed } from '@/lib/parseHUD';
import RenderSegments from './RenderSegments';

export default function HUDStandard({ parsed }: { parsed: HUDParsed }) {
  return (
    <div className="space-y-2">
      {parsed.motive && (
        <div>
          <span className="text-xs font-semibold text-zinc-500 uppercase tracking-wider">Motive</span>
          <p className="text-sm text-zinc-300 mt-0.5">{parsed.motive}</p>
        </div>
      )}
      {parsed.delivery && (
        <div>
          <span className="text-xs font-semibold text-amber-500 uppercase tracking-wider">Delivery</span>
          <p className="text-sm text-amber-200 mt-0.5 italic">{parsed.delivery}</p>
        </div>
      )}
      {parsed.move && (
        <div>
          <span className="text-xs font-semibold text-green-400 uppercase tracking-wider">The Move</span>
          <RenderSegments segments={parseSegments(parsed.move)} className="mt-1" />
        </div>
      )}
      {parsed.bait && (
        <div>
          <span className="text-xs font-semibold text-blue-400 uppercase tracking-wider">The Bait</span>
          <p className="text-sm text-blue-200 mt-0.5">{parsed.bait}</p>
        </div>
      )}
      {parsed.diagnostic && (
        <div>
          <span className="text-xs font-semibold text-zinc-600 uppercase tracking-wider">Diagnostic</span>
          <RenderSegments segments={parseSegments(parsed.diagnostic)} className="mt-1 text-zinc-400" />
        </div>
      )}
    </div>
  );
}
