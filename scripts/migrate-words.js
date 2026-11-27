/**
 * Turns learners' saved words (My Vocabulary, collection `words`) from full copies into links to the library
 * (src/words/words.service.ts): each word keeps its progress (status, review dates, tags, notes…), a `libraryId`
 * and only the details that differ from the library word (`overrides`). A word that isn't in the library is added to
 * it (when it has a meaning), so there is one place for every word; phrases (tag "phrase") and words with no meaning
 * keep all their details themselves. An old copy's empty field (no word family yet…) is taken from the library.
 *
 * Run it after the API with the new words.service.ts is deployed (an older API can't read the new form).
 * Needs `npm run build`.
 *
 *   node scripts/migrate-words.js            dry run: what would change, nothing is written
 *   node scripts/migrate-words.js --write
 */
require('dotenv').config({ quiet: true });
const mongoose = require('mongoose');
const { fullWord, wordRef } = require('../dist/courses/course-words');
const { COURSE_WORD_FIELDS } = require('../dist/courses/course.schema');

const WRITE = process.argv.includes('--write');
const LIB_FIELDS = Object.fromEntries(['word', 'wordLower', ...COURSE_WORD_FIELDS].map((k) => [k, 1]));
// An old full copy has the detail fields on the word itself (a link has only `libraryId` and `overrides`).
const isOld = (w) => w.overrides === undefined && COURSE_WORD_FIELDS.some((k) => w[k] !== undefined);
const UNSET = Object.fromEntries(COURSE_WORD_FIELDS.map((k) => [k, 1]));

(async () => {
  await mongoose.connect(process.env.MONGODB_URI, { dbName: process.env.MONGODB_DB || 'English' });
  const db = mongoose.connection.db;
  const words = await db.collection('words').find({}).toArray();
  const lower = [...new Set(words.map((w) => w.wordLower))];
  const libs = await db.collection('library').find({ wordLower: { $in: lower } }, { projection: LIB_FIELDS }).toArray();
  const byWord = new Map(libs.map((l) => [l.wordLower, l]));
  const users = new Map((await db.collection('users').find({}, { projection: { name: 1 } }).toArray()).map((u) => [String(u._id), u.name]));

  const total = { words: words.length, done: 0, linked: 0, ownChanges: 0, addedToLibrary: 0, keptOwn: 0 };
  const fields = {};
  const notes = [];
  const ops = [];
  for (const w of words) {
    if (!isOld(w)) { total.done++; continue; }
    const old = fullWord(w, undefined);
    let lib = byWord.get(w.wordLower);
    const phrase = (w.tags ?? []).includes('phrase');
    if (!lib && !phrase && (old.meaning.trim() || old.vi.trim())) {
      // Not in the library yet: it becomes a library word (shared under the learner's name).
      total.addedToLibrary++;
      notes.push('add to library: ' + w.word + ' — ' + old.vi);
      const doc = {
        word: w.word, wordLower: w.wordLower, ipa: old.ipa, pos: old.pos, meaning: old.meaning, vi: old.vi, ex: old.ex, syn: old.syn, ant: old.ant,
        level: old.level, family: old.family, topic: 'other', authorId: w.user, authorName: users.get(w.user) || 'A learner', saves: 1, sharedAt: new Date(), createdAt: new Date(), updatedAt: new Date()
      };
      if (WRITE) {
        const r = await db.collection('library').insertOne(doc);
        lib = { ...doc, _id: r.insertedId };
      } else lib = { ...doc, _id: new mongoose.Types.ObjectId() };
      byWord.set(w.wordLower, lib);
    }
    // What the learner sees now: the old copy, with empty fields from the library.
    const full = fullWord(w, lib);
    const ref = wordRef(full, lib);
    const diff = Object.keys(ref.overrides);
    if (!lib) { total.keptOwn++; notes.push('kept as own (' + (phrase ? 'phrase' : 'no meaning') + '): ' + w.word); }
    else if (diff.length) { total.ownChanges++; for (const k of diff) fields[k] = (fields[k] ?? 0) + 1; notes.push('own changes ' + diff.join(',') + ': ' + w.word + ' — mine "' + full.vi + '" / library "' + lib.vi + '"'); }
    else total.linked++;
    ops.push({ updateOne: { filter: { _id: w._id }, update: { $set: { libraryId: ref.libraryId, overrides: ref.overrides }, $unset: UNSET } } });
  }
  if (WRITE && ops.length) await db.collection('words').bulkWrite(ops, { ordered: false });
  console.log(total);
  if (Object.keys(fields).length) console.log('Fields kept as the learners\' own:', fields);
  for (const n of notes.slice(0, 40)) console.log('  ' + n);
  console.log(WRITE ? '\nWritten (' + ops.length + ' words).' : '\nDry run — nothing written. Add --write.');
  await mongoose.disconnect();
})().catch((e) => { console.error(e); process.exit(1); });
