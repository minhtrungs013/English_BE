/**
 * Turns the words of courses saved as full copies into links to the library (src/courses/course-words.ts):
 * each word keeps only what differs from its library word (`overrides`); a word that isn't in the library keeps
 * every detail in `overrides`. An old copy's empty field (no word family yet…) is taken from the library.
 *
 * My Vocabulary: learners saved course words as the course had them, so a later library edit (AI regenerate) skipped
 * them. A saved word's field that is still exactly what the course gave (or empty) gets what the course now shows
 * (the library's); fields learners changed themselves stay.
 *
 * Run it after the API with course-words.ts is deployed (an older API can't read the new form). Needs `npm run build`.
 *
 *   node scripts/migrate-course-words.js                      dry run: what would change, nothing is written
 *   node scripts/migrate-course-words.js --write              keep the courses' own differences as overrides
 *   node scripts/migrate-course-words.js --write --library    library words follow the library (differences dropped)
 *   … --course "TOEIC 600"                                    only courses whose title contains this
 */
require('dotenv').config({ quiet: true });
const mongoose = require('mongoose');
const { fullWord, wordRef } = require('../dist/courses/course-words');
const { cleanFamily } = require('../dist/common/family');
const { COURSE_WORD_FIELDS } = require('../dist/courses/course.schema');

const WRITE = process.argv.includes('--write');
const FOLLOW_LIBRARY = process.argv.includes('--library');
const ONLY = process.argv.includes('--course') ? process.argv[process.argv.indexOf('--course') + 1] ?? '' : '';
const LIB_FIELDS = Object.fromEntries(['word', 'wordLower', ...COURSE_WORD_FIELDS].map((k) => [k, 1]));
// An old full copy has the detail fields on the word itself (a link has at most `overrides`, left out when empty).
const isOld = (w) => COURSE_WORD_FIELDS.some((k) => w[k] !== undefined);

(async () => {
  await mongoose.connect(process.env.MONGODB_URI, { dbName: process.env.MONGODB_DB || 'English' });
  const db = mongoose.connection.db;
  const filter = ONLY ? { title: { $regex: ONLY.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), $options: 'i' } } : {};
  const courses = await db.collection('courses').find(filter, { projection: { title: 1, days: 1 } }).toArray();
  const all = courses.flatMap((c) => (c.days ?? []).flatMap((d) => d.words ?? []));
  const ids = [...new Set(all.map((w) => w.libraryId).filter((id) => /^[a-f0-9]{24}$/.test(id ?? '')))];
  const words = [...new Set(all.map((w) => w.word.toLowerCase()))];
  const libs = await db.collection('library').find({ $or: [{ _id: { $in: ids.map((id) => new mongoose.Types.ObjectId(id)) } }, { wordLower: { $in: words } }] }, { projection: LIB_FIELDS }).toArray();
  const byId = new Map(libs.map((l) => [String(l._id), l]));
  const byWord = new Map(libs.map((l) => [l.wordLower, l]));

  const total = { courses: 0, words: 0, done: 0, linked: 0, changed: 0, own: 0, newLink: 0 };
  const fields = Object.fromEntries(COURSE_WORD_FIELDS.map((k) => [k, 0]));
  const examples = [];
  /** wordLower → field → { from: values the courses gave, to: the library value the courses show now }. */
  const vocab = new Map();
  const norm = (k, v) => JSON.stringify(k === 'family' ? cleanFamily(v) : Array.isArray(v) ? v : String(v ?? '').trim());
  const empty = (v) => v == null || (typeof v === 'string' && !v.trim()) || (Array.isArray(v) && !v.length);
  for (const c of courses) {
    let touched = false;
    const st = { words: 0, linked: 0, changed: 0, own: 0 };
    const days = (c.days ?? []).map((d) => ({
      ...d,
      words: (d.words ?? []).map((w) => {
        total.words++; st.words++;
        if (!isOld(w)) { total.done++; return w; }
        touched = true;
        const before = w.libraryId ? byId.get(w.libraryId) : undefined;
        const full = fullWord(w, before);
        const lib = before ?? byWord.get(w.word.toLowerCase());
        if (lib && !before) total.newLink++;
        let ref = wordRef(full, lib);
        const diff = Object.keys(ref.overrides);
        if (lib && FOLLOW_LIBRARY && (w.source === 'library' || before)) ref = { ...ref, overrides: {} };
        // Fields where what learners saved (the old copy) and what the course shows now (the library's) differ.
        if (lib) for (const k of COURSE_WORD_FIELDS) {
          if (ref.overrides?.[k] !== undefined || w[k] === undefined || norm(k, w[k]) === norm(k, lib[k]) || empty(lib[k])) continue;
          const key = w.word.toLowerCase();
          const f = vocab.get(key) ?? {};
          f[k] = f[k] ?? { from: new Set(), to: lib[k] };
          f[k].from.add(norm(k, w[k]));
          vocab.set(key, f);
        }
        if (!lib) { total.own++; st.own++; }
        else if (diff.length) {
          total.changed++; st.changed++;
          for (const k of diff) fields[k]++;
          if (examples.length < 12) examples.push({ course: c.title, word: w.word, fields: diff, course_vi: full.vi, library_vi: lib.vi });
        } else { total.linked++; st.linked++; }
        return ref;
      })
    }));
    if (!touched) continue;
    total.courses++;
    console.log(`${c.title}: ${st.words} words — ${st.linked} link only, ${st.changed} link + own changes, ${st.own} only in this course`);
    if (WRITE) await db.collection('courses').updateOne({ _id: c._id }, { $set: { days } });
  }
  // My Vocabulary: saved copies still as the course gave them (or empty) follow what the course shows now.
  const saved = vocab.size ? await db.collection('words').find({ wordLower: { $in: [...vocab.keys()] } }, { projection: { wordLower: 1, ...Object.fromEntries(COURSE_WORD_FIELDS.map((k) => [k, 1])) } }).toArray() : [];
  const ops = [];
  const vocabFields = {};
  const vocabExamples = [];
  for (const uw of saved) {
    const set = {};
    for (const [k, f] of Object.entries(vocab.get(uw.wordLower) ?? {})) {
      if (empty(uw[k]) || f.from.has(norm(k, uw[k]))) { set[k] = f.to; vocabFields[k] = (vocabFields[k] ?? 0) + 1; }
    }
    if (!Object.keys(set).length) continue;
    ops.push({ updateOne: { filter: { _id: uw._id }, update: { $set: set } } });
    if (vocabExamples.length < 8 && set.vi) vocabExamples.push({ word: uw.wordLower, from: uw.vi, to: set.vi });
  }
  if (WRITE && ops.length) await db.collection('words').bulkWrite(ops, { ordered: false });
  console.log('\nMy Vocabulary: ' + ops.length + ' saved words ' + (WRITE ? 'updated' : 'would be updated') + ' (of ' + saved.length + ' saved copies of these words)', vocabFields);
  for (const e of vocabExamples) console.log('  ', JSON.stringify(e));

  console.log('\nTotal', total);
  console.log(FOLLOW_LIBRARY ? 'Fields that differed (dropped, the library\'s are used):' : 'Fields kept as the course\'s own (differ from the library):', Object.fromEntries(Object.entries(fields).filter(([, n]) => n)));
  if (examples.length) { console.log('\nExamples of words that differ:'); for (const e of examples) console.log(' ', JSON.stringify(e)); }
  console.log(WRITE ? '\nWritten.' : '\nDry run — nothing written. Add --write (and --library to drop the differences).');
  await mongoose.disconnect();
})().catch((e) => { console.error(e); process.exit(1); });
