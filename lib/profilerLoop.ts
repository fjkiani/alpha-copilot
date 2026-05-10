/**
 * lib/profilerLoop.ts — STUB (v2)
 *
 * The profiler loop was a v1 feature that ran background LLM calls
 * to detect conversation phase. In v2, phase detection is handled
 * by the conductor agent (/api/conductor) on every turn.
 *
 * This stub exists only to satisfy the import in useTranscription.ts
 * until that hook is refactored to remove the profiler dependency.
 */

export interface ProfilerLoopOptions {
  intervalMs: number;
  getTaggedTranscripts: () => string[];
  getLastTick: () => number;
  setLastTick: (n: number) => void;
  getState: () => unknown;
  onUpdate: (state: unknown) => void;
}

export interface ProfilerLoop {
  start: () => void;
  stop: () => void;
}

export function createProfilerLoop(_options: ProfilerLoopOptions): ProfilerLoop {
  // No-op in v2 — conductor handles phase detection
  return {
    start: () => {},
    stop: () => {},
  };
}
