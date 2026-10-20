/**
 * Tense exercises: the tenses we practise, verb forms for the built-in templates (used when AI isn't available),
 * and the OpenAI prompt for AI-written questions.
 */

import type { Part } from './sentence-rules';

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
  /** The full sentence (answer in place) split into subject / verb / object…, when known. */
  parts?: Part[];
}

export interface RecapDraft { text: string; vi: string }

/* ---------- verb forms ---------- */

/** Irregular verbs common at work: base → [past, past participle]. */
export const IRREGULAR: Record<string, [string, string]> = {
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
  reset: ['reset', 'reset'], broadcast: ['broadcast', 'broadcast'], spin: ['spun', 'spun'], bind: ['bound', 'bound'], seek: ['sought', 'sought'],
  // More irregular verbs (so choices are never "rided" or "eated").
  arise: ['arose', 'arisen'], awake: ['awoke', 'awoken'], bear: ['bore', 'borne'], beat: ['beat', 'beaten'], become: ['became', 'become'],
  bend: ['bent', 'bent'], bet: ['bet', 'bet'], bite: ['bit', 'bitten'], bleed: ['bled', 'bled'], blow: ['blew', 'blown'],
  breed: ['bred', 'bred'], burst: ['burst', 'burst'], cast: ['cast', 'cast'], cling: ['clung', 'clung'], cost: ['cost', 'cost'],
  creep: ['crept', 'crept'], dig: ['dug', 'dug'], drink: ['drank', 'drunk'], eat: ['ate', 'eaten'], feed: ['fed', 'fed'],
  fight: ['fought', 'fought'], flee: ['fled', 'fled'], fly: ['flew', 'flown'], forbid: ['forbade', 'forbidden'], forecast: ['forecast', 'forecast'],
  foresee: ['foresaw', 'foreseen'], forgive: ['forgave', 'forgiven'], grind: ['ground', 'ground'], hang: ['hung', 'hung'], hurt: ['hurt', 'hurt'],
  kneel: ['knelt', 'knelt'], lay: ['laid', 'laid'], lie: ['lay', 'lain'], light: ['lit', 'lit'], mislead: ['misled', 'misled'],
  mistake: ['mistook', 'mistaken'], misunderstand: ['misunderstood', 'misunderstood'], overcome: ['overcame', 'overcome'], oversee: ['oversaw', 'overseen'], overtake: ['overtook', 'overtaken'],
  quit: ['quit', 'quit'], ride: ['rode', 'ridden'], ring: ['rang', 'rung'], rise: ['rose', 'risen'], shake: ['shook', 'shaken'],
  shed: ['shed', 'shed'], shine: ['shone', 'shone'], shoot: ['shot', 'shot'], shrink: ['shrank', 'shrunk'], sing: ['sang', 'sung'],
  sink: ['sank', 'sunk'], slide: ['slid', 'slid'], speed: ['sped', 'sped'], spread: ['spread', 'spread'], spring: ['sprang', 'sprung'],
  stick: ['stuck', 'stuck'], steal: ['stole', 'stolen'], sting: ['stung', 'stung'], strike: ['struck', 'struck'], swear: ['swore', 'sworn'],
  sweep: ['swept', 'swept'], swim: ['swam', 'swum'], swing: ['swung', 'swung'], tear: ['tore', 'torn'], undergo: ['underwent', 'undergone'],
  undertake: ['undertook', 'undertaken'], uphold: ['upheld', 'upheld'], weep: ['wept', 'wept'], wind: ['wound', 'wound'], withhold: ['withheld', 'withheld'],
  withstand: ['withstood', 'withstood'], weave: ['wove', 'woven'], outdo: ['outdid', 'outdone'], outgrow: ['outgrew', 'outgrown'], overhear: ['overheard', 'overheard'],
  oversleep: ['overslept', 'overslept'], overspend: ['overspent', 'overspent'], overrun: ['overran', 'overrun'], overpay: ['overpaid', 'overpaid'], rethink: ['rethought', 'rethought'],
  resell: ['resold', 'resold'], retell: ['retold', 'retold'], redo: ['redid', 'redone'], remake: ['remade', 'remade'], repay: ['repaid', 'repaid'],
  resend: ['resent', 'resent'], rewind: ['rewound', 'rewound'], input: ['input', 'input'], output: ['output', 'output'], bid: ['bid', 'bid'],
  burn: ['burned', 'burned'], dream: ['dreamed', 'dreamed'], learn: ['learned', 'learned'], spell: ['spelled', 'spelled'], spill: ['spilled', 'spilled'],
  prove: ['proved', 'proven'], sew: ['sewed', 'sewn'], sow: ['sowed', 'sown'], swell: ['swelled', 'swollen'], dwell: ['dwelt', 'dwelt'],
  lean: ['leaned', 'leaned'], leap: ['leapt', 'leapt'], smell: ['smelled', 'smelled'], spoil: ['spoiled', 'spoiled'], spit: ['spat', 'spat'],
  strive: ['strove', 'striven'], stride: ['strode', 'stridden'], string: ['strung', 'strung'], tread: ['trod', 'trodden'], wed: ['wed', 'wed'],
  wring: ['wrung', 'wrung'], slit: ['slit', 'slit'], sling: ['slung', 'slung'], stink: ['stank', 'stunk'], thrust: ['thrust', 'thrust']
};

const VOWEL = /[aeiouy]/;

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
/** `parts`: the sentence split into subject / verb / object… with the answer `a` in place (for "Grammar" in the app). */
export interface Template { tense: Tense; sentence: string; answer: (f: Forms) => string; explain: string; parts: (a: string) => Part[] }

export const TEMPLATES: Template[] = [
  { tense: 'present-simple', sentence: 'Our lead usually ___ ({v}) it on Monday mornings.', answer: (f) => f.third, explain: 'Thói quen lặp lại (“usually”), chủ ngữ số ít → động từ thêm -s/-es.',
    parts: (a) => [{ text: 'Our lead', role: 'S' }, { text: 'usually', role: 'adv' }, { text: a, role: 'V' }, { text: 'it', role: 'O' }, { text: 'on Monday mornings.', role: 'time' }] },
  { tense: 'present-continuous', sentence: 'Please wait, the team ___ ({v}) it right now.', answer: (f) => 'is ' + f.ing, explain: 'Việc đang diễn ra ngay lúc nói (“right now”) → is/am/are + V-ing.',
    parts: (a) => [{ text: 'Please wait,', role: 'other' }, { text: 'the team', role: 'S' }, { text: a, role: 'V' }, { text: 'it', role: 'O' }, { text: 'right now.', role: 'time' }] },
  { tense: 'present-perfect', sentence: 'We ___ ({v}) it already for this release.', answer: (f) => 'have ' + f.pp, explain: 'Việc đã xong, kết quả còn liên quan tới hiện tại (“already”) → have/has + V3.',
    parts: (a) => [{ text: 'We', role: 'S' }, { text: a, role: 'V' }, { text: 'it', role: 'O' }, { text: 'already', role: 'adv' }, { text: 'for this release.', role: 'other' }] },
  { tense: 'past-simple', sentence: 'Yesterday, the developer ___ ({v}) it before the stand-up.', answer: (f) => f.past, explain: 'Việc đã xảy ra và kết thúc trong quá khứ (“yesterday”) → V2/V-ed.',
    parts: (a) => [{ text: 'Yesterday,', role: 'time' }, { text: 'the developer', role: 'S' }, { text: a, role: 'V' }, { text: 'it', role: 'O' }, { text: 'before the stand-up.', role: 'time' }] },
  { tense: 'past-continuous', sentence: 'I ___ ({v}) it when the server went down.', answer: (f) => 'was ' + f.ing, explain: 'Việc đang diễn ra thì một việc khác xen vào (“when … went down”) → was/were + V-ing.',
    parts: (a) => [{ text: 'I', role: 'S' }, { text: a, role: 'V' }, { text: 'it', role: 'O' }, { text: 'when the server went down.', role: 'clause' }] },
  { tense: 'future-simple', sentence: 'Don’t worry, I ___ ({v}) it tomorrow.', answer: (f) => 'will ' + f.base, explain: 'Quyết định/lời hứa về tương lai (“tomorrow”) → will + V.',
    parts: (a) => [{ text: 'Don’t worry,', role: 'other' }, { text: 'I', role: 'S' }, { text: a, role: 'V' }, { text: 'it', role: 'O' }, { text: 'tomorrow.', role: 'time' }] },
  { tense: 'going-to', sentence: 'We have a plan: next sprint we ___ ({v}) it for the client.', answer: (f) => 'are going to ' + f.base, explain: 'Kế hoạch đã định trước (“we have a plan”) → am/is/are going to + V.',
    parts: (a) => [{ text: 'We have a plan:', role: 'other' }, { text: 'next sprint', role: 'time' }, { text: 'we', role: 'S' }, { text: a, role: 'V' }, { text: 'it', role: 'O' }, { text: 'for the client.', role: 'other' }] }
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
      answer, accept: answer.startsWith('have ') ? ["'ve " + answer.slice(5)] : [], explain: t.explain, parts: t.parts(answer)
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
 "explain": one short sentence in Vietnamese explaining why this tense is used,
 "parts": the FULL sentence (answer in place of ___, no brackets) split into consecutive chunks that together give back the sentence word for word, each {"text": chunk, "role": one of "S" (subject), "V" (the whole verb phrase), "O" (object), "C" (complement), "time", "place", "adv" (other adverb), "clause" (a whole dependent clause), "other"}}.
"recap": when REVIEW WORDS are given, a short workplace story (3–4 sentences, B1 level) using as many of them as possible, mixing past, present and future tenses, as {"text": English story, "vi": Vietnamese translation}; otherwise null.`;

const str = (v: unknown, max: number): string => (typeof v === 'string' ? v.trim().slice(0, max) : '');

/** Asks OpenAI for tense questions (and a recap story). Returns null when the call fails, so callers can use the templates. */
// export async function aiTenseQuestions(
//   words: string[], reviewWords: string[], tenses: readonly Tense[], perWord: number, apiKey: string, model: string
// ): Promise<{ questions: TenseDraft[]; recap: RecapDraft | null } | null> {
//   const user = 'WORDS: ' + words.join(' | ') + '\nQuestions per word: ' + perWord + '\nUse only these tenses: ' + tenses.join(', ') +
//     '\nAbout half "fill" and half "choice".' + (reviewWords.length ? '\nREVIEW WORDS (for the recap): ' + reviewWords.join(' | ') : '\nNo review words: recap must be null.');
//   let res: Response;
//   try {
//     res = await fetch('https://api.openai.com/v1/chat/completions', {
//       method: 'POST',
//       headers: { Authorization: 'Bearer ' + apiKey, 'Content-Type': 'application/json' },
//       body: JSON.stringify({ model, temperature: 0.5, response_format: { type: 'json_object' }, messages: [{ role: 'system', content: SYSTEM }, { role: 'user', content: user }] }),
//       signal: AbortSignal.timeout(45000)
//     });
//   } catch {
//     return null;
//   }
//   if (!res.ok) {
//     console.warn('[Courses] OpenAI request failed with status ' + res.status);
//     return null;
//   }
//   try {
//     const body = (await res.json()) as { choices?: { message?: { content?: string } }[] };
//     const o = JSON.parse(body.choices?.[0]?.message?.content ?? '{}') as { questions?: unknown[]; recap?: unknown };
//     const known = new Map(words.map((w) => [w.toLowerCase(), w]));
//     const questions: TenseDraft[] = [];
//     for (const raw of Array.isArray(o.questions) ? o.questions : []) {
//       const q = raw as Record<string, unknown>;
//       const word = known.get(str(q.word, 80).toLowerCase());
//       const tense = str(q.tense, 30) as Tense;
//       const sentence = str(q.sentence, 300);
//       const answer = str(q.answer, 80);
//       const kind = q.kind === 'choice' ? 'tenseChoice' : 'tense';
//       const choices = Array.isArray(q.choices) ? [...new Set(q.choices.map((c) => str(c, 80)).filter(Boolean))] : [];
//       if (!word || !TENSES.includes(tense) || !answer || (sentence.match(/___/g) ?? []).length !== 1) continue;
//       if (kind === 'tenseChoice' && (choices.length !== 4 || !choices.includes(answer))) continue;
//       questions.push({ word, tense, kind, prompt: sentence, choices: kind === 'tenseChoice' ? choices : [], answer, accept: [], explain: str(q.explain, 300), parts: Array.isArray(q.parts) ? (q.parts as Part[]) : undefined });
//     }
//     const r = o.recap as Record<string, unknown> | null | undefined;
//     const recap = r && str(r.text, 1200) ? { text: str(r.text, 1200), vi: str(r.vi, 1500) } : null;
//     return { questions, recap };
//   } catch {
//     return null;
//   }
// }

export async function aiTenseQuestions(
  words: string[], reviewWords: string[], tenses: readonly Tense[], perWord: number, apiKey: string, model: string
): Promise<{ questions: TenseDraft[]; recap: RecapDraft | null } | null> {
  const user = 'WORDS: ' + words.join(' | ') + '\nQuestions per word: ' + perWord + '\nUse only these tenses: ' + tenses.join(', ') +
    '\nAbout half "fill" and half "choice".' + (reviewWords.length ? '\nREVIEW WORDS (for the recap): ' + reviewWords.join(' | ') : '\nNo review words: recap must be null.');
  let res: Response;
  try {
    res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({ model, max_tokens: 4000, system: SYSTEM, messages: [{ role: 'user', content: user }] }),
      signal: AbortSignal.timeout(45000)
    });
  } catch (e) {
    console.warn('[Courses] fetch failed: ' + String(e));
    return null;
  }
  if (!res.ok) {
    console.warn('[Courses] Claude request failed with status ' + res.status);
    return null;
  }
  try {
    const body = (await res.json()) as { content?: { type: string; text?: string }[] };
    const text = (body.content ?? []).filter((b) => b.type === 'text').map((b) => b.text ?? '').join('');
    // Claude has no json_object mode, so cut the JSON out in case it adds a code fence or a sentence around it.
    const start = text.indexOf('{');
    const end = text.lastIndexOf('}');
    const o = JSON.parse(start >= 0 && end > start ? text.slice(start, end + 1) : '{}') as { questions?: unknown[]; recap?: unknown };
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
      questions.push({ word, tense, kind, prompt: sentence, choices: kind === 'tenseChoice' ? choices : [], answer, accept: [], explain: str(q.explain, 300), parts: Array.isArray(q.parts) ? (q.parts as Part[]) : undefined });
    }
    const r = o.recap as Record<string, unknown> | null | undefined;
    const recap = r && str(r.text, 1200) ? { text: str(r.text, 1200), vi: str(r.vi, 1500) } : null;
    return { questions, recap };
  } catch (e) {
    console.warn('[Courses] parse failed: ' + String(e));
    return null;
  }
}