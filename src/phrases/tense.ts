/**
 * Which tense a sentence uses the phrase in ("I've run out of" = perfect, "I ran out of" = past), so a practice answer in
 * another tense isn't taken as right ("Tôi hết kem đánh răng rồi" asks for the present perfect). The web and the
 * mobile app have the same rules (lib/phrases.ts) for answers that aren't listed.
 */
export type PhraseTense = 'perfect' | 'past' | 'continuous' | 'modal' | 'present';

/** Past forms of common irregular verbs (the head of a phrasal verb). */
export const PAST: Record<string, string[]> = {
  be: ['was', 'were'], have: ['had'], do: ['did'], run: ['ran'], get: ['got'], take: ['took'], deal: ['dealt'], give: ['gave'],
  go: ['went'], come: ['came'], make: ['made'], put: ['put'], set: ['set'], keep: ['kept'], find: ['found'], bring: ['brought'],
  think: ['thought'], hold: ['held'], break: ['broke'], fall: ['fell'], catch: ['caught'], cut: ['cut'], let: ['let'],
  sit: ['sat'], stand: ['stood'], write: ['wrote'], turn: ['turned'], look: ['looked'], fill: ['filled'], pick: ['picked']
};

const PERFECT = new Set(['have', 'has', 'had']);
const MODAL = new Set(['will', 'would', 'can', 'could', 'should', 'must', 'may', 'might', 'shall', 'to', 'going']);
const AUX = new Set([...PERFECT, ...MODAL, 'do', 'does', 'did', 'am', 'is', 'are', 'was', 'were', 'be', 'been', 'being']);

/** Contractions written out ("I've" → "I have", "haven't" → "have not"). */
export function expand(s: string): string {
  return s.toLowerCase().replace(/[’‘`]/g, "'")
    .replace(/\bcan't\b/g, 'can not').replace(/\bwon't\b/g, 'will not').replace(/n't\b/g, ' not')
    .replace(/'ve\b/g, ' have').replace(/'re\b/g, ' are').replace(/'m\b/g, ' am').replace(/'ll\b/g, ' will').replace(/'d\b/g, ' would')
    .replace(/'s been\b/g, ' has been').replace(/\b(it|he|she|that|what|who|there|here)'s\b/g, '$1 is');
}

/** The past forms of a verb: the irregular ones listed, otherwise -ed. */
export function pastForms(v: string): string[] {
  if (PAST[v]) return PAST[v];
  if (/e$/.test(v)) return [v + 'd'];
  if (/[^aeiou]y$/.test(v)) return [v.slice(0, -1) + 'ied'];
  if (/^[^aeiou]*[aeiou][^aeiouwxy]$/.test(v)) return [v + v.slice(-1) + 'ed'];
  return [v + 'ed'];
}

/**
 * The tense the phrase is used in: perfect (have/has + V3), past (V2, did), continuous (V-ing), modal (will, can, to…)
 * or present. '' when the phrase isn't in the sentence. `re` finds the phrase in any verb form (phraseRe).
 */
export function tenseOf(sentence: string, re: string, base: string): PhraseTense | '' {
  const t = expand(sentence);
  const m = new RegExp(re, 'i').exec(t);
  if (!m) return '';
  const head = m[0].trim().split(/\s+/)[0].replace(/^'/, '');
  if (/ing$/.test(head) && head !== base) return 'continuous';
  const aux = t.slice(0, m.index).split(/[^a-z]+/).filter(Boolean).reverse().find((w) => AUX.has(w));
  if (aux && PERFECT.has(aux) && !(base === 'have' && aux === head)) return 'perfect';
  if (aux && MODAL.has(aux)) return 'modal';
  if (aux === 'did') return 'past';
  if (base === 'be') return head === 'was' || head === 'were' ? 'past' : 'present';
  return pastForms(base).includes(head) ? 'past' : 'present';
}
