/**
 * Listening dialogues: a short two-person workplace conversation for a course day. Blanks are written
 * in the line text as [[surface]] or [[surface|base]] (e.g. "three [[items|item]]"): learners hear the line
 * and fill the gap from a word bank of the base words (or type it). Comprehension questions are TOEIC-style
 * multiple choice.
 */
import { BadRequestException } from '@nestjs/common';

export interface DialogueSpeaker { name: string; gender: 'female' | 'male' }
export interface DialogueLine { s: 0 | 1; text: string; vi: string }
export interface DialogueQuestion { question: string; choices: string[]; answer: string; explain: string }
export interface Dialogue {
  title: string;
  scenario: string;
  speakers: DialogueSpeaker[];
  lines: DialogueLine[];
  questions: DialogueQuestion[];
}

export const BLANK_RE = /\[\[([^\]|]+?)(?:\|([^\]]+?))?\]\]/g;

const str = (v: unknown, max: number): string => (typeof v === 'string' ? v.trim().slice(0, max) : typeof v === 'number' ? String(v) : '');

/** The blanks of a dialogue in order: what's said (surface) and the word-bank word (base). */
export function dialogueBlanks(d: Pick<Dialogue, 'lines'>): { surface: string; base: string }[] {
  return d.lines.flatMap((l) => [...l.text.matchAll(BLANK_RE)].map((m) => ({ surface: m[1].trim(), base: (m[2] ?? m[1]).trim() })));
}

/** Checks and cleans a dialogue from the owner, an import or AI; throws a 400 with the first problem. */
export function cleanDialogue(raw: unknown): Dialogue {
  const o = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const bad = (m: string) => { throw new BadRequestException(m); };
  const title = str(o.title, 120) || bad('The dialogue needs a title.');
  const speakersRaw = Array.isArray(o.speakers) ? o.speakers : [];
  if (speakersRaw.length !== 2) bad('A dialogue has exactly 2 speakers.');
  const speakers = speakersRaw.map((s, i) => {
    const x = (s && typeof s === 'object' ? s : {}) as Record<string, unknown>;
    return { name: str(x.name, 40) || (i ? 'B' : 'A'), gender: x.gender === 'male' ? 'male' : 'female' } as DialogueSpeaker;
  });
  if (speakers[0].name.toLowerCase() === speakers[1].name.toLowerCase()) bad('The two speakers need different names.');
  const linesRaw = Array.isArray(o.lines) ? o.lines : [];
  if (linesRaw.length < 4 || linesRaw.length > 16) bad('A dialogue has 4–16 lines.');
  const lines = linesRaw.map((l, i) => {
    const x = (l && typeof l === 'object' ? l : {}) as Record<string, unknown>;
    const who = typeof x.s === 'number' ? x.s : typeof x.speaker === 'number' ? x.speaker
      : speakers.findIndex((s) => s.name.toLowerCase() === str(x.speaker, 40).toLowerCase());
    if (who !== 0 && who !== 1) bad('Line ' + (i + 1) + ': speaker must be 0, 1 or one of the speaker names.');
    const text = str(x.text, 400) || bad('Line ' + (i + 1) + ' is empty.');
    if ((text.match(/\[\[/g) ?? []).length !== (text.match(BLANK_RE) ?? []).length) bad('Line ' + (i + 1) + ': write blanks as [[word]] or [[said form|word]].');
    return { s: who as 0 | 1, text, vi: str(x.vi, 600) };
  });
  const blanks = dialogueBlanks({ lines });
  if (blanks.length < 2 || blanks.length > 10) bad('A dialogue needs 2–10 blanks, written as [[word]].');
  if (blanks.some((b) => !b.surface || !b.base)) bad('A blank is empty.');
  const qRaw = Array.isArray(o.questions) ? o.questions : [];
  if (qRaw.length > 5) bad('At most 5 questions.');
  const questions = qRaw.map((q, i) => {
    const x = (q && typeof q === 'object' ? q : {}) as Record<string, unknown>;
    const question = str(x.question, 300) || bad('Question ' + (i + 1) + ' is empty.');
    const choices = Array.isArray(x.choices) ? x.choices.map((c) => str(c, 200)).filter(Boolean) : [];
    const answer = str(x.answer, 200);
    if (new Set(choices.map((c) => c.toLowerCase())).size !== 4 || !choices.includes(answer)) bad('Question ' + (i + 1) + ' needs 4 different choices, one of them the answer.');
    return { question, choices, answer, explain: str(x.explain, 400) };
  });
  return { title, scenario: str(o.scenario, 300), speakers, lines, questions };
}

export const DIALOGUE_SYSTEM = `You write short listening dialogues for Vietnamese office workers studying TOEIC / workplace English.
Write ONE natural two-person conversation (8–12 lines, B1 level, realistic workplace or customer-service situation) that uses ALL the given words.
Mark each use of a given word as a blank: [[word]] when it appears exactly as given, or [[said form|word]] when inflected (e.g. [[items|item]], [[deployed|deploy]]). Each given word is a blank exactly once; no other blanks.
Never repeat a blanked word in the very next line (it would give the answer away).
Return ONLY JSON: {"title": short English title, "scenario": one Vietnamese sentence describing the situation,
"speakers": [{"name": role or first name, "gender": "female"|"male"}, {...}] (one female, one male),
"lines": [{"s": 0 or 1, "text": English line with blanks, "vi": natural Vietnamese translation (without brackets)}],
"questions": 2–3 TOEIC Part 3 style questions: [{"question", "choices": 4 different options, "answer": one of the choices exactly, "explain": one short Vietnamese sentence}]}.`;

/** Asks OpenAI for a dialogue; null when the call fails or the result doesn't pass the checks. */
export async function aiDialogue(words: string[], apiKey: string, model: string): Promise<Dialogue | null> {
  let res: Response;
  try {
    res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + apiKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, temperature: 0.6, response_format: { type: 'json_object' }, messages: [{ role: 'system', content: DIALOGUE_SYSTEM }, { role: 'user', content: 'WORDS: ' + words.join(' | ') }] }),
      signal: AbortSignal.timeout(45000)
    });
  } catch {
    return null;
  }
  if (!res.ok) {
    console.warn('[Courses] OpenAI dialogue request failed with status ' + res.status);
    return null;
  }
  try {
    const body = (await res.json()) as { choices?: { message?: { content?: string } }[] };
    return cleanDialogue(JSON.parse(body.choices?.[0]?.message?.content ?? '{}'));
  } catch {
    return null;
  }
}
