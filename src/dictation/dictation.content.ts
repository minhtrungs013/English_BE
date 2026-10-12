/**
 * Dictation sets (written in content/<id>.json): English sentences to hear and type, with a Vietnamese translation.
 * Three groups: "basics" (numbers, dates, names…), "sentences" (everyday work sentences) and "passages" (3–5 sentence
 * texts). Item ids are "<set>:<index>" — the files are append-only: never reorder or delete items, add new ones at the end.
 */
import DATES_TIMES from './content/dates-times.json';
import EMAILS_MESSAGES from './content/emails-messages.json';
import MEETINGS_CALLS from './content/meetings-calls.json';
import NAMES_EMAILS from './content/names-emails.json';
import NUMBERS_PRICES from './content/numbers-prices.json';
import OFFICE_BASICS from './content/office-basics.json';
import PASSAGES from './content/passages.json';
import SMALL_WORDS from './content/small-words.json';

export type DictationGroup = 'basics' | 'sentences' | 'passages';
export type DictationLevel = 'easy' | 'medium' | 'hard';
export interface LineItem {
  kind: 'line';
  level: DictationLevel;
  text: string;
  vi: string;
  /** A short English label of what to listen for ("-ed ending", "price"). */
  focus?: string;
}
export interface PassageItem {
  kind: 'passage';
  level: DictationLevel;
  title: string;
  sentences: { text: string; vi: string }[];
}
export type DictationItem = LineItem | PassageItem;
export interface DictationSet {
  id: string;
  group: DictationGroup;
  name: string;
  vi: string;
  summary: string;
  tips: string[];
  items: DictationItem[];
}

/** In the order they're shown. */
export const SETS: DictationSet[] = [
  NUMBERS_PRICES, DATES_TIMES, NAMES_EMAILS, SMALL_WORDS, OFFICE_BASICS, MEETINGS_CALLS, EMAILS_MESSAGES, PASSAGES
] as DictationSet[];

export const SET_BY_ID = new Map(SETS.map((s) => [s.id, s]));
