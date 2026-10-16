/**
 * Checks the example sentences an AI wrote for the word sentence bank (sentence-bank/output/*.jsonl, see
 * sentence-bank/PROMPT.md) and imports the good ones into `word_sentences`, with their grammar in `sentence_grammar`.
 *
 *   npm run build
 *   node scripts/check-word-sentences.js sentence-bank/output/batch-05.jsonl   check one file (no database)
 *   node scripts/check-word-sentences.js --dry      check every output file → sentence-bank/report.txt
 *   node scripts/check-word-sentences.js --import   import every good sentence (re-running skips the ones already in)
 *
 * Errors (line skipped): bad JSON, unknown word id, `form` or `verb` not in the sentence, unknown tense / no label,
 * too short or long, same as the word's example or another sentence.
 * Warnings (kept): parts that don't spell out the sentence (saved without parts), explain not Vietnamese,
 * not 4 sentences / fewer than 3 tenses for a word, no base verb.
 */
require('dotenv').config({ quiet: true });
const fs = require('fs');
const path = require('path');
const { checkParts, sentenceKey } = require('../dist/courses/sentence-rules.js');
const { TENSES, IRREGULAR } = require('../dist/courses/tense.js');
const { splitContractions, modalFix } = require('./grammar-fixes.js');

const DIR = path.join(__dirname, '..', 'sentence-bank');
const CONTEXTS = ['meeting', 'email', 'interview', 'chat', 'phone', 'report', 'presentation', 'customer', 'other'];
const VI = /[ăâđêôơưáàảãạấầẩẫậắằẳẵặéèẻẽẹếềểễệíìỉĩịóòỏõọốồổỗộớờởỡợúùủũụứừửữựýỳỷỹỵ]/i;
const PER_WORD = 4;

/** All input words by id. */
function inputs() {
  const m = new Map();
  for (const f of fs.readdirSync(path.join(DIR, 'input')).filter((x) => x.endsWith('.jsonl'))) {
    for (const line of fs.readFileSync(path.join(DIR, 'input', f), 'utf8').split('\n')) if (line.trim()) { const o = JSON.parse(line); m.set(o.id, { ...o, batch: f }); }
  }
  return m;
}

const has = (sentence, piece) => new RegExp((/^['’]/.test(piece) ? '()' : '(^|[^A-Za-z])') + piece.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '($|[^A-Za-z])', 'i').test(sentence.replace(/’/g, "'"));

/** Forms of a word or phrase (its first word inflected): -s/-es/-ies, -ed/-d/-ied, -ing, doubled consonant, irregular, -er/-est. */
function inflections(form) {
  const [w, ...rest] = form.split(/\s+/);
  const v = w.toLowerCase();
  const tail = rest.length ? ' ' + rest.join(' ') : '';
  const c = v.slice(-1);
  const out = [v + 's', v + 'es', v + 'ed', v + 'd', v + 'ing', v + c + 'ed', v + c + 'ing', v + c + 'er', v + 'er', v + 'r', v + 'est', v + 'st'];
  if (v.endsWith('e')) out.push(v.slice(0, -1) + 'ing');
  if (v.endsWith('ie')) out.push(v.slice(0, -2) + 'ying');
  if (/[^aeiou]y$/.test(v)) out.push(v.slice(0, -1) + 'ies', v.slice(0, -1) + 'ied', v.slice(0, -1) + 'ier');
  if (IRREGULAR[v]) out.push(...IRREGULAR[v]);
  return out.map((x) => x + tail);
}

/** Checks one output file against the input words; `seen` collects sentence keys across files. */
function checkFile(file, words, seen) {
  const ok = [], problems = [], warnings = [];
  const byWord = new Map();
  const raw = fs.readFileSync(file, 'utf8').replace(/^﻿/, '').replace(/```[a-z]*\n?/g, '');
  raw.split('\n').forEach((line, n) => {
    if (!line.trim()) return;
    let o;
    try { o = JSON.parse(line); } catch { problems.push('line ' + (n + 1) + ': not valid JSON'); return; }
    const w = words.get(o.id);
    const at = (o.word ?? o.id) + ' (line ' + (n + 1) + ')';
    if (!w) { problems.push(at + ': unknown id'); return; }
    const sentence = typeof o.sentence === 'string' ? o.sentence.replace(/\s+/g, ' ').trim() : '';
    let form = typeof o.form === 'string' ? o.form.trim() : '';
    // The AI often writes the base form ("validate") while the sentence inflects it ("validates", "graduated"):
    // take the inflected form found in the sentence instead.
    if (sentence && form && !has(sentence, form)) {
      const found = inflections(form).find((f) => has(sentence, f));
      if (found) { warnings.push(at + ': form "' + form + '" → "' + found + '"'); form = found; }
    }
    const verb = typeof o.verb === 'string' ? o.verb.trim() : '';
    let tense = typeof o.tense === 'string' ? o.tense : '';
    let label = typeof o.label === 'string' ? o.label.trim() : '';
    const n2 = sentence.split(' ').length;
    const err = [];
    if (!sentence) err.push('no sentence');
    else {
      if (n2 < 5 || n2 > 26) err.push(n2 + ' words');
      if (!form || !has(sentence, form)) err.push('form "' + form + '" is not in the sentence');
      if (!verb || !has(sentence, verb)) err.push('verb "' + verb + '" is not in the sentence');
      if (tense && !TENSES.includes(tense)) err.push('unknown tense "' + tense + '"');
      if (!tense && !label) err.push('tense "" without a label');
      const key = sentenceKey(sentence);
      if (w.ex && key === sentenceKey(w.ex)) err.push('same as the word\'s example');
      else if (seen.has(key)) err.push('duplicate sentence');
    }
    if (err.length) { problems.push(at + ': ' + err.join('; ') + ' | ' + sentence); return; }
    seen.add(sentenceKey(sentence));
    let parts = checkParts(sentence, o.parts);
    if (!parts) warnings.push(at + ': parts do not spell out the sentence (saved without parts)');
    else parts = checkParts(sentence, splitContractions(parts)) ?? parts;
    const fix = parts ? modalFix(tense, parts, sentence) : null;
    if (fix) { warnings.push(at + ': ' + tense + ' → "' + fix.label + '"'); tense = ''; label = fix.label; }
    const explain = typeof o.explain === 'string' ? o.explain.trim().slice(0, 300) : '';
    if (!VI.test(explain)) warnings.push(at + ': explain is not Vietnamese');
    if (tense && !o.base) warnings.push(at + ': no base verb');
    const item = {
      wordId: w.id, word: w.word, form, sentence, context: CONTEXTS.includes(o.context) ? o.context : 'other', level: w.level ?? '', topic: w.topic ?? '',
      tense, label: tense ? '' : label.slice(0, 60), verb, base: typeof o.base === 'string' ? o.base.trim().toLowerCase() : '', parts: parts ?? [], explain
    };
    ok.push(item);
    byWord.set(w.id, [...(byWord.get(w.id) ?? []), item]);
  });
  const batch = path.basename(file).replace(/-sentences(?=.jsonl$)/, '');
  const missing = [];
  for (const w of [...words.values()].filter((x) => x.batch === batch)) {
    const list = byWord.get(w.id) ?? [];
    if (!list.length) missing.push(w.word);
    else if (list.length !== PER_WORD) warnings.push(w.word + ': ' + list.length + ' sentences (expected ' + PER_WORD + ')');
    else if (new Set(list.map((x) => x.tense || x.label)).size < 3) warnings.push(w.word + ': fewer than 3 different tenses');
  }
  if (missing.length) problems.push(missing.length + ' words have no sentences: ' + missing.slice(0, 12).join(', ') + (missing.length > 12 ? '…' : ''));
  return { ok, problems, warnings, words: [...words.values()].filter((x) => x.batch === batch).length };
}

(async () => {
  const words = inputs();
  const single = process.argv.find((a) => a.endsWith('.jsonl'));
  if (single) {
    const r = checkFile(path.resolve(single), words, new Set());
    console.log(path.basename(single) + ': ' + r.ok.length + ' good sentences for ' + r.words + ' words · ' + r.problems.length + ' errors · ' + r.warnings.length + ' warnings');
    for (const p of r.problems) console.log('  ✗ ' + p);
    for (const p of r.warnings) console.log('  ! ' + p);
    process.exit(r.problems.length ? 1 : 0);
  }

  const mongoose = require('mongoose');
  await mongoose.connect(process.env.MONGODB_URI, { dbName: process.env.MONGODB_DB || 'English' });
  const db = mongoose.connection.db;
  // Sentences already in the bank count as duplicates, so re-running an import adds only new ones.
  const seen = new Set((await db.collection('word_sentences').find({}, { projection: { key: 1 } }).toArray()).map((d) => d.key));
  const files = fs.readdirSync(path.join(DIR, 'output')).filter((x) => x.endsWith('.jsonl')).sort();
  const all = [], report = [];
  let nErr = 0, nWarn = 0;
  for (const f of files) {
    const r = checkFile(path.join(DIR, 'output', f), words, seen);
    all.push(...r.ok);
    nErr += r.problems.length; nWarn += r.warnings.length;
    report.push(f + ': ' + r.ok.length + ' good for ' + r.words + ' words', ...r.problems.map((p) => '  ✗ ' + p), ...r.warnings.map((p) => '  ! ' + p));
  }
  fs.writeFileSync(path.join(DIR, 'report.txt'), report.join('\n') + '\n');
  const byTense = all.reduce((m, g) => { const k = g.tense || '(other)'; m[k] = (m[k] ?? 0) + 1; return m; }, {});
  console.log(files.length + ' files · ' + all.length + ' good sentences · ' + nErr + ' errors · ' + nWarn + ' warnings. Details: sentence-bank/report.txt');
  console.table(byTense);

  if (process.argv.includes('--import') && all.length) {
    const now = new Date();
    await db.collection('word_sentences').createIndex({ key: 1 }, { unique: true });
    await db.collection('word_sentences').createIndex({ wordId: 1 });
    const r = await db.collection('word_sentences').insertMany(all.map(({ parts, explain, label, ...s }) => ({ ...s, key: sentenceKey(s.sentence), source: 'ai', createdAt: now })), { ordered: false })
      .catch((e) => (e.code === 11000 || e.writeErrors ? e.result : Promise.reject(e)));
    const ops = all.filter((g) => g.parts.length || g.tense).map((g) => ({
      updateOne: {
        filter: { key: sentenceKey(g.sentence), checked: { $ne: true } },
        update: { $set: { text: g.sentence, tense: g.tense, label: g.label, parts: g.parts, explain: g.explain, notes: [], source: 'ai', updatedAt: now }, $setOnInsert: { checked: false, createdAt: now } },
        upsert: true
      }
    }));
    for (let i = 0; i < ops.length; i += 1000) await db.collection('sentence_grammar').bulkWrite(ops.slice(i, i + 1000), { ordered: false });
    console.log('Imported ' + (r?.insertedCount ?? r?.nInserted ?? all.length) + ' sentences into word_sentences, ' + ops.length + ' grammar analyses.');
  }
  await mongoose.disconnect();
})().catch((e) => { console.error(e.message); process.exit(1); });
