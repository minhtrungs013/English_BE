import { LEVELS, POS_LIST } from '../common/constants';
import { cleanFamily, type FamilyMember } from '../common/family';
import { TOPICS } from '../library/library.schema';
export { IMPORT_AUTHOR } from '../library/library.schema';
import { cleanUsage } from '../usage/usage';

export interface ImportWord {
  word: string; wordLower: string; ipa: string; pos: string; meaning: string; vi: string; ex: string;
  syn: string[]; ant: string[]; level: string; topic: string; family: FamilyMember[];
}
export type ImportUsage = NonNullable<ReturnType<typeof cleanUsage>>;
export interface CleanedItem { word?: ImportWord; usage?: ImportUsage; errors: string[]; warnings: string[]; /** The word as written, for the report. */ raw: string }

const WORD_RE = /^\p{L}[\p{L}'’ .-]*$/u;
const s = (v: unknown, max: number) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, max) : '');
const list = (v: unknown, max: number) => {
  const out: string[] = [];
  for (const x of Array.isArray(v) ? v : []) {
    const t = s(x, 60).toLowerCase();
    if (t && !out.includes(t)) out.push(t);
  }
  return out.slice(0, max);
};
/** "noun" / "NOUN" → "Noun"; '' when it isn't one of the app's parts of speech. */
const posOf = (v: unknown) => {
  const t = s(v, 20).toLowerCase();
  return POS_LIST.find((p) => p.toLowerCase() === t) ?? '';
};
export const importKey = (word: string) => word.trim().toLowerCase().replace(/\s+/g, ' ');

/** Checks one item of an import file (see library-import/PROMPT.md); errors make it unusable, warnings don't. */
export function cleanImportItem(raw: unknown): CleanedItem {
  const errors: string[] = [], warnings: string[] = [];
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { errors: ['Not an object.'], warnings, raw: '' };
  const o = raw as Record<string, unknown>;
  const word = s(o.word, 80);
  if (!word) errors.push('No "word".');
  else if (!WORD_RE.test(word)) errors.push('"word" has characters a word can’t have.');
  const pos = posOf(o.pos);
  if (!pos) errors.push('"pos" must be one of ' + POS_LIST.join(', ') + '.');
  const meaning = s(o.meaning, 300), vi = s(o.vi, 300);
  if (!meaning) errors.push('No "meaning".');
  if (!vi) errors.push('No "vi".');
  const levelIn = s(o.level, 2).toUpperCase();
  const level = (LEVELS as readonly string[]).includes(levelIn) ? levelIn : 'B1';
  if (levelIn && level !== levelIn) warnings.push('Unknown level “' + levelIn + '”: B1 used.');
  const topicIn = s(o.topic, 20).toLowerCase();
  const topic = (TOPICS as readonly string[]).includes(topicIn) ? topicIn : 'other';
  if (topicIn && topic !== topicIn) warnings.push('Unknown topic “' + topicIn + '”: other used.');
  const ex = s(o.ex, 300);
  if (!ex) warnings.push('No example sentence.');
  else if (word && !ex.toLowerCase().includes(word.toLowerCase().slice(0, Math.max(3, word.length - 2)))) warnings.push('The example may not use the word.');
  const family = cleanFamily(o.family, { max: 6, strict: true, self: { word, pos, vi: vi.split(',')[0] } });
  if (Array.isArray(o.family) && o.family.length >= 2 && !family.length) warnings.push('Word family skipped (not valid).');
  let usage: ImportUsage | undefined;
  if (o.usage != null) {
    usage = (o.usage && typeof o.usage === 'object' ? cleanUsage(o.usage as Record<string, unknown>) : null) ?? undefined;
    if (!usage) warnings.push('"usage" skipped (needs patterns or mistakes).');
  }
  if (errors.length) return { errors, warnings: [], raw: typeof o.word === 'string' ? o.word.trim().slice(0, 80) : '' };
  return {
    word: { word, wordLower: importKey(word), ipa: s(o.ipa, 80), pos, meaning, vi, ex, syn: list(o.syn, 5), ant: list(o.ant, 5), level, topic, family },
    usage, errors, warnings, raw: word
  };
}
