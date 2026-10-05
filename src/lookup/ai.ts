import { LEVELS, POS_LIST, type Level } from '../common/constants';

export interface AiWord {
  ipa: string; pos: string; meaning: string; vi: string; ex: string; syn: string[]; ant: string[]; level: Level;
}

const SYSTEM = `You write entries for a vocabulary app used by Vietnamese software developers learning professional English (IT work, interviews, meetings, TOEIC).
Return ONLY a JSON object with these keys:
- "ipa": American English IPA between slashes, e.g. "/mənˈteɪn/" (whole phrase for multi-word entries)
- "pos": exactly one of ${POS_LIST.map((p) => '"' + p + '"').join(', ')} (phrasal verbs are "Verb", compound nouns "Noun", idioms "Other")
- "meaning": a clear, learner-friendly English definition, one sentence ending with a period, at most 110 characters
- "vi": a natural Vietnamese translation (1–2 short alternatives separated by ", ")
- "ex": a realistic workplace example sentence that contains the word exactly as given (same spelling and casing)
- "syn": up to 3 lowercase synonyms (array, may be empty)
- "ant": up to 2 lowercase antonyms (array, may be empty)
- "level": CEFR level, one of ${LEVELS.map((l) => '"' + l + '"').join(', ')}
If the input is not a real English word or phrase, return {"error":"unknown"}.`;

const str = (v: unknown, max: number): string => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const list = (v: unknown, max: number): string[] =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string' && !!x.trim()).map((x) => x.trim().slice(0, 60)).slice(0, max) : [];

/**
 * Asks OpenAI for a dictionary entry. Returns null when the word isn't recognised or the call fails,
 * so the caller can fall back to the free dictionary. Every field is validated before it's used.
 */
export async function aiLookup(word: string, apiKey: string, model: string): Promise<AiWord | null> {
  let res: Response;
  try {
    res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + apiKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        temperature: 0.3,
        response_format: { type: 'json_object' },
        messages: [{ role: 'system', content: SYSTEM }, { role: 'user', content: 'Word: ' + word }]
      }),
      signal: AbortSignal.timeout(20000)
    });
  } catch {
    return null;
  }
  if (!res.ok) {
    // Log the status only (never the key); 401 = bad key, 429 = quota/rate limit.
    console.warn('[Lookup] OpenAI request failed with status ' + res.status);
    return null;
  }
  try {
    const body = (await res.json()) as { choices?: { message?: { content?: string } }[] };
    const o = JSON.parse(body.choices?.[0]?.message?.content ?? '{}') as Record<string, unknown>;
    if (o.error || !str(o.meaning, 200)) return null;
    const pos = str(o.pos, 20);
    const level = str(o.level, 2) as Level;
    const ex = str(o.ex, 300);
    return {
      ipa: str(o.ipa, 80),
      pos: (POS_LIST as readonly string[]).includes(pos) ? pos : 'Other',
      meaning: str(o.meaning, 200),
      vi: str(o.vi, 200),
      ex: ex.toLowerCase().includes(word.toLowerCase()) ? ex : '',
      syn: list(o.syn, 3),
      ant: list(o.ant, 2),
      level: (LEVELS as readonly string[]).includes(level) ? level : 'B1'
    };
  } catch {
    return null;
  }
}
