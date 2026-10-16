/**
 * Exports the library words for an AI (e.g. Muse) to write new example sentences for the word sentence bank.
 * Writes sentence-bank/input/batch-NN.jsonl (100 words each):
 *   {"id":"<library id>","word":"deadline","pos":"Noun","level":"B1","topic":"it","vi":"hạn chót","meaning":"…","ex":"…","have":2}
 * `ex` is the word's current example sentence (the new ones must differ); `have` = sentences already in the bank.
 * Give the AI sentence-bank/PROMPT.md + one batch, save its answer as sentence-bank/output/batch-NN.jsonl,
 * then run scripts/check-word-sentences.js.
 *
 *   node scripts/export-word-sentences.js [--size 100] [--max 4]   (--max: skip words that already have this many)
 */
require('dotenv').config({ quiet: true });
const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');

const DIR = path.join(__dirname, '..', 'sentence-bank');
const arg = (name, def) => { const i = process.argv.indexOf(name); return i > 0 ? Number(process.argv[i + 1]) : def; };
const SIZE = arg('--size', 100);
const MAX = arg('--max', 4);

(async () => {
  await mongoose.connect(process.env.MONGODB_URI, { dbName: process.env.MONGODB_DB || 'English' });
  const db = mongoose.connection.db;
  const counts = new Map((await db.collection('word_sentences').aggregate([{ $group: { _id: '$wordId', n: { $sum: 1 } } }]).toArray()).map((x) => [String(x._id), x.n]));
  const words = (await db.collection('library').find({}, { projection: { word: 1, pos: 1, level: 1, topic: 1, vi: 1, meaning: 1, ex: 1 } }).sort({ _id: 1 }).toArray())
    .filter((w) => (counts.get(String(w._id)) ?? 0) < MAX);
  fs.mkdirSync(path.join(DIR, 'input'), { recursive: true });
  fs.mkdirSync(path.join(DIR, 'output'), { recursive: true });
  for (const f of fs.readdirSync(path.join(DIR, 'input'))) fs.unlinkSync(path.join(DIR, 'input', f));
  const batches = Math.ceil(words.length / SIZE);
  for (let b = 0; b < batches; b++) {
    const lines = words.slice(b * SIZE, (b + 1) * SIZE).map((w) => JSON.stringify({
      id: String(w._id), word: w.word, pos: w.pos, level: w.level, topic: w.topic, vi: w.vi, meaning: w.meaning, ex: w.ex ?? '', have: counts.get(String(w._id)) ?? 0
    }));
    fs.writeFileSync(path.join(DIR, 'input', 'batch-' + String(b + 1).padStart(2, '0') + '.jsonl'), lines.join('\n') + '\n');
  }
  console.log(words.length + ' words to write sentences for, in ' + batches + ' batches of ' + SIZE + ' → ' + path.relative(process.cwd(), path.join(DIR, 'input')));
  await mongoose.disconnect();
})().catch((e) => { console.error(e.message); process.exit(1); });
