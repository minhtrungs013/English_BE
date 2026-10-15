import { Injectable, OnApplicationBootstrap, Logger } from '@nestjs/common';
import { InjectModel, Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Model, type HydratedDocument } from 'mongoose';
import { LESSON_BY_ID } from '../grammar/grammar.content';
import { BankItem } from './homework.schema';
import { checkParts, findSignals, ruleTense, sentenceKey, type Part } from './sentence-rules';
import { TEMPLATES, TENSES } from './tense';

/**
 * The grammar of one sentence, stored once and shared by every question, course and lesson that uses it.
 * Written when the sentence is made (built-in templates, AI questions); sentences without one get the
 * pattern-based tense at read time.
 */
@Schema({ collection: 'sentence_grammar', timestamps: true })
export class SentenceGrammar {
  @Prop({ required: true, unique: true }) key: string;
  @Prop({ required: true }) text: string;
  @Prop({ default: '' }) tense: string;
  @Prop({ type: [{ _id: false, text: String, role: String }], default: [] }) parts: Part[];
  @Prop({ default: '' }) explain: string;
  @Prop({ type: [{ _id: false, on: String, text: String }], default: [] }) notes: { on: string; text: string }[];
  @Prop({ enum: ['template', 'ai', 'owner'], default: 'ai' }) source: string;
  /** Checked by a course owner: never overwritten by generated data. */
  @Prop({ default: false }) checked: boolean;
}
export type SentenceGrammarDocument = HydratedDocument<SentenceGrammar>;
export const SentenceGrammarSchema = SchemaFactory.createForClass(SentenceGrammar);

/** What the app shows for a sentence. Formula, lesson and clues come from the grammar lessons, not from storage. */
export interface GrammarView {
  text: string;
  tense: string;
  lesson: { id: string; name: string; vi: string } | null;
  formula: string;
  signals: string[];
  /** The sentence split into subject / verb / object…; empty when it hasn't been analysed. */
  parts: Part[];
  explain: string;
  notes: { on: string; text: string }[];
  /** 'full': stored analysis; 'basic': tense found by pattern (or given by the question) only. */
  level: 'full' | 'basic';
}

/** Extra facts a question already knows: its tense and explanation (bank items), a word-form note. */
export interface GrammarHint { tense?: string; explain?: string; note?: { on: string; text: string } | null }

export interface GrammarInput { text: string; tense: string; parts?: Part[]; explain?: string; notes?: { on: string; text: string }[]; source: 'template' | 'ai' | 'owner' }

@Injectable()
export class SentenceGrammarService implements OnApplicationBootstrap {
  private readonly log = new Logger('SentenceGrammar');

  constructor(
    @InjectModel(SentenceGrammar.name) private readonly docs: Model<SentenceGrammar>,
    @InjectModel(BankItem.name) private readonly bank: Model<BankItem>
  ) {}

  /** Stores analyses (skipping invalid parts); an owner-checked one is kept as it is. */
  async save(items: GrammarInput[]): Promise<void> {
    const ops = items.filter((g) => g.text.trim() && (TENSES as readonly string[]).includes(g.tense)).map((g) => {
      const parts = g.parts ? checkParts(g.text, g.parts) ?? [] : [];
      return {
        updateOne: {
          filter: { key: sentenceKey(g.text), checked: { $ne: true } },
          update: { $set: { text: g.text.trim(), tense: g.tense, parts, explain: (g.explain ?? '').slice(0, 400), notes: (g.notes ?? []).slice(0, 4), source: g.source } },
          upsert: true
        }
      };
    });
    if (!ops.length) return;
    // An owner-checked document makes the upsert try to insert a duplicate key: that one is simply skipped.
    await this.docs.bulkWrite(ops, { ordered: false }).catch((e: { code?: number }) => { if (e?.code !== 11000) throw e; });
  }

  /** The grammar to show for each sentence ('' entries give null). One query for all of them. */
  async views(items: { text: string; hint?: GrammarHint }[]): Promise<(GrammarView | null)[]> {
    const keys = [...new Set(items.filter((i) => i.text).map((i) => sentenceKey(i.text)))];
    const stored = keys.length ? new Map((await this.docs.find({ key: { $in: keys } }).lean()).map((d) => [d.key, d])) : new Map();
    return items.map(({ text, hint }) => {
      if (!text) return null;
      const d = stored.get(sentenceKey(text));
      const tense = d?.tense || hint?.tense || ruleTense(text) || '';
      const lesson = tense ? LESSON_BY_ID.get(tense) : undefined;
      const notes = [...(d?.notes ?? []), ...(hint?.note ? [hint.note] : [])];
      if (!lesson && !notes.length) return null;
      return {
        text, tense,
        lesson: lesson ? { id: lesson.id, name: lesson.name, vi: lesson.vi } : null,
        formula: lesson?.formula?.affirmative.pattern ?? '',
        signals: tense ? findSignals(text, tense) : [],
        parts: d?.parts ?? [],
        explain: d?.explain || hint?.explain || '',
        notes,
        level: d?.parts?.length ? 'full' : 'basic'
      };
    });
  }

  /**
   * Once at start-up: tense questions made from the built-in templates before sentence grammar existed
   * get their analysis (the template knows the parts). AI questions wait for an AI pass.
   */
  async onApplicationBootstrap(): Promise<void> {
    try {
      const items = await this.bank.find({ kind: { $in: ['tense', 'tenseChoice'] }, source: 'template' }, { prompt: 1, answer: 1, tense: 1, explain: 1 }).lean();
      const out: GrammarInput[] = [];
      for (const b of items) {
        const t = TEMPLATES.find((x) => x.tense === b.tense && new RegExp('^' + x.sentence.split('___')[0].replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).test(b.prompt));
        if (!t) continue;
        const text = b.prompt.replace(/_{3,}(\s*\([^)]*\))?/, b.answer).replace(/\s+/g, ' ').trim();
        out.push({ text, tense: t.tense, parts: t.parts(b.answer), explain: b.explain, source: 'template' });
      }
      const have = new Set((await this.docs.find({ key: { $in: out.map((o) => sentenceKey(o.text)) } }, { key: 1 }).lean()).map((d) => d.key));
      const missing = out.filter((o) => !have.has(sentenceKey(o.text)));
      if (missing.length) {
        await this.save(missing);
        this.log.log('Added the grammar of ' + missing.length + ' template sentences.');
      }
    } catch (e) {
      this.log.warn('Template backfill skipped: ' + String(e));
    }
  }
}
