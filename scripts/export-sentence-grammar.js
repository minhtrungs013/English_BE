/**
 * Exports the library's example sentences that have no stored grammar yet, for an AI to analyse
 * (see grammar-batch/PROMPT.md). Writes grammar-batch/input/batch-NN.jsonl, 100 sentences each:
 *   {"id":"L00001","text":"We will launch the new product in the spring."}
 * Then: give PROMPT.md + one batch to the AI, save its answer as grammar-batch/output/batch-NN.jsonl,
 * and run scripts/import-sentence-grammar.js.
 *
 *   npm run build && node scripts/export-sentence-grammar.js [--size 100]
 */
require('dotenv').config({ quiet: true });
const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');
const { sentenceKey } = require('../dist/courses/sentence-rules.js');

const DIR = path.join(__dirname, '..', 'grammar-batch');
const arg = (name, def) => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : def; };
const SIZE = Number(arg('--size', 100));

(async () => {
  await mongoose.connect(process.env.MONGODB_URI, { dbName: process.env.MONGODB_DB || 'English' });
  const db = mongoose.connection.db;
  const done = new Set((await db.collection('sentence_grammar').find({ 'parts.0': { $exists: true } }, { projection: { key: 1 } }).toArray()).map((d) => d.key));
  const lib = await db.collection('library').find({ ex: { $nin: ['', null] } }, { projection: { ex: 1 } }).sort({ _id: 1 }).toArray();
  const seen = new Set();
  const todo = [];
  for (const w of lib) {
    const text = w.ex.replace(/\s+/g, ' ').trim();
    const key = sentenceKey(text);
    if (!text || seen.has(key) || done.has(key)) continue;
    seen.add(key);
    todo.push(text);
  }
  fs.mkdirSync(path.join(DIR, 'input'), { recursive: true });
  fs.mkdirSync(path.join(DIR, 'output'), { recursive: true });
  for (const f of fs.readdirSync(path.join(DIR, 'input'))) fs.unlinkSync(path.join(DIR, 'input', f));
  const batches = Math.ceil(todo.length / SIZE);
  for (let b = 0; b < batches; b++) {
    const lines = todo.slice(b * SIZE, (b + 1) * SIZE).map((text, i) => JSON.stringify({ id: 'L' + String(b * SIZE + i + 1).padStart(5, '0'), text }));
    fs.writeFileSync(path.join(DIR, 'input', 'batch-' + String(b + 1).padStart(2, '0') + '.jsonl'), lines.join('\n') + '\n');
  }
  console.log('Library examples: ' + lib.length + ' · already analysed: ' + done.size + ' · to analyse: ' + todo.length + ' in ' + batches + ' batches of ' + SIZE + '.');
  console.log('Written to ' + path.join(DIR, 'input'));
  await mongoose.disconnect();
})().catch((e) => { console.error(e.message); process.exit(1); });
