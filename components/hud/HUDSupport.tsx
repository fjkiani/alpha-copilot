/**
 * HUDSupport — Candidate support mode renderer
 * Fires when Alpha is speaking. Renders: [ALPHA IS SPEAKING] → [STRENGTHEN] → [WATCH OUT]
 */
import { parseSegments, type HUDParsed } from '@/lib/parseHUD';
import RenderSegments from './RenderSegments';

export default function HUDSupport({ parsed }: { parsed: HUDParsed }) {
  return (
    <div className="space-y-2 border-l-2 border-purple-500 pl-3">
      {parsed.speaking && (
        <div>
          <span className="text-xs font-semibold text-purple-400 uppercase tracking-wider">Alpha Is Speaking</span>
          <p className="text-sm text-purple-200 mt-0.5 italic">{parsed.speaking}</p>
        </div>
      )}
      {parsed.strengthen && (
        <div>
          <span className="text-xs font-semibold text-green-400 uppercase tracking-wider">Strengthen</span>
          <RenderSegments segments={parseSegments(parsed.strengthen)} className="mt-1" />
        </div>
      )}
      {parsed.watchOut && (
        <div>
          <span className="text-xs font-semibold text-yellow-400 uppercase tracking-wider">Watch Out</span>
          <RenderSegments segments={parseSegments(parsed.watchOut)} className="mt-1" />
        </div>
      )}
    </div>
  );
}
