/**
 * POST /api/context
 * Rolling memory store for interview context.
 * Preserves conversation continuity across turns.
 *
 * NOTE: In-memory store — works in dev and long-running Node.js.
 * For Vercel serverless, replace with Vercel KV or pass context from client.
 */

const SESSION_TTL_MS = 2 * 60 * 60 * 1000; // 2h
const MAX_EVENTS = 80;
const QUESTION_MARKERS = [
  '?', 'can you', 'how would', 'what would', 'walk me through', "let's", 'let us',
];

interface SessionEvent {
  speaker: string;
  text: string;
  ts: number;
}

interface Session {
  updatedAt: number;
  version: number;
  events: SessionEvent[];
  activeContext: string;
}

// Persist across hot reloads in dev
const sessionStore: Map<string, Session> =
  (globalThis as Record<string, unknown>).__zetaSessionStore as Map<string, Session> ??
  new Map<string, Session>();
(globalThis as Record<string, unknown>).__zetaSessionStore = sessionStore;

function cleanupExpiredSessions() {
  const now = Date.now();
  for (const [id, session] of sessionStore.entries()) {
    if (now - session.updatedAt > SESSION_TTL_MS) sessionStore.delete(id);
  }
}

function compact(text: string, max = 280): string {
  const clean = (text ?? '').replace(/\s+/g, ' ').trim();
  if (!clean) return '';
  return clean.length > max ? `${clean.slice(0, max)}...` : clean;
}

function buildContext(events: SessionEvent[] = []): string {
  if (events.length === 0) return 'No prior conversation context yet.';

  const recent = events.slice(-10);
  const unresolvedQuestions: string[] = [];

  for (let i = 0; i < recent.length; i++) {
    const ev = recent[i];
    if (ev.speaker !== 'interviewer') continue;
    const lower = ev.text.toLowerCase();
    const looksQuestion = QUESTION_MARKERS.some((m) => lower.includes(m));
    if (!looksQuestion) continue;
    const answeredLater = recent
      .slice(i + 1)
      .some((next) => next.speaker === 'candidate' && next.text.length > 24);
    if (!answeredLater) unresolvedQuestions.push(compact(ev.text, 160));
  }

  const lastInterviewer = recent.filter((e) => e.speaker === 'interviewer').slice(-1)[0];
  const lastCandidate = recent.filter((e) => e.speaker === 'candidate').slice(-1)[0];
  const activeThreadSeed =
    lastInterviewer?.text ?? lastCandidate?.text ?? recent[recent.length - 1]?.text ?? '';

  const summary = recent
    .slice(-6)
    .map((e) => `${e.speaker === 'candidate' ? 'Me' : 'Interviewer'}: ${compact(e.text, 120)}`)
    .join(' | ');

  return [
    `Active thread: ${compact(activeThreadSeed, 220) || 'Unknown'}`,
    unresolvedQuestions.length > 0
      ? `Open loops: ${unresolvedQuestions.slice(0, 3).join(' || ')}`
      : 'Open loops: none detected in recent turns.',
    `Recent flow: ${summary}`,
  ].join('\n');
}

export async function POST(request: Request) {
  try {
    cleanupExpiredSessions();
    const { sessionId, speaker = 'interviewer', text = '', kind = 'turn' } =
      (await request.json()) as {
        sessionId?: string;
        speaker?: string;
        text?: string;
        kind?: string;
      };

    if (!sessionId) {
      return Response.json({ error: 'sessionId is required' }, { status: 400 });
    }

    const existing: Session = sessionStore.get(sessionId) ?? {
      updatedAt: Date.now(),
      version: 0,
      events: [],
      activeContext: 'No prior conversation context yet.',
    };

    if (kind !== 'peek' && (text as string).trim()) {
      existing.events.push({ speaker, text: (text as string).trim(), ts: Date.now() });
      if (existing.events.length > MAX_EVENTS) {
        existing.events = existing.events.slice(-MAX_EVENTS);
      }
    }

    existing.updatedAt = Date.now();
    existing.version += 1;
    existing.activeContext = buildContext(existing.events);
    sessionStore.set(sessionId, existing);

    return Response.json({
      sessionId,
      version: existing.version,
      activeContext: existing.activeContext,
      eventCount: existing.events.length,
    });
  } catch (err) {
    return Response.json({ error: (err as Error).message }, { status: 500 });
  }
}
