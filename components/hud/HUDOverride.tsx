/**
 * HUDOverride — RED LIGHT override renderer (tank-grade)
 */
'use client';

import { parseSegments, type HUDParsed } from '@/lib/parseHUD';
import RenderSegments from './RenderSegments';

export default function HUDOverride({ parsed }: { parsed: HUDParsed }) {
  return (
    <div className="space-y-3">
      {parsed.courseCorrect && (
        <div className="animate-fade-in-up" style={{ animationDelay: '0ms', animationFillMode: 'both' }}>
          <span className="text-xs font-semibold text-red-400 uppercase tracking-wider">🔴 Course Correct</span>
          <p className="text-sm text-red-200 mt-0.5 font-semibold leading-snug">{parsed.courseCorrect}</p>
        </div>
      )}
      {parsed.pivotMove && (
        <div className="animate-fade-in-up" style={{ animationDelay: '80ms', animationFillMode: 'both' }}>
          <span className="text-xs font-semibold text-orange-400 uppercase tracking-wider">Pivot</span>
          <RenderSegments segments={parseSegments(parsed.pivotMove)} className="mt-1" />
        </div>
      )}
      {parsed.bait && (
        <div className="animate-fade-in-up" style={{ animationDelay: '160ms', animationFillMode: 'both' }}>
          <span className="text-xs font-semibold text-blue-400 uppercase tracking-wider">The Bait</span>
          <p className="text-sm text-blue-200 mt-0.5">{parsed.bait}</p>
        </div>
      )}
    </div>
  );
}
