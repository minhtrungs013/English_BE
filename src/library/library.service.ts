import { ConflictException, ForbiddenException, Injectable, Logger, NotFoundException, OnApplicationBootstrap } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, QueryFilter } from 'mongoose';
import { cleanFamily, type FamilyMember } from '../common/family';
import { Tag } from '../tags/tags';
import { User } from '../users/user.schema';
import { NotificationsService } from '../notifications/notifications.service';
import { WordsService } from '../words/words.service';
import { LibraryQuery, ShareWordDto } from './library.dto';
import { LibraryWord, LibraryWordDocument, TOPIC_TAG, TOPICS, type Topic } from './library.schema';
import SEED from './seed/library.json';

interface SeedEntry { word: string; ipa: string; pos: string; meaning: string; vi: string; ex: string; syn: string[]; ant: string[]; level: string; topic: string; family?: unknown[] }

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
    private readonly words: WordsService,
    private readonly notes: NotificationsService
  ) {}

  /**
   * Keeps the built-in words in line with seed/library.json: adds missing ones, removes
   * built-in words no longer in the file and updates the word family of built-in words whose family
   * in the file changed (entries without a `family` key are left as they are). Words users shared,
   * and words users saved to their own vocabulary, are never touched.
   */
  async onApplicationBootstrap(): Promise<void> {
    const seed = SEED as SeedEntry[];
    const keys = seed.map((e) => e.word.toLowerCase());
    if (keys.length) {
      const removed = await this.lib.deleteMany({ authorId: '', wordLower: { $nin: keys } });
      if (removed.deletedCount) this.log.log('Removed ' + removed.deletedCount + ' built-in words no longer in the seed list.');
    }
    const ops = seed.map((e) => ({
      updateOne: {
        filter: { wordLower: e.word.toLowerCase() },
        update: { $setOnInsert: { ...e, family: cleanFamily(e.family), wordLower: e.word.toLowerCase(), authorId: '', authorName: 'Wordbook', saves: 0, sharedAt: new Date() } },
        upsert: true
      }
    }));
    if (!ops.length) return;
    const res = await this.lib.bulkWrite(ops, { ordered: false });
    if (res.upsertedCount) this.log.log('Added ' + res.upsertedCount + ' built-in words to the library.');
    // Words learners saved before families existed get the library's family once.
    const families = new Map(seed.map((e) => [e.word.toLowerCase(), cleanFamily(e.family)] as const).filter(([, f]) => f.length));
    const filled = await this.words.backfillFamilies(families);
    if (filled) this.log.log('Added the word family to ' + filled + ' saved words.');
    await this.syncFamilies(seed);
  }

  /** Sets the family of built-in words to the seed's where it differs (compared as cleaned JSON). */
  async syncFamilies(seed: SeedEntry[]): Promise<number> {
    const want = new Map<string, FamilyMember[]>();
    for (const e of seed) if (Array.isArray(e.family)) want.set(e.word.toLowerCase(), cleanFamily(e.family));
    if (!want.size) return 0;
    const have = await this.lib.find({ authorId: '' }, { wordLower: 1, family: 1 }).lean();
    const ops = [];
    for (const d of have) {
      const family = want.get(d.wordLower);
      if (family && JSON.stringify(cleanFamily(d.family)) !== JSON.stringify(family)) {
        ops.push({ updateOne: { filter: { _id: d._id, authorId: '' }, update: { $set: { family } } } });
      }
    }
    if (!ops.length) return 0;
    await this.lib.bulkWrite(ops, { ordered: false });
    this.log.log('Updated the word family of ' + ops.length + ' built-in words.');
    return ops.length;
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
    const term = q.q?.trim().toLowerCase() ?? '';
    const [items, total, counts] = await Promise.all([
      term ? this.ranked(q.topic ? { ...filter, topic: q.topic } : filter, term, (page - 1) * limit, limit)
        : this.lib.find(q.topic ? { ...filter, topic: q.topic } : filter).sort({ sharedAt: -1, wordLower: 1 }).skip((page - 1) * limit).limit(limit),
      this.lib.countDocuments(q.topic ? { ...filter, topic: q.topic } : filter),
      this.lib.aggregate<{ _id: string; n: number }>([{ $match: filter }, { $group: { _id: '$topic', n: { $sum: 1 } } }])
    ]);
    const topics = Object.fromEntries(TOPICS.map((t) => [t, 0])) as Record<Topic, number>;
    let all = 0;
    for (const c of counts) { topics[c._id as Topic] = c.n; all += c.n; }
    return { items: items.map((d) => d.toJSON()), total, page, limit, topics, all };
  }

  /**
   * Search results, best matches first: the word itself, then words starting with the search, then words containing it,
   * then words that only match in their meaning (A–Z within each group).
   */
  private async ranked(filter: QueryFilter<LibraryWord>, term: string, skip: number, limit: number): Promise<LibraryWordDocument[]> {
    const rows = await this.lib.aggregate<{ _id: unknown }>([
      { $match: filter },
      {
        $addFields: {
          _rank: {
            $switch: {
              branches: [
                { case: { $eq: ['$wordLower', term] }, then: 0 },
                { case: { $eq: [{ $indexOfCP: ['$wordLower', term] }, 0] }, then: 1 },
                { case: { $gt: [{ $indexOfCP: ['$wordLower', term] }, 0] }, then: 2 }
              ],
              default: 3
            }
          }
        }
      },
      { $sort: { _rank: 1, wordLower: 1 } },
      { $skip: skip },
      { $limit: limit },
      { $project: { _id: 1 } }
    ]);
    const ids = rows.map((r) => String(r._id));
    const docs = await this.lib.find({ _id: { $in: ids } });
    const byId = new Map(docs.map((d) => [String(d._id), d]));
    return ids.map((id) => byId.get(id)).filter((d): d is LibraryWordDocument => !!d);
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
      syn: d.syn, ant: d.ant, level: d.level, tags: [tag], family: d.family ?? []
    });
    await this.lib.updateOne({ _id: d._id }, { $inc: { saves: 1 } });
    await this.notes.librarySaved(d.authorId, user, String(d._id), d.word).catch(() => undefined);
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
    w: { word: string; ipa: string; pos: string; meaning: string; vi: string; ex: string; syn: string[]; ant: string[]; level: string; family?: FamilyMember[] },
    topic: string
  ): Promise<LibraryWordDocument> {
    if (!w.meaning.trim() && !w.vi.trim()) throw new ConflictException('Add a meaning or a Vietnamese translation before sharing.');
    const u = await this.users.findById(user);
    try {
      return await this.lib.create({
        word: w.word, wordLower: w.word.toLowerCase(), ipa: w.ipa, pos: w.pos, meaning: w.meaning, vi: w.vi, ex: w.ex,
        syn: w.syn, ant: w.ant, level: w.level, family: cleanFamily(w.family), topic, authorId: user, authorName: u?.name ?? 'A learner'
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

  /**
   * For each word (in the order given): the library entry with that word and the user's own word with
   * that text (case-insensitive), as ids or null.
   */
  async familyStatus(user: string, words: string[]) {
    const list = words.map((w) => w.trim()).filter(Boolean);
    const lower = [...new Set(list.map((w) => w.toLowerCase()))];
    const [lib, mine] = await Promise.all([
      this.lib.find({ wordLower: { $in: lower } }, { wordLower: 1 }).lean(),
      this.words.idsByWords(user, lower)
    ]);
    const libIds = new Map(lib.map((d) => [d.wordLower, String(d._id)]));
    return {
      items: list.map((word) => ({ word, libraryId: libIds.get(word.toLowerCase()) ?? null, myWordId: mine.get(word.toLowerCase()) ?? null }))
    };
  }

  /** One library entry by its lower-cased word. */
  async findByWord(wordLower: string): Promise<LibraryWordDocument | null> {
    return this.lib.findOne({ wordLower });
  }

  /**
   * Built-in words for filling a course: random, optionally only some levels / topics, never one of `exclude`
   * (lowercase words). May return fewer than `n` when the filters leave too few.
   */
  async pickForCourse(n: number, levels: string[], topics: string[], exclude: Set<string>): Promise<LibraryWordDocument[]> {
    const match: Record<string, unknown> = { authorId: '', meaning: { $ne: '' }, ex: { $ne: '' } };
    if (levels.length) match.level = { $in: levels };
    if (topics.length) match.topic = { $in: topics };
    if (exclude.size) match.wordLower = { $nin: [...exclude] };
    return this.lib.aggregate<LibraryWordDocument>([{ $match: match }, { $sample: { size: n } }]);
  }

  /** A few random library words (e.g. wrong choices for quiz questions). */
  async sample(n: number): Promise<{ word: string; vi: string; meaning: string }[]> {
    return this.lib.aggregate([{ $sample: { size: n } }, { $project: { _id: 0, word: 1, vi: 1, meaning: 1 } }]);
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
