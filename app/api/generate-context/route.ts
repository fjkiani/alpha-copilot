/**
 * POST /api/generate-context
 * Takes a job description / company context and uses LLM to generate:
 *   1. Domain-specific keyterms for AssemblyAI STT boosting
 *   2. A contextual prompt for AssemblyAI turn detection
 *
 * Input:  { context: string }
 * Output: { keyterms: string[], prompt: string }
 */

function getSystemPrompt(): string {
  return `You are a technical interview preparation assistant. Given a job description or company context, extract two things:

1. **keyterms**: A flat JSON array of 20-40 domain-specific technical terms that the candidate and interviewer are likely to say during this interview. Focus on:
   - Technology stack terms (frameworks, languages, tools)
   - Company-specific product names, team names, platform names
   - Industry jargon and acronyms
   - Architecture patterns mentioned
   - Compliance/certification terms
   Only include terms that are hard to transcribe (acronyms, brand names, technical terms). Don't include common English words.

2. **prompt**: A single sentence describing the audio context for a speech-to-text model. Format: "[Role] technical interview discussing [key topics]. Speakers may pause mid-question."

OUTPUT STRICTLY IN JSON FORMAT:
{
  "keyterms": ["term1", "term2", ...],
  "prompt": "string"
}

No markdown. No prose. Just the JSON object.`;
}

function parseJSON(text: string): { keyterms: string[]; prompt: string } {
  try {
    return JSON.parse(text) as { keyterms: string[]; prompt: string };
  } catch {
    const cleaned = text.replace(/```json?\n?/gi, '').replace(/```/g, '').trim();
    try {
      return JSON.parse(cleaned) as { keyterms: string[]; prompt: string };
    } catch {
      return { keyterms: [], prompt: 'Technical job interview between two speakers.' };
    }
  }
}

export async function POST(request: Request) {
  try {
    const { context } = (await request.json()) as { context?: string };
    if (!context?.trim()) {
      return Response.json({ error: 'No context provided' }, { status: 400 });
    }

    const messages = [
      { role: 'system', content: getSystemPrompt() },
      { role: 'user', content: `Here is the job description / interview context:\n\n${context}` },
    ];

    // Use OpenRouter (same as the rest of Alpha's LLM stack)
    const apiKey = process.env.OPENROUTER_API_KEY;
    if (!apiKey) {
      return Response.json({ error: 'OPENROUTER_API_KEY not configured' }, { status: 500 });
    }

    const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000',
        'X-Title': 'Alpha Copilot',
      },
      body: JSON.stringify({
        model: 'qwen/qwen-plus-2025-07-28',
        messages,
        temperature: 0.2,
        max_tokens: 500,
        response_format: { type: 'json_object' },
      }),
    });

    if (!res.ok) throw new Error(`OpenRouter ${res.status}: ${await res.text()}`);
    const data = (await res.json()) as {
      choices: Array<{ message: { content: string } }>;
    };
    const text = data.choices?.[0]?.message?.content ?? '';
    return Response.json(parseJSON(text));
  } catch (err) {
    console.error('[generate-context] Error:', err);
    return Response.json({ error: (err as Error).message }, { status: 500 });
  }
}
