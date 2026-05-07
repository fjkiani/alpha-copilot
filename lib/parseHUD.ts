/**
 * parseHUD.ts — Pure parsing functions for the Stealth Copilot HUD
 *
 * Zero React imports. Pure string → object/array transforms.
 *
 * Exports:
 *   parseHUDSections(raw) → { phase, motive?, delivery?, move?, bait?, ... }
 *   parseSegments(text)   → [{ type: 'text'|'code', content, lang? }]
 */

export type HUDPhase =
  | 'thinking'
  | 'waiting'
  | 'override'
  | 'terminal'
  | 'hud'
  | 'plain'
  | 'rescue'
  | 'support';

export interface HUDParsed {
  phase: HUDPhase;
  // hud
  motive?: string;
  delivery?: string;
  move?: string;
  bait?: string;
  diagnostic?: string;
  // override
  courseCorrect?: string;
  pivotMove?: string;
  // terminal
  algorithm?: string;
  complexity?: string;
  edgeCases?: string;
  code?: string;
  // rescue
  rescue?: string;
  pivot?: string;
  // support
  speaking?: string;
  strengthen?: string;
  watchOut?: string;
  // plain
  text?: string;
}

export interface Segment {
  type: 'text' | 'code';
  content: string | string[];
  lang?: string;
}

export function parseHUDSections(raw: string): HUDParsed | null {
  if (!raw) return null;

  // Strip completed THINK/PLAN blocks
  let text = raw.replace(/<THINK[\s\S]*?<\/THINK>/gi, '');
  text = text.replace(/<PLAN[\s\S]*?<\/PLAN>/gi, '');
  text = text.replace(/<\/?EXECUTE>/gi, '');

  // Detect incomplete THINK/PLAN block (still streaming)
  const thinkOpen = raw.lastIndexOf('<THINK');
  const thinkClose = raw.lastIndexOf('</THINK');
  if (thinkOpen >= 0 && (thinkClose < 0 || thinkClose < thinkOpen)) {
    return { phase: 'thinking' };
  }
  const planOpen = raw.lastIndexOf('<PLAN');
  const planClose = raw.lastIndexOf('</PLAN');
  if (planOpen >= 0 && (planClose < 0 || planClose < planOpen)) {
    return { phase: 'thinking' };
  }

  text = text.trim();
  if (!text) return { phase: 'waiting' };

  // Override mode: [COURSE CORRECT]
  if (/\[COURSE CORRECT\]/i.test(text)) {
    const ccMatch = text.match(/\[COURSE CORRECT\]\s*([\s\S]*?)(?=\[THE PIVOT MOVE\]|\[PIVOT\]|$)/i);
    const pivotMatch = text.match(/\[(?:THE )?PIVOT(?: MOVE)?\]\s*([\s\S]*?)(?=\[THE BAIT\]|\[THE DIAGNOSTIC\]|$)/i);
    const baitMatch = text.match(/\[THE BAIT\]\s*([\s\S]*?)(?=\[THE DIAGNOSTIC\]|$)/i);
    const diagMatch = text.match(/\[THE DIAGNOSTIC\]\s*([\s\S]*?)$/i);
    return {
      phase: 'override',
      courseCorrect: (ccMatch?.[1] ?? '').trim(),
      pivotMove: (pivotMatch?.[1] ?? '').trim(),
      bait: (baitMatch?.[1] ?? '').trim(),
      diagnostic: (diagMatch?.[1] ?? '').trim(),
    };
  }

  // Rescue mode: [RESCUE]
  if (/\[RESCUE\]/i.test(text)) {
    const rescueMatch = text.match(/\[RESCUE\]\s*([\s\S]*?)(?=\[THE PIVOT\]|\[PIVOT\]|$)/i);
    const pivotMatch = text.match(/\[(?:THE )?PIVOT\]\s*([\s\S]*?)$/i);
    return {
      phase: 'rescue',
      rescue: (rescueMatch?.[1] ?? '').trim(),
      pivot: (pivotMatch?.[1] ?? '').trim(),
    };
  }

  // Support mode: [ALPHA IS SPEAKING]
  if (/\[ALPHA IS SPEAKING\]/i.test(text)) {
    const speakingMatch = text.match(/\[ALPHA IS SPEAKING\]\s*([\s\S]*?)(?=\[STRENGTHEN\]|$)/i);
    const strengthenMatch = text.match(/\[STRENGTHEN\]\s*([\s\S]*?)(?=\[WATCH OUT\]|$)/i);
    const watchMatch = text.match(/\[WATCH OUT\]\s*([\s\S]*?)$/i);
    return {
      phase: 'support',
      speaking: (speakingMatch?.[1] ?? '').trim(),
      strengthen: (strengthenMatch?.[1] ?? '').trim(),
      watchOut: (watchMatch?.[1] ?? '').trim(),
    };
  }

  // Terminal mode: [ALGORITHM]
  if (/\[ALGORITHM\]/i.test(text)) {
    const algoMatch = text.match(/\[ALGORITHM\]\s*([\s\S]*?)(?=\[COMPLEXITY\]|$)/i);
    const compMatch = text.match(/\[COMPLEXITY\]\s*([\s\S]*?)(?=\[EDGE CASES\]|$)/i);
    const edgeMatch = text.match(/\[EDGE CASES\]\s*([\s\S]*?)(?=\[THE CODE\]|$)/i);
    const codeMatch = text.match(/\[THE CODE\]\s*([\s\S]*?)$/i);
    return {
      phase: 'terminal',
      algorithm: (algoMatch?.[1] ?? '').trim(),
      complexity: (compMatch?.[1] ?? '').trim(),
      edgeCases: (edgeMatch?.[1] ?? '').trim(),
      code: (codeMatch?.[1] ?? '').trim(),
    };
  }

  // Standard HUD: [MOTIVE], [DELIVERY], [THE MOVE], [THE BAIT], [THE DIAGNOSTIC]
  const motiveMatch = text.match(/\[MOTIVE\]\s*([\s\S]*?)(?=\[DELIVERY\]|\[THE MOVE\]|\[MOVE\]|$)/i);
  const deliveryMatch = text.match(/\[DELIVERY\]\s*([\s\S]*?)(?=\[THE MOVE\]|\[MOVE\]|$)/i);
  const moveMatch = text.match(/\[(?:THE )?MOVE\]\s*([\s\S]*?)(?=\[THE BAIT\]|\[BAIT\]|\[THE DIAGNOSTIC\]|$)/i);
  const baitMatch = text.match(/\[(?:THE )?BAIT\]\s*([\s\S]*?)(?=\[THE DIAGNOSTIC\]|$)/i);
  const diagMatch = text.match(/\[THE DIAGNOSTIC\]\s*([\s\S]*?)$/i);

  const hasSections = motiveMatch || deliveryMatch || moveMatch || baitMatch || diagMatch;
  if (!hasSections) return { phase: 'plain', text };

  return {
    phase: 'hud',
    motive: (motiveMatch?.[1] ?? '').trim(),
    delivery: (deliveryMatch?.[1] ?? '').trim(),
    move: (moveMatch?.[1] ?? '').trim(),
    bait: (baitMatch?.[1] ?? '').trim(),
    diagnostic: (diagMatch?.[1] ?? '').trim(),
  };
}

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
      if (textLines.length > 0) {
        segments.push({ type: 'text', content: textLines });
        textLines = [];
      }
      inCode = true;
      codeLang = trimmed.slice(3).trim() || '';
      codeLines = [];
    } else if (trimmed.startsWith('```') && inCode) {
      segments.push({ type: 'code', content: codeLines.join('\n'), lang: codeLang });
      inCode = false;
      codeLines = [];
    } else if (inCode) {
      codeLines.push(line);
    } else {
      const cleaned = line.replace(/^[\s\u2022\-\*\d.)+]+/, '').trim();
      if (cleaned) textLines.push(cleaned);
    }
  }

  if (inCode && codeLines.length > 0) {
    segments.push({ type: 'code', content: codeLines.join('\n'), lang: codeLang });
  }
  if (textLines.length > 0) {
    segments.push({ type: 'text', content: textLines });
  }

  return segments;
}
