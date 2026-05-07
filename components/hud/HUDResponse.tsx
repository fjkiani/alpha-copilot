/**
 * HUDResponse — Master router component
 * Parses raw LLM output and delegates to the correct HUD renderer.
 */
import { parseHUDSections, parseSegments } from '@/lib/parseHUD';
import RenderSegments from './RenderSegments';
import HUDStandard from './HUDStandard';
import HUDOverride from './HUDOverride';
import HUDTerminal from './HUDTerminal';
import HUDRescue from './HUDRescue';
import HUDSupport from './HUDSupport';

export default function HUDResponse({ raw }: { raw: string }) {
  const parsed = parseHUDSections(raw);
  if (!parsed) return null;

  if (parsed.phase === 'thinking' || parsed.phase === 'waiting') {
    return (
      <div className="flex items-center gap-2 text-zinc-500 text-xs py-1">
        <span className="flex gap-0.5">
          {[0, 150, 300].map((delay) => (
            <span
              key={delay}
              className="w-1 h-1 bg-zinc-500 rounded-full animate-bounce"
              style={{ animationDelay: `${delay}ms` }}
            />
          ))}
        </span>
        {parsed.phase === 'thinking' ? 'reasoning...' : 'generating...'}
      </div>
    );
  }

  if (parsed.phase === 'override') return <HUDOverride parsed={parsed} />;
  if (parsed.phase === 'terminal') return <HUDTerminal parsed={parsed} />;
  if (parsed.phase === 'rescue') return <HUDRescue parsed={parsed} />;
  if (parsed.phase === 'support') return <HUDSupport parsed={parsed} />;
  if (parsed.phase === 'plain') {
    return <RenderSegments segments={parseSegments(parsed.text ?? '')} />;
  }

  // Standard 5-section HUD (hud phase)
  return <HUDStandard parsed={parsed} />;
}
