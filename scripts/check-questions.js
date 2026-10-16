/**
 * Checks tense questions written by an AI (question-batch/<course>/questions.csv, see question-batch/PROMPT.md)
 * and imports the good ones into the course's question bank, with their sentence grammar.
 *
 *   npm run build
 *   node scripts/check-questions.js question-batch/<course>/questions.csv            check only → report.txt next to it
 *   node scripts/check-questions.js question-batch/<course>/questions.csv --import   import rows without errors (approved)
 *   … --import --pending   import them as "pending", to approve in the app's question review
 *
 * Errors (row skipped): wrong day/word, unknown tense, not exactly one ___, typed without "(verb)", multi without
 * 4 different choices including the answer, sentence already in the bank or twice in the file.
 * Warnings (row kept, worth a look): the pattern rules read another tense, a modal/passive answer, the word missing
 * from the sentence, structure not matching (grammar then has no parts), explain not Vietnamese, too many per word.
 */
require('dotenv').config({ quiet: true });
const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');
const { checkParts, ruleTense, sentenceKey, ROLES } = require('../dist/courses/sentence-rules.js');
const { TENSES } = require('../dist/courses/tense.js');

/** RFC 4180 CSV (quotes, doubled quotes, CRLF), first row = header. */
function parseCsv(text) {
  const rows = [];
  let row = [], cell = '', q = false;
  text = text.replace(/^﻿/, '').replace(/^```[a-z]*\s*\n|\n```\s*$/g, '');
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) {
      if (ch === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (ch === '"') q = false;
      else cell += ch;
    } else if (ch === '"') q = true;
    else if (ch === ',') { row.push(cell); cell = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(cell); cell = '';
      if (row.some((c) => c.trim())) rows.push(row);
      row = [];
    } else cell += ch;
  }
  row.push(cell);
  if (row.some((c) => c.trim())) rows.push(row);
  const head = rows.shift().map((h) => h.trim().toLowerCase());
  return rows.map((r) => Object.fromEntries(head.map((h, i) => [h, (r[i] ?? '').trim()])));
}

const BLANK = /_{3,}/g;
const MODAL = /\b(can|could|should|must|may|might|would|shall)\b/i;
const PASSIVE = /\b(am|is|are|was|were|be|been|being)\s+(\w+ed|built|done|made|sent|given|taken|held|kept|known|paid|shown|sold|told|written|seen|found|brought|bought)\b/i;
const VI = /[ăâđêôơưáàảãạấầẩẫậắằẳẵặéèẻẽẹếềểễệíìỉĩịóòỏõọốồổỗộớờởỡợúùủũụứừửữựýỳỷỹỵ]/i;

/** "S:We | V:have missed | O:the deadline" → parts, or null. */
function parseStructure(s) {
  if (!s) return null;
  const parts = s.split(/\s*\|\s*/).map((x) => { const i = x.indexOf(':'); return i > 0 ? { role: x.slice(0, i).trim(), text: x.slice(i + 1).trim() } : null; });
  return parts.every((p) => p && ROLES.includes(p.role) && p.text) ? parts : null;
}

(async () => {
  const file = path.resolve(process.argv[2] ?? '');
  if (!fs.existsSync(file)) { console.error('Usage: node scripts/check-questions.js question-batch/<course>/questions.csv [--import] [--pending]'); process.exit(1); }
  const doImport = process.argv.includes('--import');
  const status = process.argv.includes('--pending') ? 'pending' : 'approved';
  const { id: courseId, title } = JSON.parse(fs.readFileSync(path.join(path.dirname(file), 'course.json'), 'utf8'));

  await mongoose.connect(process.env.MONGODB_URI, { dbName: process.env.MONGODB_DB || 'English' });
  const db = mongoose.connection.db;
  const course = await db.collection('courses').findOne({ _id: new mongoose.Types.ObjectId(courseId) });
  if (!course) throw new Error('Course ' + courseId + ' not found.');
  const dayWords = new Map((course.days ?? []).map((d) => [d.day, new Map((d.words ?? []).map((w) => [w.word.toLowerCase(), w]))]));
  const bank = await db.collection('course_questions').find({ courseId, kind: { $in: ['tense', 'tenseChoice'] } }, { projection: { prompt: 1, answer: 1, word: 1 } }).toArray();
  const fill = (sentence, answer) => sentence.replace(/_{3,}(\s*\([^)]*\))?/, answer).replace(/\s+/g, ' ').trim();
  const known = new Set(bank.map((b) => sentenceKey(fill(b.prompt, b.answer))));
  const perWord = new Map();
  for (const b of bank) perWord.set(b.word.toLowerCase(), (perWord.get(b.word.toLowerCase()) ?? 0) + 1);

  const rows = parseCsv(fs.readFileSync(file, 'utf8'));
  const good = [];
  const report = [];
  let errors = 0, warnings = 0;
  rows.forEach((r, i) => {
    const n = 'row ' + (i + 2);
    const err = [], warn = [];
    const day = Number(r.day);
    const w = dayWords.get(day)?.get((r.word ?? '').toLowerCase());
    if (!dayWords.has(day)) err.push('day ' + r.day + ' is not a day of this course');
    else if (!w) err.push('"' + r.word + '" is not a word of day ' + day);
    const type = (r.type ?? '').toLowerCase();
    const kind = ['typed', 'tense', 'type'].includes(type) ? 'tense' : ['multi', 'choice', 'mc', 'tensechoice'].includes(type) ? 'tenseChoice' : '';
    if (!kind) err.push('type must be typed or multi');
    if (!TENSES.includes(r.tense)) err.push('unknown tense "' + r.tense + '"');
    const sentence = (r.sentence ?? '').replace(/\s+/g, ' ').trim();
    const answer = (r.answer ?? '').trim();
    if ((sentence.match(BLANK) ?? []).length !== 1) err.push('sentence must have exactly one ___');
    if (!answer) err.push('answer is empty');
    if (kind === 'tense' && !/_{3,}\s*\([^)]+\)/.test(sentence)) err.push('typed: put the base verb in brackets after ___');
    const choices = [r.choice1, r.choice2, r.choice3, r.choice4].map((c) => (c ?? '').trim()).filter(Boolean);
    if (kind === 'tenseChoice') {
      if (choices.length !== 4 || new Set(choices.map((c) => c.toLowerCase())).size !== 4) err.push('multi: needs 4 different choices');
      else if (!choices.includes(answer)) err.push('multi: the answer is not one of the choices');
    }
    const full = sentence && answer ? fill(sentence, answer) : '';
    const key = sentenceKey(full);
    if (full && known.has(key)) err.push('this sentence is already in the bank (or earlier in the file)');

    if (!err.length) {
      const rule = ruleTense(full);
      if (rule && rule !== r.tense) warn.push('pattern reads ' + rule + ', not ' + r.tense);
      if (MODAL.test(answer) || PASSIVE.test(answer)) warn.push('answer looks modal/passive: "' + answer + '"');
      const stem = w.word.toLowerCase().split(/\s+/)[0].slice(0, Math.max(3, w.word.length - 3));
      if (!full.toLowerCase().includes(stem)) warn.push('the word "' + w.word + '" is not in the sentence');
      if (r.explain && !VI.test(r.explain)) warn.push('explain is not Vietnamese');
      if (!r.explain) warn.push('explain is empty');
      if ((r.explain ?? '').length > 200) warn.push('explain is long');
    }
    const parts = !err.length ? checkParts(full, parseStructure(r.structure)) : null;
    if (!err.length && r.structure && !parts) warn.push('structure does not spell out the full sentence (saved without parts)');
    if (!err.length && !r.structure) warn.push('no structure');
    const k = (r.word ?? '').toLowerCase();
    if (!err.length && (perWord.get(k) ?? 0) >= 6) warn.push('"' + r.word + '" already has ' + perWord.get(k) + ' questions');

    if (err.length) { errors++; report.push(n + ' ✗ ' + err.join('; ') + '  | ' + (r.sentence ?? '')); return; }
    if (warn.length) { warnings++; report.push(n + ' ! ' + warn.join('; ') + '  | ' + full); }
    known.add(key);
    perWord.set(k, (perWord.get(k) ?? 0) + 1);
    good.push({
      bank: { courseId, day, kind, word: w.word, tense: r.tense, prompt: sentence, choices: kind === 'tenseChoice' ? choices : [], answer,
        accept: (r.accept ?? '').split('|').map((x) => x.trim()).filter(Boolean).slice(0, 5), explain: (r.explain ?? '').slice(0, 1500), source: 'manual', status },
      grammar: { text: full, tense: r.tense, parts: parts ?? [], explain: (r.explain ?? '').slice(0, 400) }
    });
  });

  const summary = title + ': ' + rows.length + ' rows · ' + good.length + ' good (' + warnings + ' with warnings) · ' + errors + ' with errors';
  fs.writeFileSync(path.join(path.dirname(file), 'report.txt'), summary + '\n\n' + report.join('\n') + '\n');
  console.log(summary + '. Details: ' + path.relative(process.cwd(), path.join(path.dirname(file), 'report.txt')));

  if (doImport && good.length) {
    const now = new Date();
    await db.collection('course_questions').insertMany(good.map((g) => ({ ...g.bank, createdAt: now, updatedAt: now })));
    const ops = good.filter((g) => g.grammar.parts.length).map((g) => ({
      updateOne: {
        filter: { key: sentenceKey(g.grammar.text), checked: { $ne: true } },
        update: { $set: { text: g.grammar.text, tense: g.grammar.tense, label: '', parts: g.grammar.parts, explain: g.grammar.explain, notes: [], source: 'ai', updatedAt: now }, $setOnInsert: { checked: false, createdAt: now } },
        upsert: true
      }
    }));
    if (ops.length) await db.collection('sentence_grammar').bulkWrite(ops, { ordered: false });
    console.log('Imported ' + good.length + ' questions (' + status + '), ' + ops.length + ' with sentence grammar.');
  }
  await mongoose.disconnect();
})().catch((e) => { console.error(e.message); process.exit(1); });
