/**
 * HUDTerminal — Coding phase renderer (tank-grade)
 * Adds [OPTIMIZE] section from upgraded code agent.
 */
'use client';

import { parseSegments, type HUDParsed } from '@/lib/parseHUD';
import RenderSegments from './RenderSegments';

export default function HUDTerminal({ parsed }: { parsed: HUDParsed }) {
  const ext = parsed as HUDParsed & { optimize?: string };
  return (
    <div className="space-y-3">
      {parsed.algorithm && (
        <div className="animate-fade-in-up" style={{ animationDelay: '0ms', animationFillMode: 'both' }}>
          <span className="text-xs font-semibold text-cyan-400 uppercase tracking-wider">Algorithm</span>
          <p className="text-sm text-cyan-200 mt-0.5 font-medium leading-snug">{parsed.algorithm}</p>
        </div>
      )}
      {parsed.complexity && (
        <div className="animate-fade-in-up" style={{ animationDelay: '60ms', animationFillMode: 'both' }}>
          <span className="text-xs font-semibold text-zinc-500 uppercase tracking-wider">Complexity</span>
          <p className="text-sm text-zinc-300 mt-0.5 font-mono">{parsed.complexity}</p>
        </div>
      )}
      {parsed.edgeCases && (
        <div className="animate-fade-in-up" style={{ animationDelay: '120ms', animationFillMode: 'both' }}>
          <span className="text-xs font-semibold text-yellow-400 uppercase tracking-wider">Edge Cases</span>
          <RenderSegments segments={parseSegments(parsed.edgeCases)} className="mt-1" />
        </div>
      )}
      {parsed.code && (
        <div className="animate-fade-in-up" style={{ animationDelay: '180ms', animationFillMode: 'both' }}>
          <span className="text-xs font-semibold text-green-400 uppercase tracking-wider">The Code</span>
          <RenderSegments segments={parseSegments(parsed.code)} className="mt-1" />
        </div>
      )}
      {ext.optimize && (
        <div className="animate-fade-in-up" style={{ animationDelay: '240ms', animationFillMode: 'both' }}>
          <span className="text-xs font-semibold text-purple-400 uppercase tracking-wider">Optimize</span>
          <p className="text-sm text-purple-200 mt-0.5">{ext.optimize}</p>
        </div>
      )}
    </div>
  );
}
