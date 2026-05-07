/**
 * profilerLoop.ts — Background profiler interval manager
 *
 * Runs every intervalMs (default 60s). Sends latest tagged transcripts
 * to /api/profiler and patches the profile state.
 * Zero React deps. Returns { start, stop, tick } controller.
 */

export interface ProfilerLoopOptions {
  intervalMs?: number;
  getTaggedTranscripts: () => string[];
  getLastTick: () => number;
  setLastTick: (n: number) => void;
  getState: () => object | null;
  onUpdate: (newState: object) => void;
  baseUrl?: string;
}

export interface ProfilerLoop {
  start: () => void;
  stop: () => void;
  tick: () => Promise<void>;
}

export function createProfilerLoop({
  intervalMs = 60000,
  getTaggedTranscripts,
  getLastTick,
  setLastTick,
  getState,
  onUpdate,
  baseUrl = '',
}: ProfilerLoopOptions): ProfilerLoop {
  let intervalId: ReturnType<typeof setInterval> | null = null;

  async function tick(): Promise<void> {
    const allTagged = getTaggedTranscripts();
    const lastTick = getLastTick();
    const latestChunk = allTagged.slice(lastTick);
    setLastTick(allTagged.length);

    if (latestChunk.length === 0) return;

    try {
      const res = await fetch(`${baseUrl}/api/profiler`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          currentProfileState: getState(),
          latestChunk,
        }),
      });
      if (res.ok) {
        const newState = await res.json();
        onUpdate(newState);
        console.log('[profiler] Updated:', JSON.stringify(newState).slice(0, 100));
      }
    } catch (e) {
      console.warn('[profiler] Error (non-fatal):', (e as Error).message);
    }
  }

  return {
    start() {
      if (intervalId) return;
      intervalId = setInterval(tick, intervalMs);
    },
    stop() {
      if (intervalId) {
        clearInterval(intervalId);
        intervalId = null;
      }
    },
    tick,
  };
}
