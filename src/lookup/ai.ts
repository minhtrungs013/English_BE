import { claudeFetch } from '../audit/claude';
import { LEVELS, POS_LIST, type Level } from '../common/constants';
import { FAMILY_POS, cleanFamily, type FamilyMember } from '../common/family';
import { TOPICS, type Topic } from '../library/library.schema';

export interface AiWord {
  ipa: string; pos: string; meaning: string; vi: string; ex: string; syn: string[]; ant: string[]; level: Level;
  family: FamilyMember[];
  /** The library topic the word fits best (used when it's shared). */
  topic: Topic;
}

const SYSTEM = `You write entries for a vocabulary app used by Vietnamese software developers learning professional English (IT work, interviews, meetings, TOEIC).
Return ONLY a JSON object with these keys:
- "ipa": American English IPA between slashes, e.g. "/mənˈteɪn/" (whole phrase for multi-word entries)
- "pos": exactly one of ${POS_LIST.map((p) => '"' + p + '"').join(', ')} (phrasal verbs are "Verb", compound nouns "Noun", idioms "Other")
- "meaning": a clear, learner-friendly English definition of the first (work / IT) meaning, one sentence ending with a period, at most 110 characters
- "vi": 1–3 short Vietnamese meanings separated by ", ", the meaning used at work / in IT first, then other common ones (e.g. platform → "nền tảng, sân ga, bục"); one meaning when the word has only one
- "ex": a realistic workplace example sentence that contains the word exactly as given (same spelling and casing)
- "syn": up to 3 lowercase synonyms (array, may be empty)
- "ant": up to 2 lowercase antonyms (array, may be empty)
- "level": CEFR level, one of ${LEVELS.map((l) => '"' + l + '"').join(', ')}
- "topic": where the word is mostly used, one of ${TOPICS.map((t) => '"' + t + '"').join(', ')} (it = software work, leader = managing a team, customer = clients and support, toeic = general business English)
- "family": the word family: common related forms of the same root (e.g. decide → decide, decision, decisive, decisively, indecisive), at most 6, INCLUDING the word itself; [] when the word has no common related forms (and for phrases). Each item: {"word": the form (lowercase unless a proper noun), "pos": one of ${FAMILY_POS.map((p) => '"' + p + '"').join(', ')}, "vi": short Vietnamese translation (at most 60 characters), "ex": optional short workplace example sentence using that form (at most 120 characters), "note": optional hint of at most 25 characters, e.g. "opposite (in-)"}. Only real, commonly used words; no rare or invented forms.
If the input is not a real English word or phrase, return {"error":"unknown"}.`;

const str = (v: unknown, max: number): string => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const list = (v: unknown, max: number): string[] =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string' && !!x.trim()).map((x) => x.trim().slice(0, 60)).slice(0, max) : [];

/** The AI's word family, checked: invalid members dropped, the word itself first if it was left out, at most 6. */
export function aiFamily(v: unknown, word: string, pos: string, vi: string): FamilyMember[] {
  return cleanFamily(v, { max: 6, strict: true, self: { word, pos, vi: vi.split(',')[0] } });
}

/**
 * Asks OpenAI for a dictionary entry. Returns null when the word isn't recognised or the call fails,
 * so the caller can fall back to the free dictionary. Every field is validated before it's used.
 */
// export async function aiLookup(word: string, apiKey: string, model: string): Promise<AiWord | null> {
//   let res: Response;
//   try {
//     res = await fetch('https://api.openai.com/v1/chat/completions', {
//       method: 'POST',
//       headers: { Authorization: 'Bearer ' + apiKey, 'Content-Type': 'application/json' },
//       body: JSON.stringify({
//         model,
//         temperature: 0.3,
//         response_format: { type: 'json_object' },
//         messages: [{ role: 'system', content: SYSTEM }, { role: 'user', content: 'Word: ' + word }]
//       }),
//       signal: AbortSignal.timeout(20000)
//     });
//   } catch {
//     return null;
//   }
//   if (!res.ok) {
//     // Log the status only (never the key); 401 = bad key, 429 = quota/rate limit.
//     console.warn('[Lookup] OpenAI request failed with status ' + res.status);
//     return null;
//   }
//   try {
//     const body = (await res.json()) as { choices?: { message?: { content?: string } }[] };
//     const o = JSON.parse(body.choices?.[0]?.message?.content ?? '{}') as Record<string, unknown>;
//     if (o.error || !str(o.meaning, 200)) return null;
//     const pos = str(o.pos, 20);
//     const level = str(o.level, 2) as Level;
//     const ex = str(o.ex, 300);
//     return {
//       ipa: str(o.ipa, 80),
//       pos: (POS_LIST as readonly string[]).includes(pos) ? pos : 'Other',
//       meaning: str(o.meaning, 200),
//       vi: str(o.vi, 200),
//       ex: ex.toLowerCase().includes(word.toLowerCase()) ? ex : '',
//       syn: list(o.syn, 3),
//       ant: list(o.ant, 2),
//       level: (LEVELS as readonly string[]).includes(level) ? level : 'B1',
//       family: aiFamily(o.family, word, pos, str(o.vi, 200))
//     };
//   } catch {
//     return null;
//   }
// }

export async function aiLookup(word: string, apiKey: string, model: string, action = 'lookup'): Promise<AiWord | null> {
  let res: Response;
  try {
    res = await claudeFetch(action, apiKey, {
      model,
      max_tokens: 1000,
      system: SYSTEM,
      messages: [{ role: 'user', content: 'Word: ' + word }]
    }, { signal: AbortSignal.timeout(20000), detail: word });
  } catch (e) {
    console.warn('[Lookup] fetch failed: ' + String(e));
    return null;
  }
  if (!res.ok) {
    // Log the status only (never the key); 401 = bad key, 429 = rate limit, 529 = Claude overloaded.
    console.warn('[Lookup] Claude request failed with status ' + res.status + ': ' + (await res.text().catch(() => '')).slice(0, 300));
    return null;
  }
  try {
    const body = (await res.json()) as { content?: { type: string; text?: string }[] };
    const text = (body.content ?? []).filter((b) => b.type === 'text').map((b) => b.text ?? '').join('');
    // Claude has no json_object mode, so cut the JSON out in case it adds a code fence or a sentence around it.
    const start = text.indexOf('{');
    const end = text.lastIndexOf('}');
    const o = JSON.parse(start >= 0 && end > start ? text.slice(start, end + 1) : '{}') as Record<string, unknown>;
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
      level: (LEVELS as readonly string[]).includes(level) ? level : 'B1',
      family: aiFamily(o.family, word, pos, str(o.vi, 200)),
      topic: (TOPICS as readonly string[]).includes(str(o.topic, 20)) ? (str(o.topic, 20) as Topic) : 'other'
    };
  } catch (e) {
    console.warn('[Lookup] parse failed: ' + String(e));
    return null;
  }
}