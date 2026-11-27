/**
 * Which tense a sentence uses the phrase in ("I've run out of" = perfect, "I ran out of" = past), so a practice answer in
 * another tense isn't taken as right ("Tôi hết kem đánh răng rồi" asks for the present perfect). The web and the
 * mobile app have the same rules (lib/phrases.ts) for answers that aren't listed.
 */
export type PhraseTense = 'perfect' | 'past' | 'continuous' | 'modal' | 'present';

/** Common irregular verbs: [past, past participle] ("build" → built, built). */
export const IRREGULAR_VERBS: Record<string, [string, string]> = {
  be: ['was', 'been'], have: ['had', 'had'], do: ['did', 'done'], run: ['ran', 'run'], get: ['got', 'gotten'], take: ['took', 'taken'],
  deal: ['dealt', 'dealt'], give: ['gave', 'given'], go: ['went', 'gone'], come: ['came', 'come'], make: ['made', 'made'],
  put: ['put', 'put'], set: ['set', 'set'], keep: ['kept', 'kept'], find: ['found', 'found'], bring: ['brought', 'brought'],
  think: ['thought', 'thought'], hold: ['held', 'held'], break: ['broke', 'broken'], fall: ['fell', 'fallen'], catch: ['caught', 'caught'],
  cut: ['cut', 'cut'], let: ['let', 'let'], sit: ['sat', 'sat'], stand: ['stood', 'stood'], write: ['wrote', 'written'],
  build: ['built', 'built'], lose: ['lost', 'lost'], send: ['sent', 'sent'], spend: ['spent', 'spent'], lend: ['lent', 'lent'],
  leave: ['left', 'left'], meet: ['met', 'met'], pay: ['paid', 'paid'], say: ['said', 'said'], tell: ['told', 'told'],
  sell: ['sold', 'sold'], buy: ['bought', 'bought'], fight: ['fought', 'fought'], teach: ['taught', 'taught'], seek: ['sought', 'sought'],
  feel: ['felt', 'felt'], lead: ['led', 'led'], read: ['read', 'read'], hear: ['heard', 'heard'], hang: ['hung', 'hung'],
  shut: ['shut', 'shut'], shake: ['shook', 'shaken'], speak: ['spoke', 'spoken'], wake: ['woke', 'woken'], drive: ['drove', 'driven'],
  ride: ['rode', 'ridden'], rise: ['rose', 'risen'], show: ['showed', 'shown'], see: ['saw', 'seen'], know: ['knew', 'known'],
  grow: ['grew', 'grown'], throw: ['threw', 'thrown'], blow: ['blew', 'blown'], draw: ['drew', 'drawn'], fly: ['flew', 'flown'],
  begin: ['began', 'begun'], drink: ['drank', 'drunk'], sing: ['sang', 'sung'], swim: ['swam', 'swum'], eat: ['ate', 'eaten'],
  forget: ['forgot', 'forgotten'], choose: ['chose', 'chosen'], freeze: ['froze', 'frozen'], steal: ['stole', 'stolen'],
  wear: ['wore', 'worn'], tear: ['tore', 'torn'], bear: ['bore', 'borne'], stick: ['stuck', 'stuck'], strike: ['struck', 'struck'],
  win: ['won', 'won'], spin: ['spun', 'spun'], dig: ['dug', 'dug'], feed: ['fed', 'fed'], bend: ['bent', 'bent'], bet: ['bet', 'bet'],
  hit: ['hit', 'hit'], hurt: ['hurt', 'hurt'], cost: ['cost', 'cost'], quit: ['quit', 'quit'], split: ['split', 'split'],
  spread: ['spread', 'spread'], shoot: ['shot', 'shot'], sleep: ['slept', 'slept'], sweep: ['swept', 'swept'], understand: ['understood', 'understood'],
  light: ['lit', 'lit'], slide: ['slid', 'slid'], hide: ['hid', 'hidden'], bite: ['bit', 'bitten'], mean: ['meant', 'meant']
};

/** Past forms of irregular verbs (the head of a phrasal verb). */
export const PAST: Record<string, string[]> = Object.fromEntries(
  Object.entries(IRREGULAR_VERBS).map(([v, [past]]) => [v, v === 'be' ? ['was', 'were'] : [past]])
);

const PERFECT = new Set(['have', 'has', 'had']);
const MODAL = new Set(['will', 'would', 'can', 'cannot', 'could', 'should', 'must', 'may', 'might', 'shall', 'to', 'going']);
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
  // "The team's handed off", "She's taken over": 's + past participle is has + V3.
  const ppOf = IRREGULAR_VERBS[base]?.[1] ?? pastForms(base)[0];
  if (base !== 'be' && head !== base && head === ppOf) {
    const raw = sentence.toLowerCase().replace(/[’‘`]/g, "'");
    const r = new RegExp(re, 'i').exec(raw);
    if (r && /'s\s+$/.test(raw.slice(0, r.index))) return 'perfect';
  }
  if (base === 'be') return head === 'was' || head === 'were' ? 'past' : 'present';
  return pastForms(base).includes(head) ? 'past' : 'present';
}
