/**
 * HUDTerminal — Coding phase renderer
 * Renders: [ALGORITHM] → [COMPLEXITY] → [EDGE CASES] → [THE CODE]
 * (This was missing from assembly-ai-tts-v2 — BUG-12 fixed here)
 */
import { parseSegments, type HUDParsed } from '@/lib/parseHUD';
import RenderSegments from './RenderSegments';

export default function HUDTerminal({ parsed }: { parsed: HUDParsed }) {
  return (
    <div className="space-y-2 border-l-2 border-cyan-500 pl-3">
      {parsed.algorithm && (
        <div>
          <span className="text-xs font-semibold text-cyan-400 uppercase tracking-wider">Algorithm</span>
          <p className="text-sm text-cyan-200 mt-0.5 font-medium">{parsed.algorithm}</p>
        </div>
      )}
      {parsed.complexity && (
        <div>
          <span className="text-xs font-semibold text-zinc-500 uppercase tracking-wider">Complexity</span>
          <p className="text-sm text-zinc-300 mt-0.5 font-mono">{parsed.complexity}</p>
        </div>
      )}
      {parsed.edgeCases && (
        <div>
          <span className="text-xs font-semibold text-yellow-400 uppercase tracking-wider">Edge Cases</span>
          <RenderSegments segments={parseSegments(parsed.edgeCases)} className="mt-1" />
        </div>
      )}
      {parsed.code && (
        <div>
          <span className="text-xs font-semibold text-green-400 uppercase tracking-wider">The Code</span>
          <RenderSegments segments={parseSegments(parsed.code)} className="mt-1" />
        </div>
      )}
    </div>
  );
}
