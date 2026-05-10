/**
 * lib/buildSystemPrompt.ts — STUB (v2)
 *
 * In v1, this file built system prompts by injecting resume/KB context.
 * In v2, each agent (/api/answer, /api/code, etc.) owns its own system prompt.
 * No resume injection. No knowledge base.
 *
 * This stub exists only to satisfy the ProfilerState type import
 * in useTranscription.ts and ProfilerPanel.tsx until those are refactored.
 */

export interface AlphaTelemetry {
  pillars_deployed: string[];
  pillars_missing: string[];
}

export interface Interviewer {
  name?: string;
  role?: string;
  style?: string;
  emotional_state?: string;
  the_exploit?: string;
}

export interface ProfilerState {
  conversation_phase: string;
  detected_role: string;
  key_topics: string[];
  candidate_strengths: string[];
  areas_to_probe: string[];
  recommended_agent: string;
  confidence: number;
  tick: number;
  // v1 fields — kept for ProfilerPanel compatibility
  room_power?: 'Alpha_dominant' | 'Interviewer_dominant' | 'Balanced';
  interviewers?: Interviewer[];
  alpha_telemetry?: AlphaTelemetry;
}

export type KnowledgeBase = Record<string, unknown>;

export function buildSystemPrompt(_state: ProfilerState | null): string {
  // No-op in v2 — agents own their own prompts
  return '';
}

export function buildFollowUpPrompt(_kb: KnowledgeBase, _state: ProfilerState | null): string {
  // No-op in v2 — followup route uses inline prompt
  return '';
}
