/**
 * Imports AI analyses (grammar-batch/output/*.jsonl, written following grammar-batch/PROMPT.md) into
 * `sentence_grammar`. Each line is checked against its input sentence: the parts must spell out the sentence,
 * the tense must be a lesson id (or "" with a label). Owner-checked analyses are never overwritten.
 *
 *   npm run build
 *   node scripts/import-sentence-grammar.js --check grammar-batch/output/batch-05.jsonl   (validate only, no database)
 *   node scripts/import-sentence-grammar.js --dry      (validate every output file, show what would be saved)
 *   node scripts/import-sentence-grammar.js            (save)
 * Problems are listed in grammar-batch/report.txt.
 */
require('dotenv').config({ quiet: true });
const fs = require('fs');
const path = require('path');
const { checkParts, sentenceKey } = require('../dist/courses/sentence-rules.js');
const { TENSES } = require('../dist/courses/tense.js');

const DIR = path.join(__dirname, '..', 'grammar-batch');

/** All input sentences by id. */
function inputs() {
  const m = new Map();
  for (const f of fs.readdirSync(path.join(DIR, 'input')).filter((x) => x.endsWith('.jsonl'))) {
    for (const line of fs.readFileSync(path.join(DIR, 'input', f), 'utf8').split('\n')) {
      if (!line.trim()) continue;
      const o = JSON.parse(line);
      m.set(o.id, { text: o.text, batch: f });
    }
  }
  return m;
}

/**
 * A contraction kept whole as the subject ("I'll", "We're", "There's" tagged S) hides the helping verb:
 * split it into the subject and "'ll" / "'re" / "'s", which joins the verb right after it (or becomes its own verb).
 */
function splitContractions(parts) {
  const out = [];
  for (let i = 0; i < parts.length; i++) {
    const p = parts[i];
    // The other way round: "I've worked" / "we'll add" tagged V with no subject → "I" (S) + "'ve worked" (V).
    const v = p.role === 'V' ? /^(I|you|we|they|he|she|it|there|that|here|who|what|where)(['’](?:m|re|s|ll|ve|d))(\s.*)?$/i.exec(p.text) : null;
    if (v) { out.push({ text: v[1], role: 'S' }, { text: v[2] + (v[3] ?? ''), role: 'V' }); continue; }
    const m = p.role === 'S' ? /^([A-Za-z]+)(['’](?:m|re|s|ll|ve|d))$/.exec(p.text) : null;
    if (!m) { out.push(p); continue; }
    out.push({ text: m[1], role: 'S' });
    const next = parts[i + 1];
    if (next && next.role === 'V') { out.push({ text: m[2] + ' ' + next.text, role: 'V' }); i++; }
    else out.push({ text: m[2], role: 'V' });
  }
  return out;
}

const MODAL = /\b(can't|cannot|couldn't|shouldn't|mustn't|wouldn't|can|could|should|must|may|might|would|shall|ought to|have to|has to|had to)\b/i;

/**
 * A modal verb phrase tagged with an active tense ("must submit" as present-simple) has no tense lesson:
 * returns the tense to store ("") and a label for it, or null when the tense is fine.
 */
function modalFix(tense, parts, text) {
  if (!tense) return null;
  const v = parts.filter((p) => p.role === 'V').map((p) => p.text).join(' ');
  const m = MODAL.exec(v);
  if (!m) return null;
  const word = m[1].toLowerCase();
  if (/^(have|has|had) to$/.test(word)) return { tense: '', label: 'Cấu trúc ' + word + ' (bắt buộc)' };
  const base = word.replace(/n't$|not$/, '').replace(/^can$|^ca$/, 'can').replace(/^wo$/, 'will');
  return { tense: '', label: parts[0]?.role === 'V' && /\?\s*$/.test(text) ? 'Câu hỏi với ' + base : 'Động từ khuyết thiếu: ' + word };
}

/** Checks one output file. Returns the valid analyses and the problems (by id). */
function checkFile(file, ins) {
  const ok = [];
  const problems = [];
  const fixed = [];
  const raw = fs.readFileSync(file, 'utf8').replace(/^﻿/, '').replace(/```[a-z]*\n?/g, '');
  const batch = path.basename(file);
  const expected = [...ins.entries()].filter(([, v]) => v.batch === batch).map(([id]) => id);
  const seen = new Set();
  raw.split('\n').forEach((line, n) => {
    if (!line.trim()) return;
    let o;
    try { o = JSON.parse(line); } catch { problems.push('line ' + (n + 1) + ': not valid JSON'); return; }
    const src = ins.get(o.id);
    if (!src) { problems.push((o.id ?? 'line ' + (n + 1)) + ': unknown id'); return; }
    if (seen.has(o.id)) { problems.push(o.id + ': duplicate'); return; }
    seen.add(o.id);
    const tense = typeof o.tense === 'string' ? o.tense : '';
    if (tense && !TENSES.includes(tense)) { problems.push(o.id + ': unknown tense "' + tense + '"'); return; }
    const label = typeof o.label === 'string' ? o.label.trim() : '';
    if (!tense && !label) { problems.push(o.id + ': tense is "" but label is empty'); return; }
    const parts = checkParts(src.text, o.parts);
    if (!parts) { problems.push(o.id + ': parts do not spell out the sentence (or a role is wrong): ' + src.text); return; }
    const explain = typeof o.explain === 'string' ? o.explain.trim() : '';
    if (!explain) { problems.push(o.id + ': explain is empty'); return; }
    if (explain.length > 200) { problems.push(o.id + ': explain is longer than 200 characters'); return; }
    const fix = modalFix(tense, parts, src.text);
    if (fix) fixed.push(o.id + ': ' + tense + ' → "' + fix.label + '"');
    const t = fix ? fix.tense : tense;
    ok.push({ text: src.text, tense: t, label: t ? '' : (fix ? fix.label : label).slice(0, 60), parts: checkParts(src.text, splitContractions(parts)) ?? parts, explain });
  });
  for (const id of expected) if (!seen.has(id)) problems.push(id + ': missing from the output');
  return { ok, problems, fixed, expected: expected.length };
}

(async () => {
  const ins = inputs();
  const checkOnly = process.argv.indexOf('--check');
  if (checkOnly > 0) {
    const file = path.resolve(process.argv[checkOnly + 1]);
    const r = checkFile(file, ins);
    console.log(path.basename(file) + ': ' + r.ok.length + '/' + r.expected + ' valid' + (r.problems.length ? ', ' + r.problems.length + ' problems:' : '.'));
    for (const p of r.problems) console.log('  ' + p);
    process.exit(r.problems.length ? 1 : 0);
  }

  const dry = process.argv.includes('--dry');
  const outDir = path.join(DIR, 'output');
  const files = fs.readdirSync(outDir).filter((x) => x.endsWith('.jsonl')).sort();
  const all = [];
  const report = [];
  let nFixed = 0;
  for (const f of files) {
    const r = checkFile(path.join(outDir, f), ins);
    all.push(...r.ok);
    report.push(f + ': ' + r.ok.length + '/' + r.expected + ' valid', ...r.problems.map((p) => '  ' + p), ...r.fixed.map((p) => '  fixed ' + p));
    nFixed += r.fixed.length;
  }
  fs.writeFileSync(path.join(DIR, 'report.txt'), report.join('\n') + '\n');
  const byTense = all.reduce((m, g) => { const k = g.tense || '(no lesson)'; m[k] = (m[k] ?? 0) + 1; return m; }, {});
  console.log(files.length + ' files · ' + all.length + ' valid analyses of ' + ins.size + ' sentences · ' + nFixed + ' modal tenses fixed. Details: grammar-batch/report.txt');
  console.table(byTense);
  if (dry || !all.length) return;

  const mongoose = require('mongoose');
  await mongoose.connect(process.env.MONGODB_URI, { dbName: process.env.MONGODB_DB || 'English' });
  const col = mongoose.connection.db.collection('sentence_grammar');
  const now = new Date();
  let saved = 0;
  for (let i = 0; i < all.length; i += 500) {
    const ops = all.slice(i, i + 500).map((g) => ({
      updateOne: {
        filter: { key: sentenceKey(g.text), checked: { $ne: true } },
        update: { $set: { text: g.text, tense: g.tense, label: g.label, parts: g.parts, explain: g.explain, notes: [], source: 'ai', updatedAt: now }, $setOnInsert: { checked: false, createdAt: now } },
        upsert: true
      }
    }));
    const r = await col.bulkWrite(ops, { ordered: false }).catch((e) => (e.code === 11000 || e.writeErrors ? e.result : Promise.reject(e)));
    saved += (r?.upsertedCount ?? r?.nUpserted ?? 0) + (r?.modifiedCount ?? r?.nModified ?? 0);
  }
  console.log('Saved ' + saved + ' analyses (owner-checked ones kept).');
  await mongoose.disconnect();
})().catch((e) => { console.error(e.message); process.exit(1); });
