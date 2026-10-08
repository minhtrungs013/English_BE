/**
 * Grammar lessons and their practice drills (written in content/<id>.json): theory in Vietnamese, examples and
 * drills in English. Two groups: "foundations" (helping verbs be / do / have, subject–verb agreement, a cheat sheet)
 * and "tenses" (the 7 core tenses). Drill ids are "<lesson>:<index>".
 */
import AGREEMENT from './content/agreement.json';
import AUX_CHEATSHEET from './content/aux-cheatsheet.json';
import BE from './content/be.json';
import DO from './content/do.json';
import FUTURE_SIMPLE from './content/future-simple.json';
import GOING_TO from './content/going-to.json';
import HAVE from './content/have.json';
import PAST_CONTINUOUS from './content/past-continuous.json';
import PAST_SIMPLE from './content/past-simple.json';
import PRESENT_CONTINUOUS from './content/present-continuous.json';
import PRESENT_PERFECT from './content/present-perfect.json';
import PRESENT_SIMPLE from './content/present-simple.json';
import type { Tense } from '../courses/tense';

export type Group = 'foundations' | 'tenses';
export interface Example { en: string; vi: string }
export interface Drill {
  /** Tense lessons: the tense of the correct answer (a few drills contrast it with a neighbouring tense). */
  tense?: Tense;
  /** Foundations lessons: a short label shown with the result (e.g. "Be · past"). */
  topic?: string;
  kind: 'tense' | 'tenseChoice';
  level: 'easy' | 'medium' | 'hard';
  prompt: string;
  choices: string[];
  answer: string;
  accept: string[];
  explain: string;
}
/** A conjugation table; a row's `link` opens another lesson. */
export interface Table { title: string; columns: string[]; rows: { label: string; cells: string[]; link?: string }[]; note?: string }
export interface Lesson {
  id: string;
  group: Group;
  name: string;
  vi: string;
  summary: string;
  /** Tenses: the three sentence patterns, the helping verb by subject, and the Foundations lesson about it. */
  formula?: Record<'affirmative' | 'negative' | 'question', { pattern: string; example: string; vi: string }> & {
    persons?: { subject: string; affirmative: string; negative: string; question: string }[];
    foundation?: string;
  };
  tables?: Table[];
  uses: { title: string; explain: string; examples: Example[] }[];
  signals?: string[];
  mistakes: { wrong: string; right: string; explain: string }[];
  compare?: { with: Tense; explain: string; examples: (Example & { tense: Tense })[] };
  drills: Drill[];
}

const tense = (l: object) => ({ ...l, group: 'tenses' }) as Lesson;

/** In the order they're taught: foundations first. */
export const LESSONS: Lesson[] = [
  BE, DO, HAVE, AGREEMENT, AUX_CHEATSHEET,
  ...[PRESENT_SIMPLE, PRESENT_CONTINUOUS, PRESENT_PERFECT, PAST_SIMPLE, PAST_CONTINUOUS, FUTURE_SIMPLE, GOING_TO].map(tense)
] as Lesson[];

export const LESSON_BY_ID = new Map(LESSONS.map((l) => [l.id, l]));
