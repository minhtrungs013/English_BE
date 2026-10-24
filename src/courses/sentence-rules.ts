/**
 * Grammar of a sentence without AI: the full sentence of a question, the tense of simple sentences by pattern,
 * the time clues in it, and the hint for a word-form blank.
 */
import { LESSON_BY_ID } from '../grammar/grammar.content';
import { IRREGULAR, TENSES, type Tense } from './tense';

export const ROLES = ['S', 'V', 'O', 'C', 'time', 'place', 'adv', 'clause', 'other'] as const;
export type Role = (typeof ROLES)[number];
export interface Part { text: string; role: Role }

/** Same sentence → same key: lower case, curly quotes and spaces evened out. */
export function sentenceKey(s: string): string {
  return s.replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/\s+/g, ' ').trim().toLowerCase();
}

/** Letters and digits only: to check that parts put together give back the sentence. */
const bare = (s: string) => s.replace(/[‘’]/g, "'").toLowerCase().replace(/[^a-z0-9']/g, '');

/** Parts that are non-empty and spell out exactly the sentence (ignoring spaces and punctuation); otherwise null. */
export function checkParts(text: string, raw: unknown): Part[] | null {
  if (!Array.isArray(raw) || raw.length < 2 || raw.length > 12) return null;
  const parts: Part[] = [];
  for (const p of raw) {
    const o = p as Record<string, unknown>;
    const t = typeof o?.text === 'string' ? o.text.trim().slice(0, 200) : '';
    const role = (ROLES as readonly string[]).includes(o?.role as string) ? (o.role as Role) : null;
    if (!t || !role) return null;
    parts.push({ text: t, role });
  }
  return bare(parts.map((p) => p.text).join(' ')) === bare(text) ? parts : null;
}

/** The blank in a question prompt: "___", optionally followed by "(verb)" or "(hint)". */
const BLANK = /_{3,}(\s*\([^)]*\))?/;

/** The sentence a question is about, with the answer in place; '' for questions without a sentence. */
export function fullSentence(q: { type: string; prompt: string; answer: string }): string {
  if (q.type === 'dictation') return q.answer.trim();
  if (!['tense', 'tenseChoice', 'blank', 'wordform', 'wordFill', 'wordFillChoice'].includes(q.type) || !BLANK.test(q.prompt)) return '';
  return q.prompt.replace(BLANK, q.answer).replace(/\s+/g, ' ').trim();
}

/* ---------- tense by pattern ---------- */

const PAST_IRREGULAR = new Set(Object.entries(IRREGULAR).filter(([base, [past]]) => past !== base).map(([, [past]]) => past));
const PP_IRREGULAR = new Set(Object.values(IRREGULAR).map(([, pp]) => pp));
/** Words before an "-ed" word that make it an adjective or a participle, not a past verb ("the updated file", "is required"). */
const NOT_PAST_BEFORE = new Set(['a', 'an', 'the', 'this', 'that', 'these', 'those', 'my', 'your', 'our', 'their', 'his', 'her', 'its', 'very', 'more', 'most', 'get', 'gets', 'got', 'be', 'been', 'being', 'am', 'is', 'are', 'was', 'were', 'have', 'has', 'had', 'feel', 'feels', 'felt', 'seem', 'seems', 'look', 'looks', 'of', 'and', 'or', 'with', 'well', 'fully', 'not']);
const ED_NOT_VERB = new Set(['need', 'speed', 'feed', 'seed', 'bed', 'red', 'shed', 'bleed', 'proceed', 'succeed', 'exceed', 'indeed', 'embed', 'deed', 'weed']);
const MODALS = /\b(can|could|should|must|may|might|would|shall|cannot|can't|couldn't|shouldn't|mustn't|wouldn't)\b/;
const BE_PRESENT = "(?:am|is|are|'m|'re|'s|isn't|aren't)";

/**
 * The tense of a simple sentence, or null when the pattern isn't clear: several tenses (two clauses), a modal,
 * the passive, an imperative. Better no answer than a wrong one.
 */
export function ruleTense(sentence: string): Tense | null {
  const s = ' ' + sentence.toLowerCase().replace(/[‘’]/g, "'").replace(/[^a-z' ]+/g, ' ').replace(/\s+/g, ' ') + ' ';
  const words = s.trim().split(' ');
  if (MODALS.test(s)) return null;
  if (/^(please|let's|don't|do not)\b/.test(s.trim()) && !/\b(i|we|you|he|she|it|they)\s+(will|'ll)\b/.test(s)) {
    // "Please send it" / "Don't forget…": an imperative, unless a clause after it carries the tense ("Don't worry, I'll…").
    if (!/\b(will|'ll|was|were|have|has|did|am|is|are)\b/.test(s)) return null;
  }
  const found = new Set<Tense>();
  if (new RegExp('\\b' + BE_PRESENT + "\\s+(?:not\\s+)?going to\\s+[a-z]+").test(s)) found.add('going-to');
  if (/\b(will|'ll|won't)\s+(not\s+)?[a-z]+/.test(s)) found.add('future-simple');
  const perfect = /\b(have|has|'ve|haven't|hasn't)\s+(?:not\s+|already\s+|just\s+|never\s+|ever\s+|recently\s+)?([a-z]+)\b/.exec(s);
  if (perfect && (perfect[2].endsWith('ed') || PP_IRREGULAR.has(perfect[2]) || perfect[2] === 'been')) found.add('present-perfect');
  if (/\b(was|were|wasn't|weren't)\s+(not\s+)?[a-z]{2,}ing\b/.test(s)) found.add('past-continuous');
  const cont = new RegExp('\\b' + BE_PRESENT + '\\s+(?:not\\s+|still\\s+|currently\\s+|now\\s+)?([a-z]{2,}ing)\\b').exec(s);
  if (cont && !/going to/.test(s.slice(cont.index, cont.index + 30))) found.add('present-continuous');
  // Passive (be + past participle) isn't covered by the lessons yet.
  if (/\b(am|is|are|was|were|be|been|being|'s|'re)\s+(?:not\s+|already\s+|being\s+)?([a-z]+ed|[a-z]+en)\b/.test(s)) {
    const m = /\b(am|is|are|was|were|be|been|being|'s|'re)\s+(?:not\s+|already\s+|being\s+)?([a-z]+)\b/.exec(s);
    if (m && (m[2].endsWith('ed') || PP_IRREGULAR.has(m[2])) && !found.has('present-perfect')) return null;
  }
  const pastIdx = words.findIndex((w, i) => {
    if (w === 'did' || w === "didn't" || w === 'was' || w === 'were' || w === "wasn't" || w === "weren't") return true;
    if (PAST_IRREGULAR.has(w) && !NOT_PAST_BEFORE.has(words[i - 1] ?? '')) return true;
    return w.length > 4 && w.endsWith('ed') && !ED_NOT_VERB.has(w) && i > 0 && !NOT_PAST_BEFORE.has(words[i - 1]) && !/\b(have|has|had|'ve)\b/.test(words.slice(Math.max(0, i - 3), i).join(' '));
  });
  if (pastIdx >= 0 && !found.has('past-continuous')) {
    // "was/were" alone (no -ing) is the past of "be": past simple too.
    found.add('past-simple');
  }
  if (found.size === 1) return [...found][0];
  if (found.size > 1) return null;
  // Nothing else matched: a simple present sentence ("Our team holds a stand-up every morning", "It is ready").
  if (/\b(had|'d)\b/.test(s)) return null;
  return words.length >= 3 ? 'present-simple' : null;
}

/* ---------- time clues ---------- */

/** Common clues per tense, besides the lesson's own list (which has long hints like "Look!" that rarely match). */
const CLUES: Record<Tense, string[]> = {
  'present-simple': ['always', 'usually', 'often', 'sometimes', 'rarely', 'never', 'every day', 'every week', 'every month', 'every morning', 'every sprint', 'on mondays', 'once a week', 'twice a week', 'normally', 'generally'],
  'present-continuous': ['now', 'right now', 'at the moment', 'currently', 'today', 'this week', 'this sprint', 'look', 'listen', 'at present'],
  'present-perfect': ['already', 'yet', 'just', 'ever', 'never', 'since', 'so far', 'recently', 'lately', 'up to now', 'for years', 'this year'],
  'past-simple': ['yesterday', 'last week', 'last month', 'last year', 'last sprint', 'last night', 'ago', 'in 2020', 'the other day', 'last friday', 'last monday', 'this morning'],
  'past-continuous': ['when', 'while', 'at that time', 'at this time yesterday', 'all day yesterday'],
  'future-simple': ['tomorrow', 'next week', 'next month', 'next year', 'next sprint', 'soon', 'later', 'tonight', 'i think', 'probably', 'i promise', "don't worry", 'in the future'],
  'going-to': ['next week', 'next month', 'next sprint', 'next quarter', 'tomorrow', 'the plan is', 'we have a plan', "we've decided", 'look']
};

/** Simple clues from the lesson list: "last week / last month" → both; parentheses and "…" dropped. */
function lessonClues(t: Tense): string[] {
  return (LESSON_BY_ID.get(t)?.signals ?? []).flatMap((x) => x.split('/')).map((x) => x.replace(/\(.*?\)|…|\.\.\./g, '').trim().toLowerCase()).filter((x) => x.length > 2 && x.split(' ').length <= 4);
}

/** The clues of `tense` found in the sentence, as written there; longest first and without overlaps ("next week", not "week"). */
export function findSignals(sentence: string, tense: string): string[] {
  if (!(TENSES as readonly string[]).includes(tense)) return [];
  const low = sentence.toLowerCase().replace(/[‘’]/g, "'");
  const all = [...new Set([...CLUES[tense as Tense], ...lessonClues(tense as Tense)])].sort((a, b) => b.length - a.length);
  const out: string[] = [];
  const taken: [number, number][] = [];
  for (const c of all) {
    const m = new RegExp('(^|[^a-z])(' + c.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + ')(?=$|[^a-z])').exec(low);
    if (!m) continue;
    const start = m.index + m[1].length, end = start + c.length;
    if (taken.some(([a, b]) => start < b && end > a)) continue;
    taken.push([start, end]);
    out.push(sentence.slice(start, end));
  }
  return out.slice(0, 3);
}

/* ---------- word-form blank ---------- */

const POS_VI: Record<string, string> = { noun: 'danh từ', verb: 'động từ', adjective: 'tính từ', adverb: 'trạng từ' };
const DETERMINERS = new Set(['a', 'an', 'the', 'my', 'your', 'our', 'their', 'his', 'her', 'its', 'this', 'that', 'these', 'those', 'some', 'any', 'no', 'every', 'each']);
const BE = new Set(['am', 'is', 'are', 'was', 'were', 'be', 'been', 'being', 'become', 'becomes', 'became', 'seem', 'seems', 'look', 'looks', 'feel', 'feels']);

/** Why the blank of a word-form question takes that kind of word, from the word just before it. */
export function wordFormNote(prompt: string, answer: string, pos: string): { on: string; text: string } | null {
  const vi = POS_VI[pos.toLowerCase()];
  if (!vi) return null;
  const before = prompt.split(BLANK)[0].trim().split(/\s+/).pop()?.toLowerCase().replace(/[^a-z']/g, '') ?? '';
  let why = '';
  if (pos === 'noun' && DETERMINERS.has(before)) why = ' vì đứng sau “' + before + '” (mạo từ / từ hạn định / tính từ sở hữu).';
  else if (pos === 'adjective' && BE.has(before)) why = ' vì đứng sau động từ “' + before + '” để miêu tả chủ ngữ.';
  else if (pos === 'adjective' && DETERMINERS.has(before)) why = ' vì đứng trước danh từ để bổ nghĩa cho nó.';
  else if (pos === 'adverb') why = ' vì bổ nghĩa cho động từ (hoặc tính từ) bên cạnh.';
  else if (pos === 'verb') why = ' vì đây là hành động chính của chủ ngữ.';
  return { on: answer, text: 'Chỗ trống cần một ' + vi + ' (' + pos.toLowerCase() + ')' + (why || '.') };
}
