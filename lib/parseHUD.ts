/**
 * parseHUD.ts — Pure parsing for all HUD section formats
 *
 * v2 additions:
 *   answer agent:   [WHAT THEY'RE TESTING] [SAY THIS FIRST] [THE MECHANISM] [CLOSE WITH]
 *   code agent:     [CLARIFY FIRST] [APPROACH] [THE CODE] [FOLLOW-UP TRAP]
 *   pivot agent:    [STOP] [SAY THIS NOW] [LAND HERE]
 *   rescue agent:   [RESCUE] [FULL ANSWER] [CODE] [PIVOT]
 *   monitor:        never rendered (internal only)
 *
 * v1 fields retained for HUDOverride, HUDTerminal, HUDSupport backward compat:
 *   override:  courseCorrect, pivotMove, bait
 *   terminal:  algorithm, complexity, edgeCases, code
 *   support:   speaking, strengthen, watchOut
 */

export type HUDPhase =
  | 'thinking'
  | 'waiting'
  | 'answer'      // v2 main answer format
  | 'code'        // v2 guided solve format
  | 'pivot'       // v2 interrupt banner
  | 'rescue'      // rescue overlay
  | 'override'    // v1 override agent (retained for compat)
  | 'terminal'    // v1 terminal agent (retained for compat)
  | 'support'     // v1 support agent (retained for compat)
  | 'plain';      // fallback

export interface HUDParsed {
  phase: HUDPhase;

  // ── v2 answer agent ───────────────────────────────────────────────────────
  testing?: string;       // [WHAT THEY'RE TESTING]
  sayFirst?: string;      // [SAY THIS FIRST]
  mechanism?: string;     // [THE MECHANISM]
  closeWith?: string;     // [CLOSE WITH]

  // ── v2 code agent ─────────────────────────────────────────────────────────
  clarifyFirst?: string;  // [CLARIFY FIRST]
  approach?: string;      // [APPROACH]
  code?: string;          // [THE CODE] or [CODE]
  followUpTrap?: string;  // [FOLLOW-UP TRAP]

  // ── v2 pivot agent ────────────────────────────────────────────────────────
  stop?: string;          // [STOP]
  sayNow?: string;        // [SAY THIS NOW]
  landHere?: string;      // [LAND HERE]

  // ── rescue agent (v1 + v2) ────────────────────────────────────────────────
  rescue?: string;        // [RESCUE]
  fullAnswer?: string;    // [FULL ANSWER]
  rescueCode?: string;    // [CODE] in rescue context
  pivot?: string;         // [PIVOT]

  // ── v1 override agent ─────────────────────────────────────────────────────
  courseCorrect?: string; // [COURSE CORRECT]
  pivotMove?: string;     // [PIVOT MOVE]
  bait?: string;          // [BAIT]

  // ── v1 terminal agent ─────────────────────────────────────────────────────
  algorithm?: string;     // [ALGORITHM]
  complexity?: string;    // [COMPLEXITY]
  edgeCases?: string;     // [EDGE CASES]

  // ── v1 support agent ──────────────────────────────────────────────────────
  speaking?: string;      // [SPEAKING]
  strengthen?: string;    // [STRENGTHEN]
  watchOut?: string;      // [WATCH OUT]

  // ── v1 standard agent ─────────────────────────────────────────────────────
  motive?: string;       // [MOTIVE]
  delivery?: string;     // [DELIVERY]
  move?: string;         // [MOVE]
  diagnostic?: string;   // [DIAGNOSTIC]

  // ── plain fallback ────────────────────────────────────────────────────────
  text?: string;
}

export interface Segment {
  type: 'text' | 'code';
  content: string | string[];
  lang?: string;
}

export function parseHUDSections(raw: string): HUDParsed | null {
  if (!raw) return null;

  // Strip completed THINK blocks
  let text = raw.replace(/<THINK[\s\S]*?<\/THINK>/gi, '');
  text = text.replace(/<PLAN[\s\S]*?<\/PLAN>/gi, '');
  text = text.replace(/<\/?EXECUTE>/gi, '');

  // Detect incomplete THINK/PLAN (still streaming)
  const thinkOpen = raw.lastIndexOf('<THINK');
  const thinkClose = raw.lastIndexOf('</THINK');
  if (thinkOpen >= 0 && (thinkClose < 0 || thinkClose < thinkOpen)) return { phase: 'thinking' };
  const planOpen = raw.lastIndexOf('<PLAN');
  const planClose = raw.lastIndexOf('</PLAN');
  if (planOpen >= 0 && (planClose < 0 || planClose < planOpen)) return { phase: 'thinking' };

  text = text.trim();
  if (!text) return { phase: 'waiting' };

  // ── Pivot agent: [STOP] ───────────────────────────────────────────────────
  if (/\[STOP\]/i.test(text)) {
    const stopMatch = text.match(/\[STOP\]\s*([\s\S]*?)(?=\[SAY THIS NOW\]|$)/i);
    const sayMatch  = text.match(/\[SAY THIS NOW\]\s*([\s\S]*?)(?=\[LAND HERE\]|$)/i);
    const landMatch = text.match(/\[LAND HERE\]\s*([\s\S]*?)$/i);
    return {
      phase: 'pivot',
      stop:     (stopMatch?.[1] ?? '').trim(),
      sayNow:   (sayMatch?.[1]  ?? '').trim(),
      landHere: (landMatch?.[1] ?? '').trim(),
    };
  }

  // ── Rescue agent: [RESCUE] ────────────────────────────────────────────────
  if (/\[RESCUE\]/i.test(text)) {
    const rescueMatch = text.match(/\[RESCUE\]\s*([\s\S]*?)(?=\[FULL ANSWER\]|\[PIVOT\]|$)/i);
    const fullMatch   = text.match(/\[FULL ANSWER\]\s*([\s\S]*?)(?=\[CODE\]|\[PIVOT\]|$)/i);
    const codeMatch   = text.match(/\[CODE\]\s*([\s\S]*?)(?=\[PIVOT\]|$)/i);
    const pivotMatch  = text.match(/\[PIVOT\]\s*([\s\S]*?)$/i);
    return {
      phase:      'rescue',
      rescue:     (rescueMatch?.[1] ?? '').trim(),
      fullAnswer: (fullMatch?.[1]   ?? '').trim(),
      rescueCode: (codeMatch?.[1]   ?? '').trim(),
      pivot:      (pivotMatch?.[1]  ?? '').trim(),
    };
  }

  // ── Code agent: [CLARIFY FIRST] ───────────────────────────────────────────
  if (/\[CLARIFY FIRST\]/i.test(text)) {
    const clarifyMatch  = text.match(/\[CLARIFY FIRST\]\s*([\s\S]*?)(?=\[APPROACH\]|$)/i);
    const approachMatch = text.match(/\[APPROACH\]\s*([\s\S]*?)(?=\[THE CODE\]|$)/i);
    const codeMatch     = text.match(/\[THE CODE\]\s*([\s\S]*?)(?=\[FOLLOW-UP TRAP\]|$)/i);
    const trapMatch     = text.match(/\[FOLLOW-UP TRAP\]\s*([\s\S]*?)$/i);
    return {
      phase:        'code',
      clarifyFirst: (clarifyMatch?.[1]  ?? '').trim(),
      approach:     (approachMatch?.[1] ?? '').trim(),
      code:         (codeMatch?.[1]     ?? '').trim(),
      followUpTrap: (trapMatch?.[1]     ?? '').trim(),
    };
  }

  // ── Answer agent: [WHAT THEY'RE TESTING] ─────────────────────────────────
  if (/\[WHAT THEY'?RE TESTING\]/i.test(text)) {
    const testingMatch   = text.match(/\[WHAT THEY'?RE TESTING\]\s*([\s\S]*?)(?=\[SAY THIS FIRST\]|$)/i);
    const sayFirstMatch  = text.match(/\[SAY THIS FIRST\]\s*([\s\S]*?)(?=\[THE MECHANISM\]|$)/i);
    const mechanismMatch = text.match(/\[THE MECHANISM\]\s*([\s\S]*?)(?=\[CLOSE WITH\]|$)/i);
    const closeMatch     = text.match(/\[CLOSE WITH\]\s*([\s\S]*?)$/i);
    return {
      phase:     'answer',
      testing:   (testingMatch?.[1]   ?? '').trim(),
      sayFirst:  (sayFirstMatch?.[1]  ?? '').trim(),
      mechanism: (mechanismMatch?.[1] ?? '').trim(),
      closeWith: (closeMatch?.[1]     ?? '').trim(),
    };
  }

  // ── v1 Override agent: [COURSE CORRECT] ──────────────────────────────────
  if (/\[COURSE CORRECT\]/i.test(text)) {
    const ccMatch    = text.match(/\[COURSE CORRECT\]\s*([\s\S]*?)(?=\[PIVOT MOVE\]|\[BAIT\]|$)/i);
    const pivotMatch = text.match(/\[PIVOT MOVE\]\s*([\s\S]*?)(?=\[BAIT\]|$)/i);
    const baitMatch  = text.match(/\[BAIT\]\s*([\s\S]*?)$/i);
    return {
      phase:        'override',
      courseCorrect: (ccMatch?.[1]    ?? '').trim(),
      pivotMove:    (pivotMatch?.[1]  ?? '').trim(),
      bait:         (baitMatch?.[1]   ?? '').trim(),
    };
  }

  // ── v1 Terminal agent: [ALGORITHM] ───────────────────────────────────────
  if (/\[ALGORITHM\]/i.test(text)) {
    const algMatch  = text.match(/\[ALGORITHM\]\s*([\s\S]*?)(?=\[COMPLEXITY\]|$)/i);
    const compMatch = text.match(/\[COMPLEXITY\]\s*([\s\S]*?)(?=\[EDGE CASES\]|\[CODE\]|$)/i);
    const edgeMatch = text.match(/\[EDGE CASES\]\s*([\s\S]*?)(?=\[CODE\]|$)/i);
    const codeMatch = text.match(/\[CODE\]\s*([\s\S]*?)$/i);
    return {
      phase:      'terminal',
      algorithm:  (algMatch?.[1]  ?? '').trim(),
      complexity: (compMatch?.[1] ?? '').trim(),
      edgeCases:  (edgeMatch?.[1] ?? '').trim(),
      code:       (codeMatch?.[1] ?? '').trim(),
    };
  }

  // ── v1 Support agent: [SPEAKING] ─────────────────────────────────────────
  if (/\[SPEAKING\]/i.test(text)) {
    const speakMatch    = text.match(/\[SPEAKING\]\s*([\s\S]*?)(?=\[STRENGTHEN\]|$)/i);
    const strengthMatch = text.match(/\[STRENGTHEN\]\s*([\s\S]*?)(?=\[WATCH OUT\]|$)/i);
    const watchMatch    = text.match(/\[WATCH OUT\]\s*([\s\S]*?)$/i);
    return {
      phase:     'support',
      speaking:  (speakMatch?.[1]    ?? '').trim(),
      strengthen:(strengthMatch?.[1] ?? '').trim(),
      watchOut:  (watchMatch?.[1]    ?? '').trim(),
    };
  }

  // ── Plain fallback ────────────────────────────────────────────────────────
  return { phase: 'plain', text };
}

// ── Segment parser (for bullet lists and code blocks) ────────────────────────

export function parseSegments(text: string): Segment[] {
  if (!text) return [];
  const segments: Segment[] = [];
  const lines = text.split('\n');
  let inCode = false;
  let codeLang = '';
  let codeLines: string[] = [];
  let textLines: string[] = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith('```') && !inCode) {
      if (textLines.length > 0) { segments.push({ type: 'text', content: textLines }); textLines = []; }
      inCode = true; codeLang = trimmed.slice(3).trim() || ''; codeLines = [];
    } else if (trimmed.startsWith('```') && inCode) {
      segments.push({ type: 'code', content: codeLines.join('\n'), lang: codeLang });
      inCode = false; codeLines = [];
    } else if (inCode) {
      codeLines.push(line);
    } else {
      const cleaned = line.replace(/^[\s\u2022\-\*\d.)+]+/, '').trim();
      if (cleaned) textLines.push(cleaned);
    }
  }
  if (inCode && codeLines.length > 0) segments.push({ type: 'code', content: codeLines.join('\n'), lang: codeLang });
  if (textLines.length > 0) segments.push({ type: 'text', content: textLines });
  return segments;
}
