/**
 * Shared types used across hooks and API routes.
 */

export type TranscriptChunk = {
  text: string;
  speaker: 'INTERVIEWER' | 'CANDIDATE';
  timestamp: number;
};
