/**
 * Tense exercises: the tenses we practise, verb forms for the built-in templates (used when AI isn't available),
 * and the OpenAI prompt for AI-written questions.
 */

export const TENSES = ['present-simple', 'present-continuous', 'present-perfect', 'past-simple', 'past-continuous', 'future-simple', 'going-to'] as const;
export type Tense = (typeof TENSES)[number];

export const TENSE_LABEL: Record<Tense, string> = {
  'present-simple': 'Present simple',
  'present-continuous': 'Present continuous',
  'present-perfect': 'Present perfect',
  'past-simple': 'Past simple',
  'past-continuous': 'Past continuous',
  'future-simple': 'Future simple (will)',
  'going-to': 'Future (be going to)'
};

/** A tense question before it's saved: typed ('tense': fill the verb in brackets) or multiple choice ('tenseChoice'). */
export interface TenseDraft {
  word: string;
  tense: Tense;
  kind: 'tense' | 'tenseChoice';
  prompt: string;
  choices: string[];
  answer: string;
  accept: string[];
  explain: string;
}

export interface RecapDraft { text: string; vi: string }

/* ---------- verb forms ---------- */

/** Irregular verbs common at work: base → [past, past participle]. */
const IRREGULAR: Record<string, [string, string]> = {
  be: ['was', 'been'], begin: ['began', 'begun'], break: ['broke', 'broken'], bring: ['brought', 'brought'], build: ['built', 'built'],
  buy: ['bought', 'bought'], catch: ['caught', 'caught'], choose: ['chose', 'chosen'], come: ['came', 'come'], cut: ['cut', 'cut'],
  deal: ['dealt', 'dealt'], do: ['did', 'done'], draw: ['drew', 'drawn'], drive: ['drove', 'driven'], fall: ['fell', 'fallen'],
  feel: ['felt', 'felt'], find: ['found', 'found'], fix: ['fixed', 'fixed'], forget: ['forgot', 'forgotten'], freeze: ['froze', 'frozen'],
  get: ['got', 'gotten'], give: ['gave', 'given'], go: ['went', 'gone'], grow: ['grew', 'grown'], have: ['had', 'had'],
  hear: ['heard', 'heard'], hide: ['hid', 'hidden'], hold: ['held', 'held'], keep: ['kept', 'kept'], know: ['knew', 'known'],
  lead: ['led', 'led'], leave: ['left', 'left'], lend: ['lent', 'lent'], let: ['let', 'let'], lose: ['lost', 'lost'],
  make: ['made', 'made'], mean: ['meant', 'meant'], meet: ['met', 'met'], pay: ['paid', 'paid'], put: ['put', 'put'],
  read: ['read', 'read'], rebuild: ['rebuilt', 'rebuilt'], rewrite: ['rewrote', 'rewritten'], run: ['ran', 'run'], say: ['said', 'said'],
  see: ['saw', 'seen'], sell: ['sold', 'sold'], send: ['sent', 'sent'], set: ['set', 'set'], shut: ['shut', 'shut'],
  show: ['showed', 'shown'], sit: ['sat', 'sat'], sleep: ['slept', 'slept'], speak: ['spoke', 'spoken'], spend: ['spent', 'spent'],
  split: ['split', 'split'], stand: ['stood', 'stood'], take: ['took', 'taken'], teach: ['taught', 'taught'], tell: ['told', 'told'],
  think: ['thought', 'thought'], throw: ['threw', 'thrown'], understand: ['understood', 'understood'], undo: ['undid', 'undone'],
  upset: ['upset', 'upset'], wake: ['woke', 'woken'], wear: ['wore', 'worn'], win: ['won', 'won'], withdraw: ['withdrew', 'withdrawn'],
  write: ['wrote', 'written'], overwrite: ['overwrote', 'overwritten'], override: ['overrode', 'overridden'], rerun: ['reran', 'rerun'],
  reset: ['reset', 'reset'], broadcast: ['broadcast', 'broadcast'], spin: ['spun', 'spun'], bind: ['bound', 'bound'], seek: ['sought', 'sought']
};

const VOWEL = /[aeiou]/;

/** Short words ending consonant-vowel-consonant double the last letter (stop → stopped). */
function doubles(v: string): boolean {
  if (v.length > 4 || /[wxy]$/.test(v)) return false;
  return /[^aeiou][aeiou][^aeiou]$/.test(v) && (v.match(/[aeiou]+/g) ?? []).length === 1;
}

function regularPast(v: string): string {
  if (v.endsWith('e')) return v + 'd';
  if (/[^aeiou]y$/.test(v)) return v.slice(0, -1) + 'ied';
  if (doubles(v)) return v + v.slice(-1) + 'ed';
  return v + 'ed';
}

function ing(v: string): string {
  if (v === 'be' || v === 'see') return v + 'ing';
  if (v.endsWith('ie')) return v.slice(0, -2) + 'ying';
  if (v.endsWith('e') && !v.endsWith('ee')) return v.slice(0, -1) + 'ing';
  if (doubles(v)) return v + v.slice(-1) + 'ing';
  return v + 'ing';
}

function third(v: string): string {
  if (v === 'have') return 'has';
  if (v === 'be') return 'is';
  if (/(s|sh|ch|x|z|o)$/.test(v)) return v + 'es';
  if (/[^aeiou]y$/.test(v)) return v.slice(0, -1) + 'ies';
  return v + 's';
}

/** Forms of a verb or phrasal verb ("roll back" → "rolled back"); null when it doesn't look like a verb. */
export function verbForms(raw: string) {
  const parts = raw.trim().toLowerCase().split(/\s+/);
  const [v, ...rest] = parts;
  if (!v || !/^[a-z-]+$/.test(v) || !VOWEL.test(v)) return null;
  const tail = rest.length ? ' ' + rest.join(' ') : '';
  const irr = IRREGULAR[v];
  const past = irr ? irr[0] : regularPast(v);
  const pp = irr ? irr[1] : regularPast(v);
  return { base: v + tail, third: third(v) + tail, past: past + tail, pp: pp + tail, ing: ing(v) + tail };
}

/* ---------- templates (no AI) ---------- */

type Forms = NonNullable<ReturnType<typeof verbForms>>;
interface Template { tense: Tense; sentence: string; answer: (f: Forms) => string; explain: string }

const TEMPLATES: Template[] = [
  { tense: 'present-simple', sentence: 'Our lead usually ___ ({v}) it on Monday mornings.', answer: (f) => f.third, explain: 'Thói quen lặp lại (“usually”), chủ ngữ số ít → động từ thêm -s/-es.' },
  { tense: 'present-continuous', sentence: 'Please wait, the team ___ ({v}) it right now.', answer: (f) => 'is ' + f.ing, explain: 'Việc đang diễn ra ngay lúc nói (“right now”) → is/am/are + V-ing.' },
  { tense: 'present-perfect', sentence: 'We ___ ({v}) it already for this release.', answer: (f) => 'have ' + f.pp, explain: 'Việc đã xong, kết quả còn liên quan tới hiện tại (“already”) → have/has + V3.' },
  { tense: 'past-simple', sentence: 'Yesterday, the developer ___ ({v}) it before the stand-up.', answer: (f) => f.past, explain: 'Việc đã xảy ra và kết thúc trong quá khứ (“yesterday”) → V2/V-ed.' },
  { tense: 'past-continuous', sentence: 'I ___ ({v}) it when the server went down.', answer: (f) => 'was ' + f.ing, explain: 'Việc đang diễn ra thì một việc khác xen vào (“when … went down”) → was/were + V-ing.' },
  { tense: 'future-simple', sentence: 'Don’t worry, I ___ ({v}) it tomorrow.', answer: (f) => 'will ' + f.base, explain: 'Quyết định/lời hứa về tương lai (“tomorrow”) → will + V.' },
  { tense: 'going-to', sentence: 'We have a plan: next sprint we ___ ({v}) it for the client.', answer: (f) => 'are going to ' + f.base, explain: 'Kế hoạch đã định trước (“we have a plan”) → am/is/are going to + V.' }
];

/** Wrong choices for a tense question: the same verb in other tenses. */
function formChoices(f: Forms, answer: string): string[] {
  const all = [f.base, f.third, f.past, 'is ' + f.ing, 'was ' + f.ing, 'have ' + f.pp, 'will ' + f.base, 'are going to ' + f.base, 'will ' + f.past, 'has ' + f.ing];
  const seen = new Set([answer]);
  const wrong = all.filter((x) => (seen.has(x) ? false : (seen.add(x), true)));
  return [answer, ...wrong.sort(() => Math.random() - 0.5).slice(0, 3)];
}

/** Built-in tense questions for a verb, one per chosen tense (alternating typed / multiple choice). */
export function templateQuestions(word: string, tenses: readonly Tense[], perWord: number): TenseDraft[] {
  const f = verbForms(word);
  if (!f) return [];
  const pick = TEMPLATES.filter((t) => tenses.includes(t.tense)).sort(() => Math.random() - 0.5).slice(0, perWord);
  return pick.map((t, i) => {
    const answer = t.answer(f);
    const choice = i % 2 === 1;
    const sentence = t.sentence.replace('{v}', f.base);
    return {
      word, tense: t.tense, kind: choice ? 'tenseChoice' : 'tense',
      // Multiple choice shows the verb forms as choices, so the sentence doesn't need the verb in brackets.
      prompt: choice ? sentence.replace(' (' + f.base + ')', '') : sentence,
      choices: choice ? formChoices(f, answer).sort(() => Math.random() - 0.5) : [],
      answer, accept: answer.startsWith('have ') ? ["'ve " + answer.slice(5)] : [], explain: t.explain
    };
  });
}

/* ---------- AI ---------- */

const SYSTEM = `You write grammar exercises for Vietnamese software developers learning professional English (IT work, meetings with leaders and customers, interviews).
For each vocabulary item, write tense exercises: realistic workplace sentences that use the item, where the learner must use the right TENSE.
- If the item is a verb (or phrasal verb), the learner conjugates the item itself.
- Otherwise, the sentence uses the item naturally and the learner conjugates another common verb in the sentence.
Tenses (use exactly these ids): ${TENSES.join(', ')}.
Each sentence must contain clear time clues (yesterday, right now, since, already, tomorrow, next sprint, when…) so only one tense is correct.
Return ONLY JSON: {"questions":[...], "recap": {...} | null}
Each question: {"word": the vocabulary item exactly as given, "tense": one id, "kind": "fill" or "choice",
 "sentence": the sentence with exactly one "___" where the verb phrase goes; for "fill" put the base verb in brackets right after the blank, e.g. "Yesterday we ___ (deploy) the hotfix.",
 "choices": for "choice" exactly 4 different verb phrases (one correct), for "fill" [],
 "answer": the exact verb phrase that fills the blank (e.g. "deployed", "have fixed", "is reviewing"),
 "explain": one short sentence in Vietnamese explaining why this tense is used}.
"recap": when REVIEW WORDS are given, a short workplace story (3–4 sentences, B1 level) using as many of them as possible, mixing past, present and future tenses, as {"text": English story, "vi": Vietnamese translation}; otherwise null.`;

const str = (v: unknown, max: number): string => (typeof v === 'string' ? v.trim().slice(0, max) : '');

/** Asks OpenAI for tense questions (and a recap story). Returns null when the call fails, so callers can use the templates. */
export async function aiTenseQuestions(
  words: string[], reviewWords: string[], tenses: readonly Tense[], perWord: number, apiKey: string, model: string
): Promise<{ questions: TenseDraft[]; recap: RecapDraft | null } | null> {
  const user = 'WORDS: ' + words.join(' | ') + '\nQuestions per word: ' + perWord + '\nUse only these tenses: ' + tenses.join(', ') +
    '\nAbout half "fill" and half "choice".' + (reviewWords.length ? '\nREVIEW WORDS (for the recap): ' + reviewWords.join(' | ') : '\nNo review words: recap must be null.');
  let res: Response;
  try {
    res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + apiKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, temperature: 0.5, response_format: { type: 'json_object' }, messages: [{ role: 'system', content: SYSTEM }, { role: 'user', content: user }] }),
      signal: AbortSignal.timeout(45000)
    });
  } catch {
    return null;
  }
  if (!res.ok) {
    console.warn('[Courses] OpenAI request failed with status ' + res.status);
    return null;
  }
  try {
    const body = (await res.json()) as { choices?: { message?: { content?: string } }[] };
    const o = JSON.parse(body.choices?.[0]?.message?.content ?? '{}') as { questions?: unknown[]; recap?: unknown };
    const known = new Map(words.map((w) => [w.toLowerCase(), w]));
    const questions: TenseDraft[] = [];
    for (const raw of Array.isArray(o.questions) ? o.questions : []) {
      const q = raw as Record<string, unknown>;
      const word = known.get(str(q.word, 80).toLowerCase());
      const tense = str(q.tense, 30) as Tense;
      const sentence = str(q.sentence, 300);
      const answer = str(q.answer, 80);
      const kind = q.kind === 'choice' ? 'tenseChoice' : 'tense';
      const choices = Array.isArray(q.choices) ? [...new Set(q.choices.map((c) => str(c, 80)).filter(Boolean))] : [];
      if (!word || !TENSES.includes(tense) || !answer || (sentence.match(/___/g) ?? []).length !== 1) continue;
      if (kind === 'tenseChoice' && (choices.length !== 4 || !choices.includes(answer))) continue;
      questions.push({ word, tense, kind, prompt: sentence, choices: kind === 'tenseChoice' ? choices : [], answer, accept: [], explain: str(q.explain, 300) });
    }
    const r = o.recap as Record<string, unknown> | null | undefined;
    const recap = r && str(r.text, 1200) ? { text: str(r.text, 1200), vi: str(r.vi, 1500) } : null;
    return { questions, recap };
  } catch {
    return null;
  }
}
