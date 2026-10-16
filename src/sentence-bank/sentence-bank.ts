import { Injectable, Module } from '@nestjs/common';
import { InjectModel, MongooseModule, Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Model, type HydratedDocument, Types } from 'mongoose';
import { TENSES, verbForms, type Tense } from '../courses/tense';

/**
 * The word sentence bank: checked example sentences (about 4 per library word, written by an AI and checked by
 * scripts/check-word-sentences.js), shared by every course. Course owners copy sentences into their question bank;
 * their grammar is stored in sentence_grammar under the same sentence.
 */
@Schema({ collection: 'word_sentences', timestamps: false })
export class WordSentence {
  @Prop({ index: true }) wordId: string;
  @Prop({ required: true }) word: string;
  /** The word as it appears in the sentence ("deadlines"). */
  @Prop({ default: '' }) form: string;
  @Prop({ required: true }) sentence: string;
  @Prop({ required: true, unique: true }) key: string;
  @Prop({ default: 'other' }) context: string;
  @Prop({ default: '' }) level: string;
  @Prop({ default: '' }) topic: string;
  /** A tense lesson id, or '' (modal, passive, imperative…). */
  @Prop({ default: '' }) tense: string;
  /** The main verb phrase as written ("has fixed") and its base verb ("fix"). */
  @Prop({ default: '' }) verb: string;
  @Prop({ default: '' }) base: string;
  @Prop({ default: 'ai' }) source: string;
}
export type WordSentenceDocument = HydratedDocument<WordSentence>;
export const WordSentenceSchema = SchemaFactory.createForClass(WordSentence);

/** A tense question made from a bank sentence. */
export interface SentenceQuestion { prompt: string; answer: string; accept: string[]; choices: string[]; canChoose: boolean }

/** Who the verb agrees with: I (am/was), he/she/it or one thing (is/has/-s), or the rest (are/have). */
export type Agreement = 'I' | 'sing' | 'plural';

/** The agreement shown by an answer ("has fixed", "is", "fixes"), or null when it doesn't show one ("fixed", "will fix"). */
function agreementOfAnswer(base: string, answer: string): Agreement | null {
  const a = answer.toLowerCase();
  if (/^(am|'m)\b/.test(a)) return 'I';
  if (/^(has|is|does)\b/.test(a) || a === verbForms(base)?.third) return 'sing';
  if (/^(have|are|do)\b/.test(a)) return 'plural';
  return null;
}

/** The agreement of a subject: pronouns, then plural nouns ("the developers", "Lan and Minh"), else one thing or person. */
export function agreementOfSubject(subject: string): Agreement {
  const s = subject.trim().toLowerCase().replace(/[^a-z' ]/g, ' ').replace(/\s+/g, ' ').trim();
  if (s === 'i') return 'I';
  if (/^(you|we|they|these|those|both|many|several|few|all)( |$)/.test(s) || / and /.test(s)) return 'plural';
  if (/^(he|she|it|this|that|everyone|everybody|someone|somebody|nobody|no one|each|every)( |$)/.test(s)) return 'sing';
  const last = s.split(' ').pop() ?? '';
  return /[^s]s$/.test(last) && !/(ss|us|is)$/.test(last) ? 'plural' : 'sing';
}

/** The verb phrase of `base` in `tense` for that agreement: "is reviewing" / "are reviewing". */
function formIn(base: string, tense: Tense, agr: Agreement): string | null {
  const f = verbForms(base);
  if (!f) return null;
  const be = agr === 'I' ? 'am' : agr === 'sing' ? 'is' : 'are';
  switch (tense) {
    case 'present-simple': return agr === 'sing' ? f.third : f.base;
    case 'present-continuous': return be + ' ' + f.ing;
    case 'present-perfect': return (agr === 'sing' ? 'has' : 'have') + ' ' + f.pp;
    case 'past-simple': return f.past;
    case 'past-continuous': return (agr === 'plural' ? 'were' : 'was') + ' ' + f.ing;
    case 'future-simple': return 'will ' + f.base;
    case 'going-to': return be + ' going to ' + f.base;
  }
}

/** Every standard positive form of `base` in `tense`, for any subject. */
function formsIn(base: string, tense: Tense): string[] {
  return [...new Set((['I', 'sing', 'plural'] as Agreement[]).map((a) => formIn(base, tense, a)).filter((x): x is string => !!x))];
}

const NEG: Record<string, string> = { "didn't": 'did not', "doesn't": 'does not', "don't": 'do not', "hasn't": 'has not', "haven't": 'have not', "isn't": 'is not', "aren't": 'are not', "wasn't": 'was not', "weren't": 'were not', "won't": 'will not' };

/**
 * Turns a bank sentence into a tense question, or null when its verb phrase can't be asked fairly (an adverb inside
 * it, a contraction, a phrasal verb split up…). Positive verbs: typed or multiple choice; negative ones: typed only,
 * with "(not base)" as the hint.
 */
export function questionFrom(s: Pick<WordSentence, 'sentence' | 'verb' | 'base' | 'tense'>, subject = ''): SentenceQuestion | null {
  if (!(TENSES as readonly string[]).includes(s.tense) || !s.base || !s.verb) return null;
  const tense = s.tense as Tense;
  const at = s.sentence.indexOf(s.verb);
  if (at < 0 || /^['’]/.test(s.verb)) return null;
  const verb = s.verb.toLowerCase();
  const blank = (hint: string) => s.sentence.slice(0, at) + '___ (' + hint + ')' + s.sentence.slice(at + s.verb.length);
  const forms = formsIn(s.base, tense);
  if (forms.includes(verb)) {
    // Wrong choices agree with the subject like the answer does, so they can't be ruled out by agreement alone.
    const agr = agreementOfAnswer(s.base, verb) ?? (subject ? agreementOfSubject(subject) : 'plural');
    const wrong = TENSES.filter((t) => t !== tense).map((t) => formIn(s.base, t, agr)).filter((x): x is string => !!x && x !== verb);
    return { prompt: blank(s.base), answer: verb, accept: [], choices: wrong, canChoose: wrong.length >= 3 };
  }
  // Negative: "did not show" / "didn't show" → "(not show)".
  const full = verb.replace(/^(\w+n't)\b/, (m) => NEG[m] ?? m);
  const m = /^(\w+) not (.+)$/.exec(full);
  if (!m) return null;
  const [, aux, rest] = m;
  const base = verbForms(s.base)?.base;
  // did not + V (past simple), do/does not + V (present simple), or an auxiliary form with "not" after its first word.
  const ok = aux === 'did' ? tense === 'past-simple' && rest === base
    : aux === 'do' || aux === 'does' ? tense === 'present-simple' && rest === base
    : forms.includes(aux + ' ' + rest);
  if (!ok) return null;
  const short = Object.entries(NEG).find(([, v]) => full.startsWith(v + ' '));
  const alt = short ? short[0] + full.slice(short[1].length) : '';
  return { prompt: blank('not ' + s.base), answer: full, accept: [...new Set([verb, alt].filter((x) => x && x !== full))], choices: [], canChoose: false };
}

@Injectable()
export class SentenceBankService {
  constructor(@InjectModel(WordSentence.name) private readonly sentences: Model<WordSentence>) {}

  /** The bank's sentences for these words (case-insensitive), by lower-case word. */
  async forWords(words: string[]): Promise<Map<string, WordSentenceDocument[]>> {
    const list = words.length ? await this.sentences.find({ word: { $in: words } }).collation({ locale: 'en', strength: 2 }) : [];
    const out = new Map<string, WordSentenceDocument[]>();
    for (const s of list) out.set(s.word.toLowerCase(), [...(out.get(s.word.toLowerCase()) ?? []), s]);
    return out;
  }

  findByIds(ids: string[]): Promise<WordSentenceDocument[]> {
    const valid = ids.filter((x) => Types.ObjectId.isValid(x));
    return valid.length ? this.sentences.find({ _id: { $in: valid } }) : Promise.resolve([]);
  }
}

@Module({
  imports: [MongooseModule.forFeature([{ name: WordSentence.name, schema: WordSentenceSchema }])],
  providers: [SentenceBankService],
  exports: [SentenceBankService]
})
export class SentenceBankModule {}
