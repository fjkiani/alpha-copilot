/**
 * lib/session.ts — Session state machine
 *
 * The single source of truth for the entire interview session.
 * State lives in the client (useRef), travels as JSON in every API call,
 * and is updated via diffs returned by each agent endpoint.
 *
 * No database. No Vercel KV. Stateless-server-compatible.
 */

export type InterviewPhase =
  | 'preflight'   // before recording starts, preflight agent running
  | 'intro'       // introductions, small talk, role overview
  | 'technical'   // technical questions, system design
  | 'coding'      // live coding problem
  | 'behavioral'  // STAR questions, leadership, conflict
  | 'close';      // wrap-up, candidate questions

export type ConductorStep = 'idle' | 'answering' | 'monitoring' | 'pivoting';

export type MonitorFlagType =
  | 'WRONG_ANSWER'       // factually incorrect statement
  | 'MISSING_MECHANISM'  // 30s elapsed, key mechanism not mentioned
  | 'RAMBLING'           // speaking > 45s on same turn
  | 'MISSED_ANCHOR';     // missed opportunity to connect to a strength

export interface MonitorFlag {
  type: MonitorFlagType;
  detail: string;        // specific description of what triggered the flag
  timestamp: number;
}

export interface QuestionEntry {
  question: string;
  likelihood: 'high' | 'medium' | 'low';
  phase: InterviewPhase;
  skeleton: string;      // 3-bullet answer scaffold — NOT a full answer
  keyMechanism: string;  // the one concept the interviewer is testing for
}

export interface PhasePlan {
  phase: InterviewPhase;
  estimatedMinutes: number;
  triggerKeywords: string[];
  description: string;   // what typically happens in this phase
}

export interface Turn {
  speaker: 'interviewer' | 'candidate';
  text: string;
  timestamp: number;
  agentType?: string;    // which agent responded (answer/code/pivot/rescue)
  agentResponse?: string; // what the system generated for this turn
}

export interface SessionState {
  id: string;
  phase: InterviewPhase;
  briefing: string;              // 200-word role briefing from preflight
  questionBank: QuestionEntry[]; // 12 predicted Q&A skeletons
  phasePlan: PhasePlan[];        // predicted phase sequence
  turnHistory: Turn[];           // full conversation log, both speakers
  activeQuestion: string | null; // what the interviewer just asked
  answerDraft: string;           // what the candidate has said so far this turn
  monitorFlags: MonitorFlag[];   // flags raised by monitor this turn (cleared each turn)
  conductorStep: ConductorStep;
  startedAt: number;             // session start timestamp
  currentTurnStartedAt: number;  // when the current candidate turn started
}

// ── Factory ───────────────────────────────────────────────────────────────────

export function createSession(): SessionState {
  return {
    id: `session_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    phase: 'preflight',
    briefing: '',
    questionBank: [],
    phasePlan: [],
    turnHistory: [],
    activeQuestion: null,
    answerDraft: '',
    monitorFlags: [],
    conductorStep: 'idle',
    startedAt: Date.now(),
    currentTurnStartedAt: Date.now(),
  };
}

// ── Merge util ────────────────────────────────────────────────────────────────
// Server returns a partial diff. Client merges it into the current state.
// Arrays are replaced (not merged) when present in the diff.

export type SessionDiff = Partial<SessionState>;

export function mergeSessionDiff(current: SessionState, diff: SessionDiff): SessionState {
  return { ...current, ...diff };
}

// ── Transport helpers ─────────────────────────────────────────────────────────
// Cap turnHistory before sending to prevent payload bloat.
// questionBank is always sent in full (12 entries × ~100 tokens = acceptable).

export function serializeForTransport(state: SessionState): SessionState {
  return {
    ...state,
    turnHistory: state.turnHistory.slice(-20), // last 20 turns only
  };
}

// ── Turn helpers ──────────────────────────────────────────────────────────────

export function addTurn(
  state: SessionState,
  speaker: 'interviewer' | 'candidate',
  text: string,
  agentType?: string,
  agentResponse?: string
): SessionState {
  const turn: Turn = {
    speaker,
    text,
    timestamp: Date.now(),
    agentType,
    agentResponse,
  };
  return {
    ...state,
    turnHistory: [...state.turnHistory, turn],
  };
}

export function startCandidateTurn(state: SessionState): SessionState {
  return {
    ...state,
    answerDraft: '',
    monitorFlags: [],
    currentTurnStartedAt: Date.now(),
    conductorStep: 'monitoring',
  };
}

export function appendAnswerDraft(state: SessionState, text: string): SessionState {
  return {
    ...state,
    answerDraft: state.answerDraft ? `${state.answerDraft} ${text}` : text,
  };
}

// ── Phase helpers ─────────────────────────────────────────────────────────────

export function candidateSpeakingSeconds(state: SessionState): number {
  return Math.round((Date.now() - state.currentTurnStartedAt) / 1000);
}

// Build a compact conversation context string for agent prompts
// (last N turns, tagged with speaker)
export function buildConversationContext(state: SessionState, lastN = 10): string {
  return state.turnHistory
    .slice(-lastN)
    .map(t => `${t.speaker === 'interviewer' ? 'Interviewer' : 'Candidate'}: ${t.text}`)
    .join('\n');
}

// Find the best matching question from the bank for a given transcript
// Returns null if no good match (conductor will handle cold generation)
export function matchQuestionBank(
  state: SessionState,
  transcript: string
): QuestionEntry | null {
  if (!state.questionBank.length) return null;
  const lower = transcript.toLowerCase();
  // Simple keyword overlap on keyMechanism — conductor LLM does the real matching
  // This is a client-side pre-filter only
  let best: QuestionEntry | null = null;
  let bestScore = 0;
  for (const entry of state.questionBank) {
    const words = entry.keyMechanism.toLowerCase().split(/\s+/);
    const score = words.filter(w => w.length > 4 && lower.includes(w)).length;
    if (score > bestScore) { bestScore = score; best = entry; }
  }
  return bestScore >= 2 ? best : null;
}
