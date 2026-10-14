import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Transform } from 'class-transformer';
import { IsIn, IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';

/** Parts of speech a word-family member can have. */
export const FAMILY_POS = ['Noun', 'Verb', 'Adjective', 'Adverb', 'Other'] as const;
export type FamilyPos = (typeof FAMILY_POS)[number];

/** Most members a family can have (the word itself included). */
export const FAMILY_MAX = 8;

/** One form in a word's family, e.g. decide → decision (Noun), decisive (Adjective). */
@Schema({ _id: false })
export class FamilyMember {
  @Prop({ required: true, trim: true }) word: string;
  @Prop({ enum: FAMILY_POS, default: 'Other' }) pos: string;
  @Prop({ default: '' }) vi: string;
  @Prop() ex?: string;
  /** Short hint, e.g. "opposite (in-)". */
  @Prop() note?: string;
}
export const FamilyMemberSchema = SchemaFactory.createForClass(FamilyMember);

/** Mongoose prop options for a `family` field. */
export const familyProp = { type: [FamilyMemberSchema], default: [] };

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

export class FamilyMemberDto {
  @Transform(trim) @IsString() @IsNotEmpty() @MaxLength(40) word: string;
  @IsIn(FAMILY_POS) pos: string;
  @Transform(trim) @IsString() @MaxLength(80) vi: string;
  @IsOptional() @Transform(trim) @IsString() @MaxLength(160) ex?: string;
  @IsOptional() @Transform(trim) @IsString() @MaxLength(30) note?: string;
}

const WORD_RE = /^\p{L}[\p{L}'’ .-]*$/u;

interface CleanOptions {
  /** Most members to keep (default 8). */
  max?: number;
  /** AI output: members need a plain word and a Vietnamese translation. */
  strict?: boolean;
  /** The word the family belongs to: added first when it's missing (AI output). */
  self?: { word: string; pos: string; vi: string };
}

/**
 * Checks a family from any source (user input, AI, the seed file): drops members that aren't valid,
 * repeated words and too-long examples / notes, and keeps a fixed key order so families can be compared
 * as JSON. Fewer than 2 members means there is no family: [].
 */
export function cleanFamily(v: unknown, opts: CleanOptions = {}): FamilyMember[] {
  const max = opts.max ?? FAMILY_MAX;
  const out: FamilyMember[] = [];
  const seen = new Set<string>();
  const add = (m: FamilyMember) => {
    const key = m.word.toLowerCase() + '|' + m.pos;
    if (seen.has(key)) return;
    seen.add(key);
    out.push(m);
  };
  if (Array.isArray(v)) {
    for (const raw of v as unknown[]) {
      if (!raw || typeof raw !== 'object') continue;
      const r = raw as Record<string, unknown>;
      const word = typeof r.word === 'string' ? r.word.trim().replace(/\s+/g, ' ') : '';
      const pos = typeof r.pos === 'string' ? r.pos.trim() : '';
      const vi = typeof r.vi === 'string' ? r.vi.trim() : '';
      if (!word || word.length > 40 || (opts.strict && !WORD_RE.test(word))) continue;
      if (!(FAMILY_POS as readonly string[]).includes(pos)) continue;
      if (vi.length > 80 || (opts.strict && !vi)) continue;
      const ex = typeof r.ex === 'string' ? r.ex.trim() : '';
      const note = typeof r.note === 'string' ? r.note.trim() : '';
      add({ word, pos, vi, ...(ex && ex.length <= 160 ? { ex } : {}), ...(note && note.length <= 30 ? { note } : {}) });
    }
  }
  const self = opts.self;
  if (self && out.length && !out.some((m) => m.word.toLowerCase() === self.word.trim().toLowerCase())) {
    const pos = (FAMILY_POS as readonly string[]).includes(self.pos) ? self.pos : 'Other';
    out.unshift({ word: self.word.trim(), pos, vi: self.vi.trim().slice(0, 80) });
  }
  const kept = out.slice(0, max);
  return kept.length >= 2 ? kept : [];
}
