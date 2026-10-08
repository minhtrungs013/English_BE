/**
 * The tense lessons and their practice drills (written in content/<tense>.json): theory in Vietnamese,
 * examples and drills in English. Drill ids are "<tense>:<index>".
 */
import FUTURE_SIMPLE from './content/future-simple.json';
import GOING_TO from './content/going-to.json';
import PAST_CONTINUOUS from './content/past-continuous.json';
import PAST_SIMPLE from './content/past-simple.json';
import PRESENT_CONTINUOUS from './content/present-continuous.json';
import PRESENT_PERFECT from './content/present-perfect.json';
import PRESENT_SIMPLE from './content/present-simple.json';
import type { Tense } from '../courses/tense';

export interface Example { en: string; vi: string }
export interface Drill {
  /** The tense of the correct answer (a few drills in each lesson contrast it with a neighbouring tense). */
  tense: Tense;
  kind: 'tense' | 'tenseChoice';
  level: 'easy' | 'medium' | 'hard';
  prompt: string;
  choices: string[];
  answer: string;
  accept: string[];
  explain: string;
}
export interface Lesson {
  id: Tense;
  name: string;
  vi: string;
  summary: string;
  formula: Record<'affirmative' | 'negative' | 'question', { pattern: string; example: string; vi: string }>;
  uses: { title: string; explain: string; examples: Example[] }[];
  signals: string[];
  mistakes: { wrong: string; right: string; explain: string }[];
  compare: { with: Tense; explain: string; examples: (Example & { tense: Tense })[] };
  drills: Drill[];
}

/** In the order they're taught. */
export const LESSONS: Lesson[] = [
  PRESENT_SIMPLE, PRESENT_CONTINUOUS, PRESENT_PERFECT, PAST_SIMPLE, PAST_CONTINUOUS, FUTURE_SIMPLE, GOING_TO
] as Lesson[];

export const LESSON_BY_ID = new Map(LESSONS.map((l) => [l.id, l]));
