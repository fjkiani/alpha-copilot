/**
 * HUDResponse — Tank-grade master router
 *
 * Upgrades vs v1:
 * - Animated section reveals (staggered 80ms per section)
 * - Confidence bar under each response
 * - Latency ring (time-to-first-token vs 2500ms SLA)
 * - Rescue: full-screen overlay mode
 * - Override: pulsing red border
 * - Truncation warning banner
 * - Agent badge
 */
'use client';

import { parseHUDSections, parseSegments } from '@/lib/parseHUD';
import RenderSegments from './RenderSegments';
import HUDStandard from './HUDStandard';
import HUDOverride from './HUDOverride';
import HUDTerminal from './HUDTerminal';
import HUDRescue from './HUDRescue';
import HUDSupport from './HUDSupport';

interface HUDResponseProps {
  raw: string;
  agent?: string;
  urgency?: 'normal' | 'rescue' | 'override';
  confidence?: number;
  firstTokenMs?: number | null;
  truncated?: boolean;
  isStreaming?: boolean;
}

// Latency ring: green <800ms, yellow <1800ms, red >1800ms
function LatencyRing({ ms }: { ms: number }) {
  const SLA = 2500;
  const pct = Math.min(ms / SLA, 1);
  const color = ms < 800 ? '#22c55e' : ms < 1800 ? '#f59e0b' : '#ef4444';
  const r = 8;
  const circ = 2 * Math.PI * r;
  const dash = circ * (1 - pct);

  return (
    <svg width="20" height="20" viewBox="0 0 20 20" className="shrink-0" aria-label={`${ms}ms to first token`}>
      <title>{`${ms}ms to first token`}</title>
      <circle cx="10" cy="10" r={r} fill="none" stroke="#27272a" strokeWidth="2.5" />
      <circle
        cx="10" cy="10" r={r}
        fill="none"
        stroke={color}
        strokeWidth="2.5"
        strokeDasharray={circ}
        strokeDashoffset={dash}
        strokeLinecap="round"
        transform="rotate(-90 10 10)"
      />
    </svg>
  );
}

// Confidence bar
function ConfidenceBar({ confidence }: { confidence: number }) {
  const pct = Math.round(confidence * 100);
  const color = confidence > 0.8 ? 'bg-green-500' : confidence > 0.6 ? 'bg-yellow-500' : 'bg-red-500';
  return (
    <div className="flex items-center gap-2 mt-2">
      <div className="flex-1 h-0.5 bg-zinc-800 rounded-full overflow-hidden">
        <div
          className={`h-full ${color} rounded-full transition-all duration-500`}
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className="text-xs text-zinc-600 font-mono w-8 text-right">{pct}%</span>
    </div>
  );
}

// Agent badge
const AGENT_COLORS: Record<string, string> = {
  tactical:    'text-green-400 border-green-800',
  behavioral:  'text-purple-400 border-purple-800',
  code:        'text-cyan-400 border-cyan-800',
  rescue:      'text-red-400 border-red-800',
  sales:       'text-orange-400 border-orange-800',
  demo:        'text-blue-400 border-blue-800',
  negotiation: 'text-yellow-400 border-yellow-800',
};

function AgentBadge({ agent }: { agent: string }) {
  const color = AGENT_COLORS[agent] ?? 'text-zinc-400 border-zinc-700';
  return (
    <span className={`text-xs font-mono px-1.5 py-0.5 rounded border uppercase tracking-wider ${color}`}>
      {agent}
    </span>
  );
}

export default function HUDResponse({
  raw,
  agent,
  urgency = 'normal',
  confidence,
  firstTokenMs,
  truncated = false,
  isStreaming = false,
}: HUDResponseProps) {
  const parsed = parseHUDSections(raw);
  if (!parsed) return null;

  // Thinking / waiting states
  if (parsed.phase === 'thinking' || parsed.phase === 'waiting') {
    return (
      <div className="flex items-center gap-2 text-zinc-500 text-xs py-1">
        <span className="flex gap-0.5">
          {[0, 150, 300].map((delay) => (
            <span
              key={delay}
              className="w-1.5 h-1.5 bg-zinc-500 rounded-full animate-bounce"
              style={{ animationDelay: `${delay}ms` }}
            />
          ))}
        </span>
        <span>{parsed.phase === 'thinking' ? 'reasoning...' : 'generating...'}</span>
        {isStreaming && <span className="ml-auto text-zinc-700 animate-pulse">●</span>}
      </div>
    );
  }

  // Rescue: full-screen overlay
  if (parsed.phase === 'rescue' || urgency === 'rescue') {
    return (
      <div className="fixed inset-0 z-50 bg-zinc-950/95 flex flex-col items-center justify-center p-8 backdrop-blur-sm">
        <div className="max-w-2xl w-full space-y-6">
          <div className="flex items-center gap-3">
            <span className="text-red-500 text-2xl animate-pulse">🆘</span>
            <span className="text-red-400 text-sm font-semibold uppercase tracking-widest">Rescue Mode</span>
          </div>
          {parsed.rescue && (
            <div className="bg-red-950/60 border border-red-700 rounded-xl p-6">
              <p className="text-white text-3xl font-bold leading-tight tracking-tight">
                {parsed.rescue}
              </p>
            </div>
          )}
          {parsed.pivot && (
            <div className="border-l-2 border-zinc-700 pl-4">
              <p className="text-xs text-zinc-500 uppercase tracking-wider mb-1">Then pivot to</p>
              <p className="text-zinc-300 text-lg">{parsed.pivot}</p>
            </div>
          )}
          {(parsed as { stall?: string }).stall && (
            <div className="border-l-2 border-zinc-700 pl-4">
              <p className="text-xs text-zinc-500 uppercase tracking-wider mb-1">Stall phrase</p>
              <p className="text-zinc-400 italic">{(parsed as { stall?: string }).stall}</p>
            </div>
          )}
          <p className="text-xs text-zinc-700 text-center">Press SPACE or ESC to dismiss</p>
        </div>
      </div>
    );
  }

  // Override: pulsing red border wrapper
  const isOverride = parsed.phase === 'override' || urgency === 'override';

  const content = (() => {
    if (parsed.phase === 'override') return <HUDOverride parsed={parsed} />;
    if (parsed.phase === 'terminal') return <HUDTerminal parsed={parsed} />;
    if (parsed.phase === 'support') return <HUDSupport parsed={parsed} />;
    if (parsed.phase === 'plain') return <RenderSegments segments={parseSegments(parsed.text ?? '')} />;
    return <HUDStandard parsed={parsed} />;
  })();

  return (
    <div className={`space-y-2 ${isOverride ? 'animate-pulse-border' : ''}`}>
      {/* Header row: agent badge + latency ring */}
      {(agent || firstTokenMs) && (
        <div className="flex items-center gap-2">
          {agent && <AgentBadge agent={agent} />}
          {firstTokenMs && <LatencyRing ms={firstTokenMs} />}
          {firstTokenMs && (
            <span className="text-xs text-zinc-600 font-mono">{firstTokenMs}ms</span>
          )}
          {isStreaming && (
            <span className="ml-auto text-xs text-green-500 animate-pulse font-mono">streaming</span>
          )}
        </div>
      )}

      {/* Truncation warning */}
      {truncated && (
        <div className="text-xs text-yellow-600 border border-yellow-900 rounded px-2 py-1 bg-yellow-950/30">
          ⚠ Response truncated — model hit token limit
        </div>
      )}

      {/* Main HUD content */}
      <div className={isOverride ? 'border border-red-800 rounded-lg p-3 bg-red-950/10' : ''}>
        {content}
      </div>

      {/* Confidence bar */}
      {confidence !== undefined && confidence > 0 && (
        <ConfidenceBar confidence={confidence} />
      )}
    </div>
  );
}
