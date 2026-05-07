/**
 * StatusBar — Top status strip with profiler telemetry
 */
import type { ProfilerState } from '@/lib/buildSystemPrompt';

const STATUS_LABELS: Record<string, string> = {
  idle: '',
  mic: 'Requesting mic...',
  auth: 'Authenticating...',
  connecting: 'Connecting...',
  listening: '',
  thinking: '',
  streaming: '',
  paused: 'Paused',
  ended: 'Session ended',
  disconnected: 'Disconnected',
};

export default function StatusBar({
  status,
  isStreaming,
  held,
  profilerState,
  copilotLatency,
  turnCount,
}: {
  status: string;
  isStreaming: boolean;
  held: boolean;
  profilerState: ProfilerState | null;
  copilotLatency: number;
  turnCount: number;
}) {
  const statusLabel = STATUS_LABELS[status] ?? '';
  const telemetry = profilerState?.alpha_telemetry;
  const pillarsDeployed = telemetry?.pillars_deployed ?? [];
  const pillarsMissing = telemetry?.pillars_missing ?? [];

  return (
    <div className="flex items-center justify-between px-4 py-2 bg-zinc-900 border-b border-zinc-800 text-xs">
      <div className="flex items-center gap-3">
        {isStreaming && (
          <span className="w-2 h-2 bg-red-500 rounded-full animate-pulse shrink-0" />
        )}
        {statusLabel && <span className="text-zinc-400">{statusLabel}</span>}
        {status === 'listening' && !held && (
          <span className="text-green-400 font-semibold">LIVE</span>
        )}
        {held && <span className="text-yellow-400 font-semibold">HELD</span>}
        {status === 'thinking' && <span className="text-blue-400 font-semibold">THINKING</span>}
        {status === 'streaming' && <span className="text-green-400 font-semibold">STREAMING</span>}
        {status === 'disconnected' && (
          <span className="text-red-400 font-semibold">⚠ WS DISCONNECTED</span>
        )}
      </div>
      <div className="flex items-center gap-3 text-zinc-500">
        {profilerState?.room_power && (
          <span title={`Phase: ${profilerState.conversation_phase ?? '?'}`}>
            {profilerState.room_power === 'Alpha_dominant'
              ? '👑'
              : profilerState.room_power === 'Interviewer_dominant'
              ? '🎯'
              : '⚖️'}
          </span>
        )}
        {pillarsDeployed.length > 0 && (
          <span
            className="text-green-500"
            title={`Deployed: ${pillarsDeployed.join(', ')}`}
          >
            ✅{pillarsDeployed.length}
          </span>
        )}
        {pillarsMissing.length > 0 && (
          <span
            className="text-red-500"
            title={`Missing: ${pillarsMissing.join(', ')}`}
          >
            ❌{pillarsMissing.length}
          </span>
        )}
        {copilotLatency > 0 && <span>{copilotLatency}ms</span>}
        {turnCount > 0 && <span>T{turnCount}</span>}
        <span className="text-zinc-700">SPACE→rescue | ESC→cover | ⌫→burn</span>
      </div>
    </div>
  );
}
