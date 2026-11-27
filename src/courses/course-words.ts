import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import type { Db } from 'mongodb';
import { Model, Types } from 'mongoose';
import { cleanFamily } from '../common/family';
import { LibraryWord } from '../library/library.schema';
import { COURSE_WORD_FIELDS, Course, CourseWord, CourseWordOverrides, CourseWordRef } from './course.schema';

/** The details a library word gives a course word. */
export type LibraryDetails = Pick<CourseWord, (typeof COURSE_WORD_FIELDS)[number]> & { _id: unknown; word: string };

const EMPTY: Omit<CourseWord, 'word' | 'libraryId' | 'source'> = { ipa: '', pos: 'Noun', meaning: '', vi: '', ex: '', syn: [], ant: [], family: [], level: 'B1' };

const squash = (s: unknown) => String(s ?? '').replace(/\s+/g, ' ').trim();

/** A field value compared however it was stored (family members in any order without their empty keys, extra spaces). */
function same(field: string, a: unknown, b: unknown): boolean {
  if (field === 'family') {
    const key = (v: unknown) => JSON.stringify(cleanFamily(v).map((m) => JSON.stringify(m)).sort());
    return key(a) === key(b);
  }
  if (Array.isArray(a) || Array.isArray(b)) return JSON.stringify(((a as string[] | undefined) ?? []).map(squash)) === JSON.stringify(((b as string[] | undefined) ?? []).map(squash));
  return squash(a) === squash(b);
}

/** What a question or sentence about the word depends on: its part of speech and meanings (lower case, spaces squashed). */
export const senseOf = (w: { pos?: string; vi?: string; meaning?: string }) => [w.pos, w.vi, w.meaning].map((x) => squash(x).toLowerCase()).join('|');

export const blank = (v: unknown) => v == null || (typeof v === 'string' && !v.trim()) || (Array.isArray(v) && !v.length);

const plain = <T>(v: T): T => JSON.parse(JSON.stringify(v ?? null)) as T;

/**
 * A stored course word with all its details: the library word, then an old full copy (courses saved before words
 * were links), then the course's own changes.
 */
export function fullWord(ref: CourseWordRef, lib: LibraryDetails | undefined): CourseWord {
  const out: CourseWord = { ...EMPTY, word: ref.word, libraryId: lib ? String(lib._id) : '', source: ref.source || (lib ? 'library' : 'manual') };
  const set = (k: string, v: unknown) => { if (v !== undefined && v !== null) (out as unknown as Record<string, unknown>)[k] = plain(v); };
  for (const k of COURSE_WORD_FIELDS) {
    if (lib) set(k, lib[k]);
    // An old copy's empty field (e.g. no word family yet) doesn't hide what the library has now.
    const old = (ref as unknown as Record<string, unknown>)[k];
    if (!(lib && blank(old))) set(k, old);
    set(k, ref.overrides?.[k]);
  }
  out.family = cleanFamily(out.family);
  return out;
}

/**
 * How a course word with these details is stored: a link to the library word (found by id, else by the word) with
 * only the fields that differ from it, or every detail when the word isn't in the library.
 */
export function wordRef(w: Partial<CourseWord> & { word: string }, lib: LibraryDetails | undefined): CourseWordRef {
  const overrides: CourseWordOverrides = {};
  for (const k of COURSE_WORD_FIELDS) {
    const v = (w as Record<string, unknown>)[k];
    if (v === undefined) continue;
    const value = k === 'family' ? cleanFamily(v) : plain(v);
    if (!lib || !same(k, value, lib[k])) (overrides as Record<string, unknown>)[k] = value;
  }
  return { word: w.word.trim(), libraryId: lib ? String(lib._id) : '', source: w.source || (lib ? 'library' : 'manual'), overrides };
}

/**
 * Before library words are deleted: courses that link to them get the words' full details as their own
 * (overrides, no link), so the courses keep them. Works on the raw collection (the library module can't use courses).
 */
export async function detachFromCourses(db: Db, libs: LibraryDetails[]): Promise<number> {
  const byId = new Map(libs.map((l) => [String(l._id), l]));
  if (!byId.size) return 0;
  const courses = db.collection<{ days: { day: number; words: CourseWordRef[] }[] }>('courses');
  const list = await courses.find({ 'days.words.libraryId': { $in: [...byId.keys()] } }, { projection: { days: 1 } }).toArray();
  let n = 0;
  for (const c of list) {
    const days = c.days.map((d) => ({
      ...d,
      words: d.words.map((w) => {
        const lib = byId.get(w.libraryId);
        if (!lib) return w;
        n++;
        const full = fullWord(w, lib);
        const overrides = Object.fromEntries(COURSE_WORD_FIELDS.map((k) => [k, full[k]])) as CourseWordOverrides;
        return { word: w.word, libraryId: '', source: w.source, overrides };
      })
    }));
    await courses.updateOne({ _id: c._id }, { $set: { days } });
  }
  return n;
}

const LIB_FIELDS = { word: 1, wordLower: 1, ...Object.fromEntries(COURSE_WORD_FIELDS.map((k) => [k, 1])) };

/** Reads course words with their library details, and turns words from the course editor into links. */
@Injectable()
export class CourseWordsService {
  constructor(@InjectModel(LibraryWord.name) private readonly library: Model<LibraryWord>) {}

  /** Library words by id and by word (lowercase), for the given stored or edited words. */
  private async libraryFor(words: { word: string; libraryId?: string }[]) {
    const ids = [...new Set(words.map((w) => w.libraryId ?? '').filter((id) => Types.ObjectId.isValid(id)))];
    const lower = [...new Set(words.map((w) => w.word.trim().toLowerCase()))];
    const rows = ids.length || lower.length
      ? await this.library.find({ $or: [...(ids.length ? [{ _id: { $in: ids } }] : []), ...(lower.length ? [{ wordLower: { $in: lower } }] : [])] }, LIB_FIELDS).lean()
      : [];
    const byId = new Map(rows.map((r) => [String(r._id), r as unknown as LibraryDetails]));
    const byWord = new Map(rows.map((r) => [(r as { wordLower: string }).wordLower, r as unknown as LibraryDetails]));
    return { byId, byWord };
  }

  /** Every day of the course (by day number) with its words' full details. One library read for the whole course. */
  async days(c: Pick<Course, 'days'>): Promise<{ day: number; words: CourseWord[] }[]> {
    const days = [...(c.days ?? [])].sort((a, b) => a.day - b.day);
    const linked = days.flatMap((d) => d.words).filter((w) => w.libraryId);
    const ids = [...new Set(linked.map((w) => w.libraryId).filter((id) => Types.ObjectId.isValid(id)))];
    const rows = ids.length ? await this.library.find({ _id: { $in: ids } }, LIB_FIELDS).lean() : [];
    const byId = new Map(rows.map((r) => [String(r._id), r as unknown as LibraryDetails]));
    return days.map((d) => ({ day: d.day, words: d.words.map((w) => fullWord(w, w.libraryId ? byId.get(w.libraryId) : undefined)) }));
  }

  /** One day's words with their full details ([] when the day has none). */
  async day(c: Pick<Course, 'days'>, day: number): Promise<CourseWord[]> {
    return (await this.days({ days: (c.days ?? []).filter((d) => d.day === day) }))[0]?.words ?? [];
  }

  /** Words from the course editor (or picked from the library) as stored links with the course's own changes. */
  async refs(words: (Partial<CourseWord> & { word: string })[]): Promise<CourseWordRef[]> {
    const { byId, byWord } = await this.libraryFor(words);
    return words.map((w) => wordRef(w, (w.libraryId ? byId.get(w.libraryId) : undefined) ?? byWord.get(w.word.trim().toLowerCase())));
  }
}
