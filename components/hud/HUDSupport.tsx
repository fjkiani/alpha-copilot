/**
 * HUDSupport — Candidate support mode renderer (tank-grade)
 */
'use client';

import { parseSegments, type HUDParsed } from '@/lib/parseHUD';
import RenderSegments from './RenderSegments';

export default function HUDSupport({ parsed }: { parsed: HUDParsed }) {
  return (
    <div className="space-y-3">
      {parsed.speaking && (
        <div className="animate-fade-in-up" style={{ animationDelay: '0ms', animationFillMode: 'both' }}>
          <span className="text-xs font-semibold text-purple-400 uppercase tracking-wider">Alpha Is Speaking</span>
          <p className="text-sm text-purple-200 mt-0.5 italic leading-snug">{parsed.speaking}</p>
        </div>
      )}
      {parsed.strengthen && (
        <div className="animate-fade-in-up" style={{ animationDelay: '80ms', animationFillMode: 'both' }}>
          <span className="text-xs font-semibold text-green-400 uppercase tracking-wider">Strengthen</span>
          <RenderSegments segments={parseSegments(parsed.strengthen)} className="mt-1" />
        </div>
      )}
      {parsed.watchOut && (
        <div className="animate-fade-in-up" style={{ animationDelay: '160ms', animationFillMode: 'both' }}>
          <span className="text-xs font-semibold text-yellow-400 uppercase tracking-wider">Watch Out</span>
          <RenderSegments segments={parseSegments(parsed.watchOut)} className="mt-1" />
        </div>
      )}
    </div>
  );
}
