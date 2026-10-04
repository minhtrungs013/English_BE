import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { DAY, MIN, dayKey, type Rating } from '../common/constants';
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

/** Every query is scoped to the signed-in user (`user`), so nobody can read or change another user's words. */
@Injectable()
export class WordsService {
  constructor(
    @InjectModel(Word.name) private readonly words: Model<Word>,
    private readonly profile: ProfileService
  ) {}

  findAll(user: string): Promise<WordDocument[]> {
    return this.words.find({ user }).sort({ addedAt: -1 }).exec();
  }

  async findOne(user: string, id: string): Promise<WordDocument> {
    const w = await this.words.findOne({ _id: id, user });
    if (!w) throw new NotFoundException('Word not found');
    return w;
  }

  async create(user: string, dto: CreateWordDto): Promise<WordDocument> {
    const word = dto.word.trim();
    try {
      return await this.words.create({ ...dto, user, word, wordLower: word.toLowerCase(), syn: clean(dto.syn), ant: clean(dto.ant), tags: clean(dto.tags) });
    } catch (e) {
      if (isDuplicateKey(e)) throw new ConflictException('“' + word + '” is already in your collection.');
      throw e;
    }
  }

  async update(user: string, id: string, dto: UpdateWordDto): Promise<WordDocument> {
    const patch: Record<string, unknown> = { ...dto };
    if (dto.word !== undefined) { patch.word = dto.word.trim(); patch.wordLower = dto.word.trim().toLowerCase(); }
    for (const k of ['syn', 'ant', 'tags'] as const) if (dto[k]) patch[k] = clean(dto[k]);
    try {
      const w = await this.words.findOneAndUpdate({ _id: id, user }, { $set: patch }, { returnDocument: 'after', runValidators: true });
      if (!w) throw new NotFoundException('Word not found');
      return w;
    } catch (e) {
      if (isDuplicateKey(e)) throw new ConflictException('“' + String(patch.word) + '” is already in your collection.');
      throw e;
    }
  }

  async remove(user: string, id: string): Promise<void> {
    const res = await this.words.deleteOne({ _id: id, user });
    if (!res.deletedCount) throw new NotFoundException('Word not found');
  }

  async review(user: string, id: string, dto: ReviewWordDto) {
    const w = await this.findOne(user, id);
    const now = Date.now();
    const next = schedule(w, dto.rating, now);
    w.status = next.status;
    w.dueAt = next.dueAt;
    w.hist.unshift({ at: new Date(now), r: dto.rating });
    await w.save();
    const progress = dto.practice ? undefined : await this.profile.recordReview(user, dto.day ?? dayKey(new Date(now)));
    return { word: w.toJSON(), progress };
  }

  /** Used when a category is deleted. */
  async clearCategory(user: string, catId: string): Promise<void> {
    await this.words.updateMany({ user, cat: catId }, { $set: { cat: '' } });
  }

  /** Used when a tag is deleted. */
  async removeTag(user: string, tag: string): Promise<void> {
    await this.words.updateMany({ user, tags: tag }, { $pull: { tags: tag } });
  }

  async findByWord(user: string, word: string): Promise<WordDocument | null> {
    return this.words.findOne({ user, wordLower: word.trim().toLowerCase() });
  }
}
