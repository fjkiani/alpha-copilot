/**
 * StatusBar — Tank-grade top strip
 * Shows: live indicator, status, session timer, agent badge, latency, turn count, hotkey hint
 */
'use client';

import { useEffect, useRef, useState } from 'react';
import type { ProfilerState } from '@/lib/buildSystemPrompt';

const STATUS_CONFIG: Record<string, { label: string; color: string }> = {
  idle:         { label: '',              color: '' },
  mic:          { label: 'Requesting mic...', color: 'text-zinc-400' },
  auth:         { label: 'Authenticating...', color: 'text-zinc-400' },
  connecting:   { label: 'Connecting...',     color: 'text-zinc-400' },
  listening:    { label: 'LIVE',              color: 'text-green-400 font-bold' },
  thinking:     { label: 'THINKING',          color: 'text-blue-400 font-bold' },
  streaming:    { label: 'STREAMING',         color: 'text-green-400 font-bold' },
  paused:       { label: 'PAUSED',            color: 'text-yellow-400 font-bold' },
  ended:        { label: 'Session ended',     color: 'text-zinc-500' },
  disconnected: { label: '⚠ DISCONNECTED',   color: 'text-red-400 font-bold' },
  error:        { label: '⚠ ERROR',           color: 'text-red-400 font-bold' },
};

export default function StatusBar({
  status,
  isStreaming,
  held,
  profilerState,
  copilotLatency,
  turnCount,
  currentAgent,
  sessionStartTime,
}: {
  status: string;
  isStreaming: boolean;
  held: boolean;
  profilerState: ProfilerState | null;
  copilotLatency: number;
  turnCount: number;
  currentAgent?: string;
  sessionStartTime?: number | null;
}) {
  const cfg = STATUS_CONFIG[status] ?? { label: status, color: 'text-zinc-400' };
  const telemetry = profilerState?.alpha_telemetry;
  const pillarsDeployed = telemetry?.pillars_deployed?.length ?? 0;
  const pillarsMissing = telemetry?.pillars_missing?.length ?? 0;

  // Session timer
  const [elapsed, setElapsed] = useState(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (isStreaming && sessionStartTime) {
      timerRef.current = setInterval(() => {
        setElapsed(Math.floor((Date.now() - sessionStartTime) / 1000));
      }, 1000);
    } else {
      if (timerRef.current) clearInterval(timerRef.current);
      if (!isStreaming) setElapsed(0);
    }
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [isStreaming, sessionStartTime]);

  const mins = Math.floor(elapsed / 60);
  const secs = elapsed % 60;
  const timerStr = elapsed > 0 ? `${mins}:${secs.toString().padStart(2,'0')}` : null;

  return (
    <div className="flex items-center justify-between px-4 py-1.5 bg-zinc-950 border-b border-zinc-800/80 text-xs select-none">
      {/* Left: live indicator + status */}
      <div className="flex items-center gap-2.5">
        {isStreaming && (
          <span className="w-1.5 h-1.5 bg-red-500 rounded-full animate-pulse shrink-0" />
        )}
        {held && !isStreaming && (
          <span className="w-1.5 h-1.5 bg-yellow-500 rounded-full shrink-0" />
        )}
        <span className={cfg.color}>{cfg.label}</span>
        {timerStr && (
          <span className="text-zinc-600 font-mono">{timerStr}</span>
        )}
        {currentAgent && isStreaming && (
          <span className="text-zinc-700 font-mono">→ {currentAgent}</span>
        )}
      </div>

      {/* Right: telemetry */}
      <div className="flex items-center gap-3 text-zinc-600">
        {profilerState?.room_power && (
          <span title={`Phase: ${profilerState.conversation_phase ?? '?'}`}>
            {profilerState.room_power === 'Alpha_dominant' ? '👑'
              : profilerState.room_power === 'Interviewer_dominant' ? '🎯' : '⚖️'}
          </span>
        )}
        {pillarsDeployed > 0 && (
          <span className="text-green-600" title={`Deployed: ${telemetry?.pillars_deployed?.join(', ')}`}>
            ✓{pillarsDeployed}
          </span>
        )}
        {pillarsMissing > 0 && (
          <span className="text-red-700" title={`Missing: ${telemetry?.pillars_missing?.join(', ')}`}>
            ✗{pillarsMissing}
          </span>
        )}
        {copilotLatency > 0 && (
          <span className={`font-mono ${copilotLatency > 2500 ? 'text-red-600' : copilotLatency > 1500 ? 'text-yellow-600' : 'text-zinc-600'}`}>
            {copilotLatency}ms
          </span>
        )}
        {turnCount > 0 && <span className="font-mono">T{turnCount}</span>}
        <span className="text-zinc-800 hidden sm:inline">SPC=rescue · ESC=cover · P=profiler · ?=keys</span>
      </div>
    </div>
  );
}
