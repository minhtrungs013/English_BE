import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import type { Db } from 'mongodb';
import { Model, Types } from 'mongoose';
import { DAY, MIN, dayKey, type Rating } from '../common/constants';
import { cleanFamily, type FamilyMember } from '../common/family';
import { COURSE_WORD_FIELDS, type CourseWord, type CourseWordRef } from '../courses/course.schema';
import { fullWord, wordRef, type LibraryDetails } from '../courses/course-words';
import { LibraryWord } from '../library/library.schema';
import { ProfileService } from '../profile/profile.service';
import { Word, WordDocument } from './word.schema';
import { CreateWordDto, ReviewWordDto, UpdateWordDto } from './word.dto';

function isDuplicateKey(e: unknown): boolean {
  return typeof e === 'object' && e !== null && (e as { code?: number }).code === 11000;
}

function clean(list?: string[]): string[] | undefined {
  if (!list) return undefined;
  const out: string[] = [];
  for (const x of list.map((s) => s.trim()).filter(Boolean)) if (!out.some((o) => o.toLowerCase() === x.toLowerCase())) out.push(x);
  return out;
}

/** Simple spaced-repetition schedule: returns the next status and due date. */
export function schedule(w: Pick<Word, 'status' | 'hist'>, r: Rating, now = Date.now()): { status: string; dueAt: Date } {
  const goods = w.hist.filter((h) => h.r === 'Good' || h.r === 'Easy').length;
  switch (r) {
    case 'Again': return { status: 'learning', dueAt: new Date(now + 10 * MIN) };
    case 'Hard': return { status: 'learning', dueAt: new Date(now + DAY) };
    case 'Good': return { status: goods >= 2 ? 'mastered' : 'learning', dueAt: new Date(now + 3 * DAY) };
    case 'Easy': return { status: goods >= 1 ? 'mastered' : 'learning', dueAt: new Date(now + 7 * DAY) };
  }
}

/** The details of a word (what the library has): ipa, pos, meaning, vi, ex, syn, ant, family, level. */
export const DETAIL_FIELDS = COURSE_WORD_FIELDS;
type Details = Pick<CourseWord, (typeof DETAIL_FIELDS)[number]>;

/** One of my words as the app sees it: the library word's details with my own changes on top, plus my progress. */
export interface MyWord extends Details {
  id: string; word: string; status: string; cat: string; tags: string[]; notes: string;
  dueAt: number; addedAt: number; hist: { at: number; r: string }[];
}

/** Words that stay out of the library: phrases (they have their own section). */
const ownOnly = (tags?: string[]) => !!tags?.includes('phrase');

/** The details given in a create / update request (cleaned), leaving out the ones not given. */
function detailsOf(dto: Partial<CreateWordDto>): Partial<Details> {
  const out: Partial<Details> = {};
  for (const k of DETAIL_FIELDS) {
    const v = (dto as Record<string, unknown>)[k];
    if (v === undefined) continue;
    (out as Record<string, unknown>)[k] = k === 'family' ? cleanFamily(v) : k === 'syn' || k === 'ant' ? clean(v as string[]) : v;
  }
  return out;
}

const LIB_FIELDS = { word: 1, wordLower: 1, ...Object.fromEntries(DETAIL_FIELDS.map((k) => [k, 1])) };
const UNSET_OLD = Object.fromEntries(DETAIL_FIELDS.map((k) => [k, 1 as const])) as Record<string, 1>;

/**
 * Before library words are deleted: learners' words that link to them get the words' full details as their own
 * (overrides, no link), so nobody loses a word. Raw collection, so the library module can use it.
 */
export async function detachFromWords(db: Db, libs: LibraryDetails[]): Promise<number> {
  const byId = new Map(libs.map((l) => [String(l._id), l]));
  if (!byId.size) return 0;
  const words = db.collection<CourseWordRef & { _id: Types.ObjectId }>('words');
  const list = await words.find({ libraryId: { $in: [...byId.keys()] } }).toArray();
  if (!list.length) return 0;
  await words.bulkWrite(list.map((w) => {
    const full = fullWord(w, byId.get(w.libraryId));
    return { updateOne: { filter: { _id: w._id }, update: { $set: { libraryId: '', overrides: Object.fromEntries(DETAIL_FIELDS.map((k) => [k, full[k]])) }, $unset: UNSET_OLD } } };
  }), { ordered: false });
  return list.length;
}

/**
 * My words. Each one links to its library word (`libraryId`) and keeps only what I changed (`overrides`), so the
 * library is the one place a word's meaning lives: an admin's fix or AI regenerate shows in everyone's words.
 * Every query is scoped to the signed-in user (`user`), so nobody can read or change another user's words.
 */
@Injectable()
export class WordsService {
  constructor(
    @InjectModel(Word.name) private readonly words: Model<Word>,
    @InjectModel(LibraryWord.name) private readonly library: Model<LibraryWord>,
    private readonly profile: ProfileService
  ) {}

  /* ---------- reading ---------- */

  /** My words as the app sees them (library details + my changes), one library read for the lot. */
  async views(docs: WordDocument[]): Promise<MyWord[]> {
    const ids = [...new Set(docs.map((d) => d.libraryId).filter((id) => id && Types.ObjectId.isValid(id)))];
    const libs = ids.length ? await this.library.find({ _id: { $in: ids } }, LIB_FIELDS).lean() : [];
    const byId = new Map(libs.map((l) => [String(l._id), l as unknown as LibraryDetails]));
    return docs.map((d) => this.viewWith(d, d.libraryId ? byId.get(d.libraryId) : undefined));
  }

  private viewWith(d: WordDocument, lib: LibraryDetails | undefined): MyWord {
    const json = d.toJSON() as unknown as Record<string, unknown>;
    const full = fullWord(d as unknown as CourseWordRef, lib);
    delete json.libraryId; delete json.overrides;
    for (const k of DETAIL_FIELDS) json[k] = full[k];
    return json as unknown as MyWord;
  }

  async view(d: WordDocument): Promise<MyWord> {
    return (await this.views([d]))[0];
  }

  /** Id, spelling and review dates of all my words (for picking practice rounds). */
  brief(user: string) {
    return this.words.find({ user }, { word: 1, wordLower: 1, dueAt: 1, addedAt: 1 }).lean();
  }

  async findAll(user: string): Promise<MyWord[]> {
    return this.views(await this.words.find({ user }).sort({ addedAt: -1 }).exec());
  }

  /** My words with their details, only these ids when given. */
  async list(user: string, ids?: string[]): Promise<MyWord[]> {
    const filter: Record<string, unknown> = { user };
    if (ids) filter._id = { $in: ids.filter((x) => Types.ObjectId.isValid(x)) };
    return this.views(await this.words.find(filter).exec());
  }

  private async doc(user: string, id: string): Promise<WordDocument> {
    const w = await this.words.findOne({ _id: id, user });
    if (!w) throw new NotFoundException('Word not found');
    return w;
  }

  async findOne(user: string, id: string): Promise<MyWord> {
    return this.view(await this.doc(user, id));
  }

  async findByWord(user: string, word: string): Promise<MyWord | null> {
    const d = await this.words.findOne({ user, wordLower: word.trim().toLowerCase() });
    return d ? this.view(d) : null;
  }

  /* ---------- writing ---------- */

  /**
   * The library word for this word: the one there is, else (when `add`) a new library word made from my details —
   * one place for every word. A word with no meaning yet isn't added (nothing to share).
   */
  private async libraryFor(user: string, word: string, details: Partial<Details>, add: boolean): Promise<LibraryDetails | undefined> {
    const lower = word.toLowerCase();
    const have = await this.library.findOne({ wordLower: lower }, LIB_FIELDS).lean();
    if (have || !add) return (have as unknown as LibraryDetails) ?? undefined;
    if (!details.meaning?.trim() && !details.vi?.trim()) return undefined;
    const u = await this.words.db.collection('users').findOne({ _id: new Types.ObjectId(user) }, { projection: { name: 1 } }).catch(() => null);
    try {
      const made = await this.library.create({
        word, wordLower: lower, ipa: details.ipa ?? '', pos: details.pos ?? 'Noun', meaning: details.meaning ?? '', vi: details.vi ?? '', ex: details.ex ?? '',
        syn: details.syn ?? [], ant: details.ant ?? [], level: details.level ?? 'B1', family: cleanFamily(details.family), topic: 'other',
        authorId: user, authorName: (u?.name as string | undefined) || 'A learner'
      });
      return made.toObject() as unknown as LibraryDetails;
    } catch (e) {
      // Someone added it at the same moment.
      if (isDuplicateKey(e)) return (await this.library.findOne({ wordLower: lower }, LIB_FIELDS).lean()) as unknown as LibraryDetails;
      throw e;
    }
  }

  async create(user: string, dto: CreateWordDto): Promise<MyWord> {
    const word = dto.word.trim();
    const details = detailsOf(dto);
    const lib = await this.libraryFor(user, word, details, !ownOnly(dto.tags));
    // Only what differs from the library word is mine; a word not in the library keeps everything.
    const ref = wordRef({ word, ...details }, lib);
    const rest: Record<string, unknown> = { ...dto };
    for (const k of DETAIL_FIELDS) delete rest[k];
    try {
      const d = await this.words.create({ ...rest, user, word, wordLower: word.toLowerCase(), tags: clean(dto.tags), libraryId: ref.libraryId, overrides: ref.overrides });
      return this.viewWith(d, lib);
    } catch (e) {
      if (isDuplicateKey(e)) throw new ConflictException('“' + word + '” is already in your collection.');
      throw e;
    }
  }

  async update(user: string, id: string, dto: UpdateWordDto): Promise<MyWord> {
    const d = await this.doc(user, id);
    const now = await this.view(d);
    const word = dto.word !== undefined ? dto.word.trim() : d.word;
    const tags = dto.tags ? clean(dto.tags) : d.tags;
    // My details after this change; a new spelling (or a word not linked yet) looks for its library word again.
    const details: Partial<Details> = { ...Object.fromEntries(DETAIL_FIELDS.map((k) => [k, now[k]])), ...detailsOf(dto) };
    let lib: LibraryDetails | undefined;
    if (word.toLowerCase() === d.wordLower && d.libraryId) lib = (await this.library.findById(d.libraryId, LIB_FIELDS).lean()) as unknown as LibraryDetails ?? undefined;
    if (!lib) lib = await this.libraryFor(user, word, details, !ownOnly(tags));
    const ref = wordRef({ word, ...details }, lib);
    const set: Record<string, unknown> = { word, wordLower: word.toLowerCase(), libraryId: ref.libraryId, overrides: ref.overrides };
    for (const k of ['cat', 'notes'] as const) if (dto[k] !== undefined) set[k] = dto[k];
    if (dto.tags) set.tags = tags;
    try {
      const w = await this.words.findOneAndUpdate({ _id: id, user }, { $set: set, $unset: UNSET_OLD }, { returnDocument: 'after', runValidators: true });
      if (!w) throw new NotFoundException('Word not found');
      return this.viewWith(w, lib);
    } catch (e) {
      if (isDuplicateKey(e)) throw new ConflictException('“' + word + '” is already in your collection.');
      throw e;
    }
  }

  async remove(user: string, id: string): Promise<void> {
    const res = await this.words.deleteOne({ _id: id, user });
    if (!res.deletedCount) throw new NotFoundException('Word not found');
    // Its practice records (the practice module's collection).
    await this.words.db.collection('practice_words').deleteMany({ user, wordId: id });
  }

  async review(user: string, id: string, dto: ReviewWordDto) {
    const w = await this.doc(user, id);
    const now = Date.now();
    const next = schedule(w, dto.rating, now);
    w.status = next.status;
    w.dueAt = next.dueAt;
    w.hist.unshift({ at: new Date(now), r: dto.rating });
    await w.save();
    const progress = dto.practice ? undefined : await this.profile.recordReview(user, dto.day ?? dayKey(new Date(now)));
    return { word: await this.view(w), progress };
  }

  /** Used when a category is deleted. */
  async clearCategory(user: string, catId: string): Promise<void> {
    await this.words.updateMany({ user, cat: catId }, { $set: { cat: '' } });
  }

  /** Used when a tag is deleted. */
  async removeTag(user: string, tag: string): Promise<void> {
    await this.words.updateMany({ user, tags: tag }, { $pull: { tags: tag } });
  }

  /**
   * Gives old copies saved before word families existed (no `family` field at all, not linked to the library) the
   * library's family for the same word. Linked words get the family from the library anyway. Returns how many.
   */
  async backfillFamilies(families: Map<string, FamilyMember[]>): Promise<number> {
    if (!families.size) return 0;
    const rows = await this.words.find({ family: { $exists: false }, libraryId: { $in: [null, ''] }, overrides: { $exists: false }, wordLower: { $in: [...families.keys()] } }, { wordLower: 1 }).lean();
    if (!rows.length) return 0;
    await this.words.bulkWrite(rows.map((r) => ({ updateOne: { filter: { _id: r._id, family: { $exists: false } }, update: { $set: { family: families.get(r.wordLower)! } } } })), { ordered: false });
    return rows.length;
  }

  /** Ids of the user's words with these texts (lower-cased), by lower-cased word. */
  async idsByWords(user: string, wordsLower: string[]): Promise<Map<string, string>> {
    if (!wordsLower.length) return new Map();
    const rows = await this.words.find({ user, wordLower: { $in: wordsLower } }, { wordLower: 1 }).lean();
    return new Map(rows.map((r) => [r.wordLower, String(r._id)]));
  }
}
