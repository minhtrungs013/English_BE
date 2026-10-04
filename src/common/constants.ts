export const LEVELS = ['A1', 'A2', 'B1', 'B2', 'C1', 'C2'] as const;
export type Level = (typeof LEVELS)[number];

export const STATUSES = ['new', 'learning', 'mastered'] as const;
export type Status = (typeof STATUSES)[number];

export const RATINGS = ['Again', 'Hard', 'Good', 'Easy'] as const;
export type Rating = (typeof RATINGS)[number];

export const POS_LIST = ['Noun', 'Verb', 'Adjective', 'Adverb', 'Pronoun', 'Preposition', 'Conjunction', 'Other'] as const;

export const CATEGORY_ICONS = ['briefcase', 'laptop', 'chat', 'globe', 'plane', 'heart', 'cap', 'coffee', 'book', 'music'] as const;

export const THEMES = ['light', 'dark', 'system'] as const;
export const DIRECTIONS = ['en-vi', 'vi-en'] as const;
export const GOALS = ['10', '20', '30', '50'] as const;
export const ACCENTS = ['indigo', 'blue', 'teal', 'green', 'orange', 'rose'] as const;

export const MIN = 60_000;
export const DAY = 86_400_000;

/** YYYY-MM-DD, as sent by the client in its own time zone. */
export const DAY_KEY = /^\d{4}-\d{2}-\d{2}$/;

export function dayKey(d: Date): string {
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}

/** The day before a YYYY-MM-DD key. */
export function previousDay(key: string): string {
  const [y, m, d] = key.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d - 1));
  return dt.getUTCFullYear() + '-' + String(dt.getUTCMonth() + 1).padStart(2, '0') + '-' + String(dt.getUTCDate()).padStart(2, '0');
}
