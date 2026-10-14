/**
 * "Word form" questions from a word family (TOEIC Part 5 style): an example sentence of one family member
 * with that member blanked out and another member as the hint, e.g. "The ___ (decide) was announced yesterday."
 * Pure functions, no Nest / Mongoose, so they can be tested offline.
 */

/** The fields of a family member this needs (FamilyMember from ./family fits). */
export interface WordFormMember {
  word: string;
  pos: string;
  vi?: string;
  ex?: string;
}

export interface WordForm {
  /** The example sentence with the answer blanked as "___", followed by " (hint word)". */
  prompt: string;
  /** The answer's part of speech, lower case ("noun") — the key clue. */
  pos: string;
  /** The answer exactly as it appears in the example sentence. */
  answer: string;
  /** The family member the hint word comes from. */
  hint: string;
  /** "decide (v) → decision (n) → decisive (adj) → decisively (adv)". */
  family: string;
  /** The answer member's Vietnamese meaning. */
  vi: string;
}

const POS_SHORT: Record<string, string> = { Noun: 'n', Verb: 'v', Adjective: 'adj', Adverb: 'adv' };

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** "decide (v) → decision (n) → decisive (adj) → decisively (adv)" (members with pos Other have no tag). */
export function familyLine(family: WordFormMember[]): string {
  return family.map((m) => (POS_SHORT[m.pos] ? m.word + ' (' + POS_SHORT[m.pos] + ')' : m.word)).join(' → ');
}

/** Where the member's own word appears in its example as a whole word (case-insensitive), or null. */
function findIn(m: WordFormMember): { index: number; text: string } | null {
  const word = m.word.trim();
  if (!m.ex || !word) return null;
  const re = new RegExp("(?<![\\p{L}\\p{N}'’-])" + escapeRegex(word) + "(?![\\p{L}\\p{N}'’-])", 'iu');
  const r = re.exec(m.ex);
  return r ? { index: r.index, text: r[0] } : null;
}

/** The hint for a member: another member of the family, preferring the verb, else the shortest. */
function hintFor(family: WordFormMember[], m: WordFormMember): string | null {
  const others = family.filter((o) => o !== m && o.word.trim() && o.word.trim().toLowerCase() !== m.word.trim().toLowerCase());
  if (!others.length) return null;
  const verb = others.find((o) => o.pos === 'Verb');
  return (verb ?? [...others].sort((a, b) => a.word.trim().length - b.word.trim().length)[0]).word.trim();
}

/** Members a word-form question can be made about (their example contains them, and there is a different hint word). */
export function usableMembers(family: WordFormMember[] | undefined | null): WordFormMember[] {
  if (!Array.isArray(family) || family.length < 2) return [];
  return family.filter((m) => {
    const found = findIn(m);
    const hint = hintFor(family, m);
    return !!found && !!hint && hint.toLowerCase() !== found.text.toLowerCase();
  });
}

/**
 * A word-form question from a family, or null when no member is usable.
 * `random` picks among the usable members (default Math.random).
 */
export function wordFormQuestion(family: WordFormMember[] | undefined | null, random: () => number = Math.random): WordForm | null {
  const usable = usableMembers(family);
  if (!usable.length) return null;
  const m = usable[Math.min(usable.length - 1, Math.floor(random() * usable.length))];
  const found = findIn(m)!;
  const hint = hintFor(family!, m)!;
  const ex = m.ex!;
  return {
    prompt: ex.slice(0, found.index) + '___ (' + hint + ')' + ex.slice(found.index + found.text.length),
    pos: m.pos.toLowerCase(),
    answer: found.text,
    hint,
    family: familyLine(family!),
    vi: (m.vi ?? '').trim()
  };
}

/** A key that is the same for the same family whichever member it is stored on. */
export function familyKey(family: WordFormMember[]): string {
  return family.map((m) => m.word.trim().toLowerCase()).sort().join('|');
}
