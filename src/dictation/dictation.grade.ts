/**
 * Dictation grading: compares what the learner typed with the sentence they heard, word by word. Pure (no I/O), so
 * it can be unit-tested and reused anywhere (practice sets, the stateless /grade endpoint, Course days later).
 */

export type TokenStatus = 'ok' | 'near' | 'wrong' | 'missing' | 'extra';
export interface DictationToken { status: TokenStatus; expected?: string; typed?: string }
export interface DictationResult {
  tokens: DictationToken[];
  /** Tokens with status ok. */
  correct: number;
  /** Number of expected tokens. */
  total: number;
  /** round(100 * correct / total). */
  score: number;
  /** Every expected token ok and no extra tokens. */
  passed: boolean;
}

/** A word as shown (original case / punctuation) and its comparison key. */
interface Tok { word: string; key: string; digits: boolean }

/** Curly quotes / apostrophes → straight ones. */
const straight = (s: string) => s.replace(/[‘’‚‛′`´]/g, "'").replace(/[“”„‟″]/g, '"');

/** Punctuation removed from the edges of a word for comparison ("$" counts too, so "$1,250" ≈ "1,250"). */
const EDGE = /^[.,!?;:"()[\]{}…'«»\-–—$]+|[.,!?;:"()[\]{}…'«»\-–—$]+$/g;

const NUMBER_WORDS = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve',
  'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen', 'twenty'];
const NUMBER_BY_WORD = new Map(NUMBER_WORDS.map((w, i) => [w, String(i)]));

/** British → American spelling (both sides are mapped, so either spelling is accepted). */
const BRITISH: Record<string, string> = {};
const addPair = (b: string, a: string) => { BRITISH[b] = a; };
for (const [b, a] of [['colour', 'color'], ['favourite', 'favorite'], ['centre', 'center'], ['programme', 'program'], ['licence', 'license'],
  ['behaviour', 'behavior'], ['catalogue', 'catalog'], ['organisation', 'organization']]) {
  addPair(b, a);
  addPair(b + 's', a + 's');
}
for (const [b, a] of [['organis', 'organiz'], ['analys', 'analyz']]) {
  for (const end of ['e', 'es', 'ed', 'ing']) addPair(b + end, a + end);
}
for (const [b, a] of [['cancelled', 'canceled'], ['cancelling', 'canceling'], ['travelled', 'traveled'], ['travelling', 'traveling'],
  ['traveller', 'traveler'], ['travellers', 'travelers'], ['colourful', 'colorful'], ['favourites', 'favorites']]) addPair(b, a);

/** Words whose "'s" means "is" (elsewhere "'s" is a possessive and stays as it is). */
const IS_WORDS = new Set(['it', 'that', 'there', 'he', 'she', 'what', 'where', 'who', 'here', 'how', 'when', 'why']);

/** "Will" with the case of the original first letter. */
const withCase = (orig: string, word: string) => (orig[0] && orig[0] === orig[0].toUpperCase() && orig[0] !== orig[0].toLowerCase() ? word[0].toUpperCase() + word.slice(1) : word);

/** Expands a contraction into its words ("I'm" → I am, "Don't." → Do not.), keeping edge punctuation on the outer words. */
function expand(word: string): string[] {
  const m = /^([^\p{L}\p{N}]*)(.*?)([^\p{L}\p{N}]*)$/u.exec(word);
  if (!m) return [word];
  const [, lead, core, trail] = m;
  const lc = core.toLowerCase();
  let parts: string[] | null = null;
  if (lc === 'cannot') parts = [core.slice(0, 3), 'not'];
  else if (lc === "can't") parts = [core.slice(0, 3), 'not'];
  else if (lc === "won't") parts = [withCase(core, 'will'), 'not'];
  else if (lc === "shan't") parts = [withCase(core, 'shall'), 'not'];
  else if (lc.endsWith("n't") && lc.length > 3) parts = [core.slice(0, -3), 'not'];
  else if (lc === "i'm") parts = [core.slice(0, 1), 'am'];
  else if (lc.length > 3 && lc.endsWith("'re")) parts = [core.slice(0, -3), 'are'];
  else if (lc.length > 3 && lc.endsWith("'ve")) parts = [core.slice(0, -3), 'have'];
  else if (lc.length > 3 && lc.endsWith("'ll")) parts = [core.slice(0, -3), 'will'];
  else if (lc.length > 2 && lc.endsWith("'d")) parts = [core.slice(0, -2), 'would'];
  else if (lc.endsWith("'s") && IS_WORDS.has(lc.slice(0, -2))) parts = [core.slice(0, -2), 'is'];
  if (!parts) return [word];
  parts[0] = lead + parts[0];
  parts[parts.length - 1] += trail;
  return parts;
}

/** Ordinal words ↔ "1st"…"31st" ("third" = "3rd", "twenty-first" = "21st"). */
const ORDINAL_WORDS = ['first', 'second', 'third', 'fourth', 'fifth', 'sixth', 'seventh', 'eighth', 'ninth', 'tenth', 'eleventh', 'twelfth',
  'thirteenth', 'fourteenth', 'fifteenth', 'sixteenth', 'seventeenth', 'eighteenth', 'nineteenth', 'twentieth'];
const suffix = (n: number) => (n % 10 === 1 && n !== 11 ? 'st' : n % 10 === 2 && n !== 12 ? 'nd' : n % 10 === 3 && n !== 13 ? 'rd' : 'th');
const ORDINAL = new Map<string, string>();
ORDINAL_WORDS.forEach((w, i) => ORDINAL.set(w, i + 1 + suffix(i + 1)));
ORDINAL_WORDS.slice(0, 9).forEach((w, i) => ORDINAL.set('twenty-' + w, 21 + i + suffix(21 + i)));
ORDINAL.set('thirtieth', '30th').set('thirty-first', '31st');

/** The comparison key of one word; `digits` = it is a plain number written in digits (merged with neighbours). */
export function keyOf(word: string): { key: string; digits: boolean } {
  let k = straight(word).toLowerCase();
  let prev = '';
  while (prev !== k) { prev = k; k = k.replace(EDGE, ''); }
  if (/^\d{1,3}(,\d{3})+(\.\d+)?$/.test(k)) k = k.replace(/,/g, '');
  if (k === 'a.m' || k === 'p.m') k = k[0] + 'm';
  const digits = /^\d+$/.test(k);
  k = NUMBER_BY_WORD.get(k) ?? ORDINAL.get(k) ?? BRITISH[k] ?? k;
  return { key: k, digits };
}

/** Words → tokens: contractions expanded, punctuation-only words dropped, runs of digit groups merged ("0903 123 456"). */
export function tokenise(text: string): Tok[] {
  const out: Tok[] = [];
  for (const raw of straight(text ?? '').split(/\s+/).filter(Boolean)) {
    // "16%" is said "16 percent".
    const words = expand(raw).flatMap((w) => { const m = /^(.*\d)%(\W*)$/.exec(w); return m ? [m[1], 'percent' + m[2]] : [w]; });
    for (const word of words) {
      const { key, digits } = keyOf(word);
      if (!key) continue;
      const last = out[out.length - 1];
      if (digits && last?.digits) {
        last.word += ' ' + word;
        last.key += key;
      } else out.push({ word, key, digits });
    }
  }
  return out;
}

/** Character edit distance; swapping two neighbouring letters ("sned" / "send") counts as one edit. */
function editDistance(a: string, b: string, max: number): number {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let prev2: number[] = [];
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) cur[j] = Math.min(cur[j], prev2[j - 2] + 1);
    }
    prev2 = prev;
    prev = cur;
  }
  return prev[b.length];
}

/** A typo rather than a different word: 1 letter off (keys ≥ 4 letters) or 2 (≥ 8). Numbers are never "near". */
export function isNear(a: string, b: string): boolean {
  if (/\d/.test(a) || /\d/.test(b)) return false;
  // A missing or extra ending (work / works, close / closed) is a listening mistake, not a typo.
  const [short, long] = a.length <= b.length ? [a, b] : [b, a];
  if (long.startsWith(short) && /^(s|es|d|ed|ing)$/.test(long.slice(short.length))) return false;
  const len = Math.min(a.length, b.length);
  if (len < 4) return false;
  const allowed = len >= 8 ? 2 : 1;
  return editDistance(a, b, allowed) <= allowed;
}

const NEAR_COST = 0.5;

export function gradeDictation(expected: string, typed: string): DictationResult {
  const e = tokenise(expected);
  const t = tokenise(typed);
  const n = e.length;
  const m = t.length;
  // Substitution cost of e[i] / t[j]: 0 same key, 0.5 near, 1 different.
  const sub = (i: number, j: number) => (e[i].key === t[j].key ? 0 : isNear(e[i].key, t[j].key) ? NEAR_COST : 1);
  const dp: number[][] = Array.from({ length: n + 1 }, (_, i) => {
    const row = new Array<number>(m + 1).fill(0);
    row[0] = i;
    return row;
  });
  for (let j = 0; j <= m; j++) dp[0][j] = j;
  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) dp[i][j] = Math.min(dp[i - 1][j - 1] + sub(i - 1, j - 1), dp[i - 1][j] + 1, dp[i][j - 1] + 1);
  }
  // Backtrack; on equal cost a substitution wins over delete + insert.
  const tokens: DictationToken[] = [];
  let i = n;
  let j = m;
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0) {
      const c = sub(i - 1, j - 1);
      if (dp[i][j] === dp[i - 1][j - 1] + c) {
        tokens.push({ status: c === 0 ? 'ok' : c === NEAR_COST ? 'near' : 'wrong', expected: e[i - 1].word, typed: t[j - 1].word });
        i--; j--;
        continue;
      }
    }
    if (i > 0 && dp[i][j] === dp[i - 1][j] + 1) {
      tokens.push({ status: 'missing', expected: e[i - 1].word });
      i--;
    } else {
      tokens.push({ status: 'extra', typed: t[j - 1].word });
      j--;
    }
  }
  tokens.reverse();
  const correct = tokens.filter((x) => x.status === 'ok').length;
  const extra = tokens.some((x) => x.status === 'extra');
  const score = n ? Math.round((100 * correct) / n) : extra ? 0 : 100;
  return { tokens, correct, total: n, score, passed: correct === n && !extra };
}
