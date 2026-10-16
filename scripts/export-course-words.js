/**
 * Writes each course's words for an AI (e.g. Muse) to write tense questions for:
 *   question-batch/<course-slug>/words.csv   day, word, pos, vi, meaning, has (tenses that already have a question)
 *   question-batch/<course-slug>/course.json the course id (used by check-questions.js)
 * Give the AI question-batch/PROMPT.md + one words.csv; save its answer as question-batch/<course-slug>/questions.csv.
 *
 *   node scripts/export-course-words.js            (every course with words)
 *   node scripts/export-course-words.js "Part 2"   (courses whose title contains this)
 */
require('dotenv').config({ quiet: true });
const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');

const DIR = path.join(__dirname, '..', 'question-batch');
const cell = (v) => { const s = String(v ?? ''); return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
const slug = (s) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

(async () => {
  await mongoose.connect(process.env.MONGODB_URI, { dbName: process.env.MONGODB_DB || 'English' });
  const db = mongoose.connection.db;
  const filter = process.argv[2] ? { title: { $regex: process.argv[2].replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), $options: 'i' } } : {};
  for (const c of await db.collection('courses').find(filter).toArray()) {
    const days = (c.days ?? []).filter((d) => d.words?.length).sort((a, b) => a.day - b.day);
    if (!days.length) continue;
    const bank = await db.collection('course_questions').find({ courseId: String(c._id), kind: { $in: ['tense', 'tenseChoice'] }, status: { $ne: 'rejected' } }, { projection: { word: 1, tense: 1 } }).toArray();
    const has = new Map();
    for (const b of bank) { const k = b.word.toLowerCase(); has.set(k, [...new Set([...(has.get(k) ?? []), b.tense])]); }
    const rows = [['day', 'word', 'pos', 'vi', 'meaning', 'has']];
    for (const d of days) for (const w of d.words) rows.push([d.day, w.word, w.pos, w.vi, w.meaning, (has.get(w.word.toLowerCase()) ?? []).join('|')]);
    const out = path.join(DIR, slug(c.title));
    fs.mkdirSync(out, { recursive: true });
    fs.writeFileSync(path.join(out, 'words.csv'), '﻿' + rows.map((r) => r.map(cell).join(',')).join('\r\n') + '\r\n');
    fs.writeFileSync(path.join(out, 'course.json'), JSON.stringify({ id: String(c._id), title: c.title }, null, 2) + '\n');
    console.log(c.title + ': ' + (rows.length - 1) + ' words, ' + bank.length + ' tense questions now → ' + path.relative(process.cwd(), out));
  }
  await mongoose.disconnect();
})().catch((e) => { console.error(e.message); process.exit(1); });
