/**
 * RenderSegments — Renders parsed HUD segments (text bullets + code blocks)
 */
import type { Segment } from '@/lib/parseHUD';

export default function RenderSegments({
  segments,
  className = '',
}: {
  segments: Segment[];
  className?: string;
}) {
  if (!segments.length) return null;

  return (
    <div className={className}>
      {segments.map((seg, i) => {
        if (seg.type === 'code') {
          return (
            <pre
              key={i}
              className="mt-2 bg-zinc-800 rounded p-3 text-xs font-mono overflow-x-auto text-zinc-200 whitespace-pre-wrap"
            >
              <code>{seg.content as string}</code>
            </pre>
          );
        }
        // text segment — array of bullet strings
        const lines = Array.isArray(seg.content) ? seg.content : [seg.content as string];
        return (
          <ul key={i} className="space-y-1 mt-1">
            {lines.map((line, j) => (
              <li key={j} className="flex gap-2 text-sm text-zinc-200 leading-snug">
                <span className="text-zinc-500 mt-0.5 shrink-0">•</span>
                <span>{line}</span>
              </li>
            ))}
          </ul>
        );
      })}
    </div>
  );
}
