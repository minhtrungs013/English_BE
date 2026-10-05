import { ConflictException, ForbiddenException, Injectable, Logger, NotFoundException, OnApplicationBootstrap } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, QueryFilter } from 'mongoose';
import { Tag } from '../tags/tags';
import { User } from '../users/user.schema';
import { WordsService } from '../words/words.service';
import { LibraryQuery, ShareWordDto } from './library.dto';
import { LibraryWord, LibraryWordDocument, TOPIC_TAG, TOPICS, type Topic } from './library.schema';
import SEED from './seed/library.json';

interface SeedEntry { word: string; ipa: string; pos: string; meaning: string; vi: string; ex: string; syn: string[]; ant: string[]; level: string; topic: string }

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

@Injectable()
export class LibraryService implements OnApplicationBootstrap {
  private readonly log = new Logger('Library');

  constructor(
    @InjectModel(LibraryWord.name) private readonly lib: Model<LibraryWord>,
    @InjectModel(Tag.name) private readonly tags: Model<Tag>,
    @InjectModel(User.name) private readonly users: Model<User>,
    private readonly words: WordsService
  ) {}

  /**
   * Keeps the built-in words in line with seed/library.json: adds missing ones and removes
   * built-in words no longer in the file. Words users shared, and words users saved to their
   * own vocabulary, are never touched.
   */
  async onApplicationBootstrap(): Promise<void> {
    const keys = (SEED as SeedEntry[]).map((e) => e.word.toLowerCase());
    if (keys.length) {
      const removed = await this.lib.deleteMany({ authorId: '', wordLower: { $nin: keys } });
      if (removed.deletedCount) this.log.log('Removed ' + removed.deletedCount + ' built-in words no longer in the seed list.');
    }
    const ops = (SEED as SeedEntry[]).map((e) => ({
      updateOne: {
        filter: { wordLower: e.word.toLowerCase() },
        update: { $setOnInsert: { ...e, wordLower: e.word.toLowerCase(), authorId: '', authorName: 'Wordbook', saves: 0, sharedAt: new Date() } },
        upsert: true
      }
    }));
    if (!ops.length) return;
    const res = await this.lib.bulkWrite(ops, { ordered: false });
    if (res.upsertedCount) this.log.log('Added ' + res.upsertedCount + ' built-in words to the library.');
  }

  async list(user: string, q: LibraryQuery) {
    const page = q.page ?? 1;
    const limit = q.limit ?? 24;
    const filter: QueryFilter<LibraryWord> = {};
    if (q.q?.trim()) {
      const re = new RegExp(escapeRegex(q.q.trim()), 'i');
      filter.$or = [{ word: re }, { meaning: re }, { vi: re }];
    }
    if (q.level) filter.level = q.level;
    if (q.source === 'me') filter.authorId = user;
    else if (q.source === 'community') filter.authorId = { $ne: '' };
    else if (q.source === 'builtin') filter.authorId = '';
    // Topic counts ignore the topic filter so the chips can show how many words each topic has.
    const [items, total, counts] = await Promise.all([
      this.lib.find(q.topic ? { ...filter, topic: q.topic } : filter)
        .sort(q.q?.trim() ? { wordLower: 1 } : { sharedAt: -1, wordLower: 1 })
        .skip((page - 1) * limit).limit(limit),
      this.lib.countDocuments(q.topic ? { ...filter, topic: q.topic } : filter),
      this.lib.aggregate<{ _id: string; n: number }>([{ $match: filter }, { $group: { _id: '$topic', n: { $sum: 1 } } }])
    ]);
    const topics = Object.fromEntries(TOPICS.map((t) => [t, 0])) as Record<Topic, number>;
    let all = 0;
    for (const c of counts) { topics[c._id as Topic] = c.n; all += c.n; }
    return { items: items.map((d) => d.toJSON()), total, page, limit, topics, all };
  }

  async findOne(id: string): Promise<LibraryWordDocument> {
    const d = await this.lib.findById(id);
    if (!d) throw new NotFoundException('This word is no longer in the library.');
    return d;
  }

  /** Copies a library word into the user's vocabulary, tagged with its topic. */
  async save(user: string, id: string) {
    const d = await this.findOne(id);
    const tag = TOPIC_TAG[(d.topic as Topic) ?? 'other'];
    await this.tags.updateOne({ user, name: tag }, { $setOnInsert: { user, name: tag } }, { upsert: true });
    const w = await this.words.create(user, {
      word: d.word, ipa: d.ipa, pos: d.pos, meaning: d.meaning, vi: d.vi, ex: d.ex,
      syn: d.syn, ant: d.ant, level: d.level, tags: [tag]
    });
    await this.lib.updateOne({ _id: d._id }, { $inc: { saves: 1 } });
    return { word: w.toJSON(), tag };
  }

  /** Shares one of the user's own words to the library under the user's name. */
  async share(user: string, dto: ShareWordDto) {
    const w = await this.words.findOne(user, dto.wordId);
    return (await this.shareData(user, w, dto.topic ?? 'other')).toJSON();
  }

  /** Adds a word to the library under the user's name (used for my words and for course words). */
  async shareData(
    user: string,
    w: { word: string; ipa: string; pos: string; meaning: string; vi: string; ex: string; syn: string[]; ant: string[]; level: string },
    topic: string
  ): Promise<LibraryWordDocument> {
    if (!w.meaning.trim() && !w.vi.trim()) throw new ConflictException('Add a meaning or a Vietnamese translation before sharing.');
    const u = await this.users.findById(user);
    try {
      return await this.lib.create({
        word: w.word, wordLower: w.word.toLowerCase(), ipa: w.ipa, pos: w.pos, meaning: w.meaning, vi: w.vi, ex: w.ex,
        syn: w.syn, ant: w.ant, level: w.level, topic, authorId: user, authorName: u?.name ?? 'A learner'
      });
    } catch (e) {
      if ((e as { code?: number }).code === 11000) throw new ConflictException('“' + w.word + '” is already in the library.');
      throw e;
    }
  }

  /** Only the person who shared a word can take it back out of the library. */
  async unshare(user: string, id: string): Promise<void> {
    const d = await this.findOne(id);
    if (d.authorId !== user) throw new ForbiddenException('You can only remove words you shared.');
    await d.deleteOne();
  }

  /** One library entry by its lower-cased word. */
  async findByWord(wordLower: string): Promise<LibraryWordDocument | null> {
    return this.lib.findOne({ wordLower });
  }

  /** Which of these words (lower-cased) are already in the library. */
  async existing(wordsLower: string[]): Promise<string[]> {
    if (!wordsLower.length) return [];
    return (await this.lib.find({ wordLower: { $in: wordsLower } }, { wordLower: 1 }).lean()).map((d) => d.wordLower);
  }

  /** Keeps the author's name on shared words in sync after a rename. */
  async renameAuthor(user: string, name: string): Promise<void> {
    await this.lib.updateMany({ authorId: user }, { $set: { authorName: name } });
  }
}
