/**
 * HUDOverride — RED LIGHT override renderer
 * Fires when Alpha is off-script or rambling.
 * Renders: [COURSE CORRECT] → [THE PIVOT MOVE] → [THE BAIT]
 */
import { parseSegments, type HUDParsed } from '@/lib/parseHUD';
import RenderSegments from './RenderSegments';

export default function HUDOverride({ parsed }: { parsed: HUDParsed }) {
  return (
    <div className="space-y-2 border-l-2 border-red-500 pl-3">
      {parsed.courseCorrect && (
        <div>
          <span className="text-xs font-semibold text-red-400 uppercase tracking-wider">🔴 Course Correct</span>
          <p className="text-sm text-red-200 mt-0.5 font-medium">{parsed.courseCorrect}</p>
        </div>
      )}
      {parsed.pivotMove && (
        <div>
          <span className="text-xs font-semibold text-orange-400 uppercase tracking-wider">Pivot</span>
          <RenderSegments segments={parseSegments(parsed.pivotMove)} className="mt-1" />
        </div>
      )}
      {parsed.bait && (
        <div>
          <span className="text-xs font-semibold text-blue-400 uppercase tracking-wider">The Bait</span>
          <p className="text-sm text-blue-200 mt-0.5">{parsed.bait}</p>
        </div>
      )}
    </div>
  );
}
