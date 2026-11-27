import { Body, Controller, Delete, Get, HttpCode, Injectable, Logger, Module, NotFoundException, OnApplicationBootstrap, Param, Post, Query, UseGuards } from '@nestjs/common';
import { InjectModel, MongooseModule, Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsBoolean, IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min, ValidateNested } from 'class-validator';
import { Model } from 'mongoose';
import { AdminGuard } from '../access/access';
import { UserId } from '../auth/auth.decorators';
import { LEVELS, POS_LIST } from '../common/constants';
import { LibraryWord, LibraryWordSchema, TOPICS } from '../library/library.schema';
import { Tag, TagSchema } from '../tags/tags';
import { WordsModule } from '../words/words.module';
import { WordsService } from '../words/words.service';
import { Word, WordSchema } from '../words/word.schema';
import SEED from './seed/phrases.json';
import { IRREGULAR_VERBS, pastForms, tenseOf, type PhraseTense } from './tense';

/* ---------- data ---------- */

export const PHRASE_KINDS = ['slot', 'fixed'] as const;
export const SLOT_TYPES = ['noun', 'ving', 'verb'] as const;
export const TEMPLATE_TYPES = ['statement', 'question', 'negative', 'continuous', 'past', 'future'] as const;
export const REGISTERS = ['informal', 'neutral', 'formal'] as const;
export const FUNCTIONS = ['greeting', 'farewell', 'thanks', 'apology', 'opinion', 'agree', 'disagree', 'softening', 'transition', 'asking', 'reacting', 'request', 'other'] as const;

export interface PhraseTemplate { type: string; vi: string; en: string; alt: string[] }
/** A word that goes into a slot phrase: what is said in English / Vietnamese and the library word it comes from. */
export interface PhraseFiller { en: string; word: string; vi: string }

/**
 * A phrase to learn (format: phrase-import/PROMPT.md). slot: a frame with a place for another word ("S + run out of + X"),
 * practised by putting fillers into its templates; fixed: a phrase used as it is ("How's it going?"), practised by
 * situations and replies.
 */
@Schema({ collection: 'phrases', versionKey: false })
export class Phrase {
  /** Lowercase, no end punctuation ("how's it going"): one entry per phrase. */
  @Prop({ required: true, unique: true }) key: string;
  @Prop({ required: true }) phrase: string;
  @Prop({ enum: PHRASE_KINDS, required: true, index: true }) kind: string;
  @Prop({ default: 'Other' }) pos: string;
  @Prop({ default: '' }) vi: string;
  @Prop({ default: '' }) meaning: string;
  @Prop({ enum: LEVELS, default: 'B1' }) level: string;
  @Prop({ enum: TOPICS, default: 'other', index: true }) topic: string;
  @Prop({ enum: REGISTERS, default: 'neutral' }) register: string;
  @Prop({ default: '' }) pattern: string;
  @Prop({ type: Object, default: null }) slot: { type: string; hint: string } | null;
  @Prop({ type: [Object], default: [] }) forms: { use: string; en: string }[];
  @Prop({ type: [Object], default: [] }) templates: PhraseTemplate[];
  @Prop({ type: [Object], default: [] }) fillers: PhraseFiller[];
  @Prop({ type: [Object], default: [] }) examples: { en: string; vi: string }[];
  @Prop({ type: [String], default: [] }) notes: string[];
  @Prop({ type: [Object], default: [] }) mistakes: { wrong: string; right: string; why: string }[];
  @Prop({ default: '' }) function: string;
  @Prop({ type: [String], default: [] }) situations: string[];
  @Prop({ type: [Object], default: [] }) dialogue: { s: string; en: string; vi: string }[];
  @Prop({ type: Object, default: () => ({ good: [], bad: [] }) }) replies: { good: string[]; bad: string[] };
  @Prop({ type: [String], default: [] }) variants: string[];
  /** seed (the app's own list) or import (Admin). */
  @Prop({ default: 'import' }) source: string;
  @Prop({ default: () => new Date() }) createdAt: Date;
  @Prop({ default: () => new Date() }) updatedAt: Date;
}
export const PhraseSchema = SchemaFactory.createForClass(Phrase);

/** How a learner stands with one phrase in Practice: mistakes still to fix (+1 wrong, -1 right, 0 after 2 right in a row). */
@Schema({ collection: 'practice_phrases', versionKey: false })
export class PracticePhrase {
  @Prop({ required: true }) user: string;
  @Prop({ required: true }) key: string;
  @Prop({ default: 0 }) mistakes: number;
  @Prop({ default: 0 }) streak: number;
  @Prop({ default: 0 }) right: number;
  @Prop({ default: 0 }) wrong: number;
  @Prop({ type: Date, default: null }) lastAt: Date | null;
}
export const PracticePhraseSchema = SchemaFactory.createForClass(PracticePhrase);
PracticePhraseSchema.index({ user: 1, key: 1 }, { unique: true });

/** Words of mine that AI found fit a slot phrase (one record per learner and phrase); they're practised like its fillers. */
@Schema({ collection: 'phrase_fillers', versionKey: false })
export class PhraseFillers {
  @Prop({ required: true }) user: string;
  @Prop({ required: true }) key: string;
  @Prop({ type: [Object], default: [] }) fillers: PhraseFiller[];
  /** The words of mine AI has looked at (lowercase), so it is only asked about new ones next time. */
  @Prop({ type: [String], default: [] }) checked: string[];
  @Prop({ default: () => new Date() }) at: Date;
}
export const PhraseFillersSchema = SchemaFactory.createForClass(PhraseFillers);
PhraseFillersSchema.index({ user: 1, key: 1 }, { unique: true });

export interface RolePlayLine { from: 'ai' | 'me'; text: string; used: string[]; noteVi: string }
/** A role-play with AI: a short workplace conversation where the learner uses some phrases. */
@Schema({ collection: 'roleplays', versionKey: false })
export class RolePlay {
  @Prop({ required: true, index: true }) user: string;
  /** The phrases to use (keys). */
  @Prop({ type: [String], default: [] }) keys: string[];
  @Prop({ type: Object, required: true }) scenario: { title: string; titleVi: string; aiRole: string; learnerRole: string; learnerRoleVi: string; settingVi: string };
  @Prop({ type: [Object], default: [] }) lines: RolePlayLine[];
  /** Phrases the learner used right (keys). */
  @Prop({ type: [String], default: [] }) used: string[];
  @Prop({ default: false }) done: boolean;
  @Prop({ type: Object, default: null }) feedback: { summaryVi: string; items: { text: string; ok: boolean; corrected: string; noteVi: string }[] } | null;
  @Prop({ default: () => new Date(), index: true }) createdAt: Date;
}
export const RolePlaySchema = SchemaFactory.createForClass(RolePlay);

/* ---------- checking an import item ---------- */

export const phraseKey = (p: string) => p.trim().toLowerCase().replace(/[’‘]/g, "'").replace(/\s+/g, ' ').replace(/[?.!,]+$/, '').trim();
const s = (v: unknown, max: number) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, max) : '');
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const obj = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
const strs = (v: unknown, max: number, len = 200) => arr(v).map((x) => s(x, len)).filter(Boolean).slice(0, max);
const oneX = (t: string) => (t.match(/\{X\}/g) ?? []).length === 1;
const pick = <T extends string>(v: unknown, list: readonly T[], fallback: T): T => { const t = s(v, 30).toLowerCase(); return (list.find((x) => x.toLowerCase() === t) ?? fallback); };

export type PhraseDoc = Omit<Phrase, 'createdAt' | 'updatedAt' | 'source'>;

/** Checks one phrase of an import file; errors make it unusable, warnings drop a part. Fillers are checked against the library later. */
export function cleanPhrase(raw: unknown): { doc?: PhraseDoc; errors: string[]; warnings: string[]; raw: string } {
  const errors: string[] = [], warnings: string[] = [];
  const o = obj(raw);
  const phrase = s(o.phrase, 80);
  if (!phrase) errors.push('No "phrase".');
  const kind = pick(o.kind, PHRASE_KINDS, 'fixed');
  if (!PHRASE_KINDS.includes(s(o.kind, 10) as never)) errors.push('"kind" must be slot or fixed.');
  const vi = s(o.vi, 200), meaning = s(o.meaning, 300);
  if (!vi) errors.push('No "vi".');
  if (!meaning) errors.push('No "meaning".');
  const templates: PhraseTemplate[] = [];
  for (const t of arr(o.templates)) {
    const x = obj(t);
    const tvi = s(x.vi, 240), ten = s(x.en, 240);
    if (!tvi || !ten || !oneX(tvi) || !oneX(ten)) { warnings.push('A template without exactly one {X} was dropped.'); continue; }
    templates.push({ type: pick(x.type, TEMPLATE_TYPES, 'statement'), vi: tvi, en: ten, alt: strs(x.alt, 4, 240).filter((a) => oneX(a)) });
  }
  const fillers: PhraseFiller[] = arr(o.fillers).map((f) => { const x = obj(f); return { en: s(x.en, 60), word: s(x.word, 60), vi: s(x.vi, 80) }; }).filter((f) => f.en && f.word && f.vi).slice(0, 30);
  const slotIn = obj(o.slot);
  if (kind === 'slot') {
    if (templates.length < 2) errors.push('A slot phrase needs at least 2 templates with {X}.');
    if (fillers.length < 3) errors.push('A slot phrase needs at least 3 fillers.');
  }
  const replies = obj(o.replies);
  const doc: PhraseDoc = {
    key: phraseKey(phrase), phrase, kind,
    pos: (POS_LIST as readonly string[]).includes(s(o.pos, 20)) ? s(o.pos, 20) : kind === 'slot' ? 'Verb' : 'Other',
    vi, meaning,
    level: (LEVELS as readonly string[]).includes(s(o.level, 2).toUpperCase()) ? s(o.level, 2).toUpperCase() : 'B1',
    topic: pick(o.topic, TOPICS, 'other'), register: pick(o.register, REGISTERS, 'neutral'),
    pattern: s(o.pattern, 80),
    slot: kind === 'slot' ? { type: pick(slotIn.type, SLOT_TYPES, 'noun'), hint: s(slotIn.hint, 160) } : null,
    forms: arr(o.forms).map((f) => { const x = obj(f); return { use: s(x.use, 120), en: s(x.en, 200) }; }).filter((f) => f.en).slice(0, 6),
    templates: kind === 'slot' ? templates.slice(0, 8) : [],
    fillers: kind === 'slot' ? fillers : [],
    examples: arr(o.examples).map((e) => { const x = obj(e); return { en: s(x.en, 240), vi: s(x.vi, 240) }; }).filter((e) => e.en).slice(0, 8),
    notes: strs(o.notes, 4),
    mistakes: arr(o.mistakes).map((m) => { const x = obj(m); return { wrong: s(x.wrong, 200), right: s(x.right, 200), why: s(x.why, 200) }; }).filter((m) => m.wrong && m.right && m.wrong !== m.right).slice(0, 4),
    function: kind === 'fixed' ? pick(o.function, FUNCTIONS, 'other') : '',
    situations: strs(o.situations, 8),
    dialogue: arr(o.dialogue).map((d) => { const x = obj(d); return { s: s(x.s, 1).toUpperCase() === 'B' ? 'B' : 'A', en: s(x.en, 240), vi: s(x.vi, 240) }; }).filter((d) => d.en).slice(0, 6),
    replies: { good: strs(replies.good, 4), bad: strs(replies.bad, 4) },
    variants: strs(o.variants, 4, 80)
  };
  if (kind === 'fixed' && !doc.situations.length && !doc.replies.good.length) warnings.push('No situations or replies: only the meaning question can be asked.');
  return errors.length ? { errors, warnings: [], raw: phrase } : { doc, errors, warnings, raw: phrase };
}

/* ---------- answers ---------- */

const SPECIAL_FORMS: Record<string, string[]> = {
  be: ['am', 'is', 'are', 'was', 'were', 'been', 'being'], have: ['has', 'had', 'having'], do: ['does', 'did', 'done', 'doing'],
  go: ['goes', 'went', 'gone', 'going']
};
/** The regular forms of a verb (decide → decides, decided, deciding). */
function regularForms(v: string): string[] {
  const out = [v];
  if (/[^aeiou]y$/.test(v)) out.push(v.slice(0, -1) + 'ies', v.slice(0, -1) + 'ied', v + 'ing');
  else if (/e$/.test(v)) out.push(v + 's', v + 'd', v.slice(0, -1) + 'ing');
  else if (/(s|x|z|ch|sh)$/.test(v)) out.push(v + 'es', v + 'ed', v + 'ing');
  else if (/^[^aeiou]*[aeiou][^aeiouwxy]$/.test(v)) out.push(v + 's', v + v.slice(-1) + 'ed', v + v.slice(-1) + 'ing');
  else out.push(v + 's', v + 'ed', v + 'ing');
  return out;
}
/** The forms of a verb: decide → decides, decided, deciding; build → builds, built, building (irregular ones from tense.ts). */
export function verbForms(v: string): string[] {
  if (SPECIAL_FORMS[v]) return [v, ...SPECIAL_FORMS[v]];
  const irr = IRREGULAR_VERBS[v];
  if (!irr) return regularForms(v);
  const [base, s, , ing] = regularForms(v);
  return [...new Set([base, s, ...irr, ing])];
}
const esc = (t: string) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/** A regex (source, case-insensitive) for a phrase in any form of its verb: "run out of" also matches "ran out of", "I'm used to". */
export function phraseRe(phrase: string, isVerb: boolean): string {
  const words = phraseKey(phrase).split(' ');
  const [head, ...rest] = words;
  let first = '\\b' + esc(head) + '\\b';
  // "be" may have up to two words before the rest: "I am not used to", "Are you used to".
  if (isVerb && head === 'be') first = "(?:\\b(?:be|am|is|are|was|were|been|being)\\b|'(?:m|re|s))(?:\\s+(?!" + esc(rest[0] ?? '') + "\\b)[a-z']+){0,2}";
  else if (isVerb) first = '\\b(?:' + verbForms(head).map(esc).join('|') + ')\\b';
  // A word ending in punctuation ("point," in "I see your point, but") can't be followed by a word boundary.
  return [first, ...rest.map((w) => esc(w) + (/\w$/.test(w) ? '\\b' : ''))].join('\\s*');
}
const ARTICLES = new Set(['the', 'a', 'an', 'this', 'that', 'these', 'those', 'my', 'our', 'your', 'his', 'her', 'their', 'its']);
/** The words of a filler that an answer must contain ("the old files" → old, files). */
const needWords = (en: string) => phraseKey(en).split(' ').filter((w) => w && !ARTICLES.has(w));
/** Small words an answer may say differently (auxiliaries, articles, contractions). */
const LOOSE = new Set([...ARTICLES, 'to', 'of', 'do', 'does', 'did', 'have', 'has', 'had', 'will', 'would', 'can', 'could', 'be', 'am', 'is', 'are', 'was', 'were', 'been', 'not', 've', 're', 'm', 's', 'll', 'd', 't', 'don', 'didn', 'haven', 'hasn', 'isn', 'aren', 'let', 'me', 'very', 'so', 'yet', 'now', 'right', 'away']);
/** The words of a template an answer must keep besides the phrase and the filler: the subject, time words… ("The office … yesterday"). */
function keyWords(template: string, phrase: string): string[] {
  const words = phraseKey(phrase).split(/[^a-z]+/).filter(Boolean);
  // The phrase itself in any form (ran, running, dealt…) isn't needed: the phrase check covers it.
  const own = new Set([...words, ...(words[0] ? verbForms(words[0]) : [])]);
  return [...new Set(template.replace('{X}', ' ').toLowerCase().split(/[^a-z]+/).filter((w) => w && !LOOSE.has(w) && !own.has(w)))];
}

/* ---------- practice ---------- */

export type DrillType = 'translate' | 'fill' | 'transform' | 'situation' | 'reply' | 'meaning' | 'own';
export interface Drill {
  id: string; key: string; phrase: string; kind: string; pattern: string; type: DrillType;
  /** What is asked: a Vietnamese sentence, an English one with blanks, a sentence to change, a situation, a dialogue line… */
  prompt: string;
  /** Help under the prompt (the Vietnamese of a fill-in sentence, or what to change). */
  sub: string;
  choices: string[];
  /** Accepted answers (typed) / the right choices. */
  answers: string[];
  /** Typed answers that aren't listed: right when they have the phrase (any verb form) and the filler's words (and look like a question when asked). */
  check: { phrase: string; need: string[]; question: boolean; tense: PhraseTense | ''; base: string; past: string[] } | null;
  /** The tense the answer is in (shown as a hint; another tense is wrong). '' when it doesn't matter. */
  tense: PhraseTense | '';
  /** mine: in my vocabulary (wordId); otherwise a new word, saved from the library (libraryId). */
  filler: { en: string; word: string; vi: string; mine: boolean; wordId: string; libraryId: string } | null;
  explain: string;
}

const shuffle = <T>(a: T[]): T[] => { const r = [...a]; for (let i = r.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [r[i], r[j]] = [r[j], r[i]]; } return r; };
const fillX = (t: string, x: string) => t.replace('{X}', x);
const cap = (t: string) => t.charAt(0).toUpperCase() + t.slice(1);

/* ---------- service ---------- */

export class PhraseQuery {
  @IsOptional() @IsString() @MaxLength(80) q?: string;
  @IsOptional() @IsIn(PHRASE_KINDS) kind?: string;
  @IsOptional() @IsIn(TOPICS) topic?: string;
}
export class PhraseSessionQuery {
  @IsOptional() @Type(() => Number) @IsInt() @Min(4) @Max(20) n?: number;
  /** Only this phrase. */
  @IsOptional() @IsString() @MaxLength(80) key?: string;
}
class PhraseResultDto {
  @IsString() @MaxLength(80) key: string;
  @IsBoolean() ok: boolean;
}
export class PhraseResultsDto {
  @IsArray() @ArrayMaxSize(40) @ValidateNested({ each: true }) @Type(() => PhraseResultDto) items: PhraseResultDto[];
}
export class PhraseImportDto {
  @IsArray() @ArrayMaxSize(100) items: unknown[];
  @IsBoolean() dryRun: boolean;
  /** A phrase that already exists: leave it, or replace it with the file's. */
  @IsIn(['skip', 'replace']) duplicates: 'skip' | 'replace';
}

const brief = (p: Phrase) => ({ key: p.key, phrase: p.phrase, kind: p.kind, vi: p.vi, level: p.level, topic: p.topic, register: p.register, function: p.function, pattern: p.pattern });

@Injectable()
export class PhrasesService implements OnApplicationBootstrap {
  private readonly log = new Logger('Phrases');

  constructor(
    @InjectModel(Phrase.name) private readonly phrases: Model<Phrase>,
    @InjectModel(PracticePhrase.name) private readonly records: Model<PracticePhrase>,
    @InjectModel(LibraryWord.name) private readonly library: Model<LibraryWord>,
    @InjectModel(Tag.name) private readonly tags: Model<Tag>,
    @InjectModel(PhraseFillers.name) private readonly myFillers: Model<PhraseFillers>,
    @InjectModel(Word.name) private readonly wordDocs: Model<Word>,
    private readonly words: WordsService
  ) {}

  /** Adds the app's own phrases (seed/phrases.json) that are missing; never changes ones an admin edited or imported. */
  async onApplicationBootstrap() {
    const ops = (SEED as unknown[]).map((raw) => cleanPhrase(raw)).filter((c) => c.doc).map((c) => ({
      updateOne: { filter: { key: c.doc!.key }, update: { $setOnInsert: { ...c.doc!, source: 'seed', createdAt: new Date(), updatedAt: new Date() } }, upsert: true }
    }));
    if (!ops.length) return;
    const r = await this.phrases.bulkWrite(ops, { ordered: false });
    if (r.upsertedCount) this.log.log('Added ' + r.upsertedCount + ' built-in phrases.');
  }

  private async mine(user: string) {
    const list = await this.words.brief(user);
    return new Map(list.map((w) => [w.wordLower ?? w.word.toLowerCase(), String(w._id)]));
  }

  async list(user: string, q: PhraseQuery) {
    const filter: Record<string, unknown> = {};
    if (q.kind) filter.kind = q.kind;
    if (q.topic) filter.topic = q.topic;
    if (q.q?.trim()) { const r = { $regex: esc(q.q.trim()), $options: 'i' }; filter.$or = [{ phrase: r }, { vi: r }]; }
    const [list, mine, recs] = await Promise.all([this.phrases.find(filter).sort({ level: 1, key: 1 }).lean(), this.mine(user), this.records.find({ user }).lean()]);
    const rec = new Map(recs.map((r) => [r.key, r]));
    return { items: list.map((p) => ({ ...brief(p), saved: mine.has(p.key) || mine.has(p.phrase.toLowerCase()), errors: rec.get(p.key)?.mistakes ?? 0, practised: !!rec.get(p.key)?.lastAt })) };
  }

  async get(user: string, key: string) {
    const p = await this.phrases.findOne({ key: phraseKey(key) }).lean();
    if (!p) throw new NotFoundException('Phrase not found.');
    const mine = await this.mine(user);
    const lib = new Map((await this.library.find({ wordLower: { $in: p.fillers.map((f) => f.word.toLowerCase()) } }, { wordLower: 1 }).lean()).map((l) => [l.wordLower, String(l._id)]));
    const { _id, ...rest } = p as Phrase & { _id: unknown };
    void _id;
    const own = p.kind === 'slot' ? await this.myFillers.findOne({ user, key: p.key }).lean() : null;
    const listed = new Set(p.fillers.map((f) => f.en.toLowerCase()));
    const extra = (own?.fillers ?? []).filter((f) => !listed.has(f.en.toLowerCase()));
    const unchecked = p.kind === 'slot' ? (await this.candidates(user, p, own?.checked ?? [])).length : 0;
    return {
      ...rest,
      savedId: mine.get(p.key) ?? mine.get(p.phrase.toLowerCase()) ?? '',
      fillers: [
        ...p.fillers.map((f) => ({ ...f, mine: mine.has(f.word.toLowerCase()), wordId: mine.get(f.word.toLowerCase()) ?? '', libraryId: lib.get(f.word.toLowerCase()) ?? '', ai: false })),
        ...extra.map((f) => ({ ...f, mine: true, wordId: mine.get(f.word.toLowerCase()) ?? '', libraryId: '', ai: true }))
      ],
      /** My words AI hasn't looked at yet for this phrase (the "Find my words" button). */
      unchecked
    };
  }

  /** My words that could fit a slot phrase (by part of speech), not in its list and not looked at by AI yet. */
  async candidates(user: string, p: Phrase, checked: string[]) {
    const type = p.slot?.type ?? 'noun';
    const pos = type === 'noun' ? ['Noun'] : ['Verb'];
    const skip = new Set([...checked, ...p.fillers.map((f) => f.word.toLowerCase()), phraseKey(p.phrase)]);
    const list = await this.wordDocs.find({ user, pos: { $in: pos } }, { word: 1, wordLower: 1, pos: 1, vi: 1 }).sort({ addedAt: -1 }).limit(400).lean();
    return list.filter((w) => !skip.has(w.wordLower)).slice(0, 120).map((w) => ({ word: w.word, pos: w.pos, vi: w.vi }));
  }

  /** The keys of the phrases I saved to My Vocabulary. */
  async listSaved(user: string): Promise<string[]> {
    const [all, mine] = await Promise.all([this.phrases.find({}, { key: 1, phrase: 1 }).lean(), this.mine(user)]);
    return all.filter((p) => mine.has(p.key) || mine.has(p.phrase.toLowerCase())).map((p) => p.key);
  }

  /** Phrases a word can go into (its word details: "Phrases with this word"). */
  async forWord(word: string) {
    const w = word.trim().toLowerCase();
    if (!w) return { items: [] };
    const list = await this.phrases.find({ 'fillers.word': { $regex: '^' + esc(w) + '$', $options: 'i' } }).lean();
    return { items: list.map((p) => ({ ...brief(p), example: fillX(p.templates[0]?.en ?? '', p.fillers.find((f) => f.word.toLowerCase() === w)?.en ?? w) })) };
  }

  /** Saves a phrase to My Vocabulary (tag "phrase"), so it comes up in Review like a word. */
  async save(user: string, key: string) {
    const p = await this.phrases.findOne({ key: phraseKey(key) }).lean();
    if (!p) throw new NotFoundException('Phrase not found.');
    await this.tags.updateOne({ user, name: 'phrase' }, { $setOnInsert: { user, name: 'phrase' } }, { upsert: true });
    const w = await this.words.create(user, {
      word: p.phrase.replace(/[?.!]+$/, ''), pos: p.pos, meaning: p.meaning, vi: p.vi, ex: p.examples[0]?.en ?? '', level: p.level,
      tags: ['phrase'], notes: [p.pattern, ...p.notes].filter(Boolean).join('\n')
    });
    return { word: w.toJSON(), tag: 'phrase' };
  }

  /**
   * A practice session: phrases I saved first (or all when I saved none), the ones I get wrong first, then the ones not
   * practised for longest. Slot phrases are filled with words — mine (about 60%) and new library words — into their
   * templates; fixed phrases are asked by situation, reply or meaning. Answers come along (it isn't graded).
   */
  async session(user: string, q: PhraseSessionQuery): Promise<{ items: Drill[] }> {
    const n = q.n ?? 10;
    const [all, mine, recs] = await Promise.all([this.phrases.find().lean(), this.mine(user), this.records.find({ user }).lean()]);
    if (!all.length) return { items: [] };
    const rec = new Map(recs.map((r) => [r.key, r]));
    const usable = (p: Phrase) => (p.kind === 'slot' ? p.templates.length > 0 && p.fillers.length > 0 : true);
    let picked: Phrase[];
    if (q.key) {
      const one = all.find((p) => p.key === phraseKey(q.key!));
      if (!one) throw new NotFoundException('Phrase not found.');
      picked = [one];
    } else {
      const saved = all.filter((p) => usable(p) && (mine.has(p.key) || mine.has(p.phrase.toLowerCase())));
      const order = (list: Phrase[]) => shuffle(list).sort((a, b) => (rec.get(b.key)?.mistakes ?? 0) - (rec.get(a.key)?.mistakes ?? 0)
        || new Date(rec.get(a.key)?.lastAt ?? 0).getTime() - new Date(rec.get(b.key)?.lastAt ?? 0).getTime());
      picked = order(saved).slice(0, 4);
      if (picked.length < 4) picked.push(...order(all.filter((p) => usable(p) && !picked.includes(p))).slice(0, 4 - picked.length));
    }
    const fixed = all.filter((p) => p.kind === 'fixed');
    const ownFillers = new Map((await this.myFillers.find({ user, key: { $in: picked.map((p) => p.key) } }).lean()).map((x) => [x.key, x.fillers]));
    picked = picked.map((p) => {
      const extra = (ownFillers.get(p.key) ?? []).filter((f) => !p.fillers.some((x) => x.en.toLowerCase() === f.en.toLowerCase()));
      return extra.length ? { ...p, fillers: [...p.fillers, ...extra] } : p;
    });
    const used = new Map<string, Set<string>>();
    const items: Drill[] = [];
    for (let i = 0; i < n; i++) {
      const p = picked[i % picked.length];
      const round = Math.floor(i / picked.length);
      const d = p.kind === 'slot' ? this.slotDrill(p, round, mine, used) : this.fixedDrill(p, round, fixed);
      if (d) items.push({ ...d, id: p.key + ':' + i });
    }
    // One question where I write my own sentence with a phrase (graded by AI when I check it).
    if (n >= 6 && items.length) {
      const p = shuffle(picked.filter((x) => x.kind === 'slot'))[0] ?? picked[0];
      items[items.length - 1] = { ...this.ownDrill(p), id: p.key + ':own' };
    }
    // New words can be saved straight from the question: their library ids.
    const fw = [...new Set(items.flatMap((d) => (d.filler && !d.filler.mine ? [d.filler.word.toLowerCase()] : [])))];
    const lib = new Map((await this.library.find({ wordLower: { $in: fw } }, { wordLower: 1 }).lean()).map((l) => [l.wordLower, String(l._id)]));
    for (const d of items) if (d.filler && !d.filler.mine) d.filler.libraryId = lib.get(d.filler.word.toLowerCase()) ?? '';
    return { items: shuffle(items) };
  }

  private slotDrill(p: Phrase, round: number, mine: Map<string, string>, used: Map<string, Set<string>>): Omit<Drill, 'id'> | null {
    if (!p.templates.length || !p.fillers.length) return null;
    const seen = used.get(p.key) ?? new Set<string>();
    used.set(p.key, seen);
    const fresh = p.fillers.filter((f) => !seen.has(f.en));
    const pool = fresh.length ? fresh : p.fillers;
    const own = pool.filter((f) => mine.has(f.word.toLowerCase())), other = pool.filter((f) => !mine.has(f.word.toLowerCase()));
    const f = (own.length && (!other.length || Math.random() < 0.6) ? shuffle(own) : shuffle(other))[0];
    seen.add(f.en);
    const filler = { en: f.en, word: f.word, vi: f.vi, mine: mine.has(f.word.toLowerCase()), wordId: mine.get(f.word.toLowerCase()) ?? '', libraryId: '' };
    const re = phraseRe(p.phrase, p.pos === 'Verb');
    const explain = p.mistakes[0] ? '✗ ' + p.mistakes[0].wrong + ' → ✓ ' + p.mistakes[0].right + ' — ' + p.mistakes[0].why : p.notes[0] ?? '';
    const base = { key: p.key, phrase: p.phrase, kind: p.kind, pattern: p.pattern, choices: [], filler, explain };
    const statements = p.templates.filter((t) => t.type === 'statement');
    const questions = p.templates.filter((t) => t.type === 'question');
    // The tense of each template; other answers count only in the same tense ("rồi" → I've run out of, not I ran out of).
    const verb = phraseKey(p.phrase).split(' ')[0];
    const tenseFor = (en: string): PhraseTense | '' => (p.pos === 'Verb' ? tenseOf(fillX(en, 'it'), re, verb) : '');
    const accepted = (t: PhraseTemplate) => { const want = tenseFor(t.en); return [t.en, ...t.alt.filter((a) => !want || tenseFor(a) === want)].map((a) => fillX(a, f.en)); };
    const check = (t: PhraseTemplate, question: boolean) => ({ phrase: re, need: [...needWords(f.en), ...keyWords(t.en, p.phrase)], question, tense: tenseFor(t.en), base: verb, past: pastForms(verb) });
    const kind = (['translate', 'fill', 'translate', 'transform'] as const)[round % 4];

    if (kind === 'fill') {
      const t = shuffle(statements.length ? statements : p.templates)[0];
      // "I'm used to" → "I am used to": the blanks cover whole words.
      const en = fillX(t.en, f.en).replace(/\bI'm\b/g, 'I am').replace(/\b(we|you|they)'re\b/gi, '$1 are').replace(/\b(he|she|it)'s\b/gi, '$1 is');
      const m = new RegExp(re, 'i').exec(en);
      if (m) {
        const blanks = m[0].split(/\s+/).map(() => '___').join(' ');
        return { ...base, type: 'fill', prompt: en.slice(0, m.index) + blanks + en.slice(m.index + m[0].length), sub: fillX(t.vi, f.vi), answers: [m[0]], check: null, tense: tenseFor(t.en) };
      }
    }
    if (kind === 'transform' && statements.length && questions.length) {
      const from = shuffle(statements)[0], to = shuffle(questions)[0];
      return {
        ...base, type: 'transform', prompt: fillX(from.en, f.en), sub: 'Đổi thành câu hỏi: ' + fillX(to.vi, f.vi),
        answers: accepted(to), check: check(to, true), tense: tenseFor(to.en)
      };
    }
    const t = shuffle(p.templates)[0];
    return {
      ...base, type: 'translate', prompt: cap(fillX(t.vi, f.vi)), sub: '',
      answers: accepted(t), check: check(t, t.type === 'question'), tense: tenseFor(t.en)
    };
  }

  /** "Your own sentence with run out of" (in one of its templates' tenses, about something that fits the slot). */
  private ownDrill(p: Phrase): Omit<Drill, 'id'> {
    const re = phraseRe(p.phrase, p.pos === 'Verb');
    const verb = phraseKey(p.phrase).split(' ')[0];
    const t = shuffle(p.templates.filter((x) => x.type !== 'question'))[0];
    const tense = t && p.pos === 'Verb' ? tenseOf(fillX(t.en, 'it'), re, verb) : '';
    const sub = p.kind === 'slot' ? (p.slot?.hint ? '… = ' + p.slot.hint : '') : p.situations[0] ? 'Tình huống: ' + shuffle(p.situations)[0] : '';
    return {
      key: p.key, phrase: p.phrase, kind: p.kind, pattern: p.pattern, type: 'own', prompt: 'Write your own sentence with “' + p.phrase + '”', sub,
      choices: [], answers: [], check: null, filler: null, explain: p.notes[0] ?? '', tense
    };
  }

  private fixedDrill(p: Phrase, round: number, fixed: Phrase[]): Omit<Drill, 'id'> {
    const others = shuffle(fixed.filter((x) => x.key !== p.key));
    const explain = p.notes[0] ?? '';
    const base = { key: p.key, phrase: p.phrase, kind: p.kind, pattern: p.pattern, sub: '', check: null, filler: null, explain, tense: '' as const };
    // Sentences with the phrase in them (examples and dialogue lines) for "fill in the phrase".
    const re = new RegExp(phraseRe(p.phrase, false), 'i');
    const withPhrase = [...p.examples, ...p.dialogue.map((d) => ({ en: d.en, vi: d.vi }))].filter((x) => re.test(x.en));
    const kinds: DrillType[] = [];
    if (p.situations.length && others.length >= 2) kinds.push('situation');
    if (withPhrase.length) kinds.push('fill');
    if (p.replies.good.length && p.replies.bad.length) kinds.push('reply');
    kinds.push('meaning');
    if (withPhrase.length > 2) kinds.push('fill');
    const type = kinds[round % kinds.length];
    if (type === 'fill') {
      const ex = shuffle(withPhrase)[0];
      const m = re.exec(ex.en)!;
      const blanks = m[0].split(/\s+/).map(() => '___').join(' ');
      return { ...base, type, prompt: ex.en.slice(0, m.index) + blanks + ex.en.slice(m.index + m[0].length), sub: ex.vi, choices: [], answers: [m[0]] };
    }
    if (type === 'situation') {
      return { ...base, type, prompt: shuffle(p.situations)[0], sub: 'Bạn sẽ nói gì?', choices: shuffle([p.phrase, ...others.slice(0, 3).map((x) => x.phrase)]), answers: [p.phrase] };
    }
    if (type === 'reply') {
      const line = p.dialogue.find((d) => new RegExp(phraseRe(p.phrase, false), 'i').test(d.en))?.en ?? p.phrase;
      const good = shuffle(p.replies.good)[0];
      return { ...base, type, prompt: line, sub: 'Chọn câu đáp tự nhiên nhất', choices: shuffle([good, ...shuffle(p.replies.bad).slice(0, 3)]), answers: p.replies.good };
    }
    return { ...base, type: 'meaning', prompt: p.phrase, sub: 'Nghĩa là gì?', choices: shuffle([p.vi, ...others.slice(0, 3).map((x) => x.vi)]), answers: [p.vi] };
  }

  async record(user: string, items: { key: string; ok: boolean }[]) {
    const now = new Date();
    for (const it of items) {
      const key = phraseKey(it.key);
      const r = await this.records.findOne({ user, key }).lean();
      const streak = it.ok ? (r?.streak ?? 0) + 1 : 0;
      const mistakes = it.ok ? (streak >= 2 ? 0 : Math.max(0, (r?.mistakes ?? 0) - 1)) : (r?.mistakes ?? 0) + 1;
      await this.records.updateOne({ user, key }, { $set: { streak, mistakes, lastAt: now }, $inc: it.ok ? { right: 1 } : { wrong: 1 } }, { upsert: true });
    }
  }

  /* ----- admin ----- */

  async adminList(q: PhraseQuery) {
    const filter: Record<string, unknown> = {};
    if (q.kind) filter.kind = q.kind;
    if (q.q?.trim()) { const r = { $regex: esc(q.q.trim()), $options: 'i' }; filter.$or = [{ phrase: r }, { vi: r }]; }
    const list = await this.phrases.find(filter).sort({ key: 1 }).lean();
    return { total: list.length, items: list.map((p) => ({ ...brief(p), templates: p.templates.length, fillers: p.fillers.length, source: p.source })) };
  }

  /** Checks (dryRun) or imports phrases. Fillers must be library words; the rest are dropped with a warning. */
  async adminImport(dto: PhraseImportDto) {
    const cleaned = dto.items.map((raw) => cleanPhrase(raw));
    const words = [...new Set(cleaned.flatMap((c) => c.doc?.fillers.map((f) => f.word.toLowerCase()) ?? []))];
    const lib = new Set((await this.library.find({ wordLower: { $in: words } }, { wordLower: 1 }).lean()).map((l) => l.wordLower));
    const keys = cleaned.flatMap((c) => (c.doc ? [c.doc.key] : []));
    const have = new Set((await this.phrases.find({ key: { $in: keys } }, { key: 1 }).lean()).map((p) => p.key));
    const seen = new Set<string>();
    const now = new Date();
    const writes: PhraseDoc[] = [];
    const items = cleaned.map((c, index) => {
      if (!c.doc) return { index, phrase: c.raw, status: 'invalid' as const, errors: c.errors, warnings: [] as string[] };
      const d = c.doc;
      const warnings = [...c.warnings];
      if (d.kind === 'slot') {
        const missing = d.fillers.filter((f) => !lib.has(f.word.toLowerCase()));
        if (missing.length) warnings.push('Not in the library, dropped: ' + missing.map((f) => f.word).join(', ') + '.');
        d.fillers = d.fillers.filter((f) => lib.has(f.word.toLowerCase()));
        if (d.fillers.length < 3) return { index, phrase: d.phrase, status: 'invalid' as const, errors: ['Fewer than 3 fillers are library words.'], warnings };
      }
      if (seen.has(d.key)) return { index, phrase: d.phrase, status: 'repeat' as const, errors: [], warnings };
      seen.add(d.key);
      if (have.has(d.key) && dto.duplicates === 'skip') return { index, phrase: d.phrase, status: 'exists' as const, errors: [], warnings };
      writes.push(d);
      return { index, phrase: d.phrase, status: have.has(d.key) ? ('replace' as const) : ('new' as const), errors: [], warnings };
    });
    if (!dto.dryRun && writes.length) {
      await this.phrases.bulkWrite(writes.map((d) => ({
        updateOne: { filter: { key: d.key }, update: { $set: { ...d, source: 'import', updatedAt: now }, $setOnInsert: { createdAt: now } }, upsert: true }
      })), { ordered: false });
    }
    const count = (st: string) => items.filter((x) => x.status === st).length;
    return { items, summary: { new: count('new'), replace: count('replace'), exists: count('exists'), repeat: count('repeat'), invalid: count('invalid') } };
  }

  async adminDelete(key: string) {
    const r = await this.phrases.deleteOne({ key: phraseKey(key) });
    if (!r.deletedCount) throw new NotFoundException('Phrase not found.');
    await this.records.deleteMany({ key: phraseKey(key) });
  }
}

/* ---------- controllers ---------- */

@ApiTags('phrases')
@ApiBearerAuth()
@Controller('phrases')
export class PhrasesController {
  constructor(private readonly svc: PhrasesService) {}

  @Get() list(@UserId() user: string, @Query() q: PhraseQuery) { return this.svc.list(user, q); }
  /** GET /api/phrases/for-word?word=toothpaste */
  @Get('for-word') forWord(@Query('word') word = '') { return this.svc.forWord(String(word).slice(0, 80)); }
  @Get(':key') get(@UserId() user: string, @Param('key') key: string) { return this.svc.get(user, decodeURIComponent(key)); }
  @Post(':key/save') save(@UserId() user: string, @Param('key') key: string) { return this.svc.save(user, decodeURIComponent(key)); }
}

@ApiTags('practice')
@ApiBearerAuth()
@Controller('practice/phrases')
export class PracticePhrasesController {
  constructor(private readonly svc: PhrasesService) {}

  /** A practice session: GET /api/practice/phrases?n=10&key= */
  @Get() session(@UserId() user: string, @Query() q: PhraseSessionQuery) { return this.svc.session(user, q); }
  @Post('results') @HttpCode(204) async results(@UserId() user: string, @Body() dto: PhraseResultsDto) { await this.svc.record(user, dto.items); }
}

@ApiTags('admin')
@ApiBearerAuth()
@UseGuards(AdminGuard)
@Controller('admin/phrases')
export class AdminPhrasesController {
  constructor(private readonly svc: PhrasesService) {}

  @Get() list(@Query() q: PhraseQuery) { return this.svc.adminList(q); }
  @Post('import') @HttpCode(200) import(@Body() dto: PhraseImportDto) { return this.svc.adminImport(dto); }
  @Delete(':key') @HttpCode(204) async remove(@Param('key') key: string) { await this.svc.adminDelete(decodeURIComponent(key)); }
}

@Module({
  imports: [
    WordsModule,
    MongooseModule.forFeature([
      { name: Phrase.name, schema: PhraseSchema }, { name: PracticePhrase.name, schema: PracticePhraseSchema },
      { name: LibraryWord.name, schema: LibraryWordSchema }, { name: Tag.name, schema: TagSchema },
      { name: PhraseFillers.name, schema: PhraseFillersSchema }, { name: Word.name, schema: WordSchema }
    ])
  ],
  controllers: [PhrasesController, PracticePhrasesController, AdminPhrasesController],
  providers: [PhrasesService],
  exports: [PhrasesService]
})
export class PhrasesModule {}
