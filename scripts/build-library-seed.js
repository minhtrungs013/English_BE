// Builds src/library/seed/library.json from the per-topic word lists in src/library/seed/:
//  - it / interview / customer / leader .json → 500 words (125 per topic where possible)
//  - toeic-*.json                             → TOEIC words (TOEIC_TOTAL), skipping any word already used
// Entries are validated, and a word appears only once across the whole library.
// Usage: node scripts/build-library-seed.js
const fs = require('fs');
const path = require('path');

const DIR = path.join(__dirname, '..', 'src', 'library', 'seed');
const TOPICS = ['it', 'interview', 'customer', 'leader'];
const TOTAL = 500;
const PER_TOPIC = TOTAL / TOPICS.length;
const TOEIC_TOTAL = 600;
const POS = ['Noun', 'Verb', 'Adjective', 'Adverb', 'Pronoun', 'Preposition', 'Conjunction', 'Other'];
const LEVELS = ['A1', 'A2', 'B1', 'B2', 'C1', 'C2'];

const seen = new Set();
const problems = [];

/** Validates an entry and returns a clean row, or null (invalid or already used). */
function take(e, topic, source) {
  const key = String(e.word || '').trim().toLowerCase();
  const bad =
    !key ? 'empty word' :
    !POS.includes(e.pos) ? 'pos ' + e.pos :
    !LEVELS.includes(e.level) ? 'level ' + e.level :
    !e.meaning || !e.vi ? 'missing meaning/vi' :
    e.ex && !e.ex.includes(e.word) ? 'example does not contain the word' : '';
  if (bad) { problems.push(source + ': ' + e.word + ' (' + bad + ')'); return null; }
  if (seen.has(key)) return null;
  seen.add(key);
  return {
    word: e.word.trim(), ipa: e.ipa || '', pos: e.pos, meaning: e.meaning, vi: e.vi, ex: e.ex || '',
    syn: Array.isArray(e.syn) ? e.syn : [], ant: Array.isArray(e.ant) ? e.ant : [], level: e.level, topic
  };
}
const read = (file) => JSON.parse(fs.readFileSync(path.join(DIR, file), 'utf8'));

/* ---------- the original 500: IT, interview, customer and leader meetings ---------- */
const picked = {};
const spare = [];
for (const topic of TOPICS) {
  picked[topic] = [];
  for (const e of read(topic + '.json')) {
    const row = take(e, topic, topic);
    if (!row) continue;
    if (picked[topic].length < PER_TOPIC) picked[topic].push(row);
    else spare.push(row);
  }
}
const base = TOPICS.flatMap((t) => picked[t]);
// If a topic lost words to duplicates, top up from the spare words of whichever topic is smallest.
while (base.length < TOTAL && spare.length) {
  const count = (t) => base.filter((w) => w.topic === t).length;
  spare.sort((a, b) => count(a.topic) - count(b.topic));
  base.push(spare.shift());
}
// Spare words that weren't used are free again (so TOEIC lists may use them).
for (const w of spare) seen.delete(w.word.toLowerCase());

/* ---------- TOEIC ---------- */
const toeicFiles = fs.readdirSync(DIR).filter((f) => /^toeic-.*\.json$/.test(f)).sort();
// An even share from each TOEIC list (office, finance, travel, industry…), then top up from the rest.
const toeic = [];
const toeicSpare = [];
const share = toeicFiles.length ? Math.floor(TOEIC_TOTAL / toeicFiles.length) : 0;
for (const f of toeicFiles) {
  let n = 0;
  for (const e of read(f)) {
    const row = take(e, 'toeic', f);
    if (!row) continue;
    if (n < share) { toeic.push(row); n++; } else toeicSpare.push(row);
  }
}
while (toeic.length < TOEIC_TOTAL && toeicSpare.length) toeic.push(toeicSpare.shift());

const out = [...base, ...toeic];
fs.writeFileSync(path.join(DIR, 'library.json'), JSON.stringify(out, null, 1) + '\n');
const byTopic = {};
for (const w of out) byTopic[w.topic] = (byTopic[w.topic] || 0) + 1;
console.log('library.json:', out.length, 'words', byTopic, toeicFiles.length ? '(TOEIC from ' + toeicFiles.join(', ') + ')' : '');
if (toeic.length < TOEIC_TOTAL && toeicFiles.length) console.log('note: only ' + toeic.length + ' unique TOEIC words (wanted ' + TOEIC_TOTAL + ')');
if (problems.length) console.log('skipped', problems.length, 'invalid entries:\n  ' + problems.join('\n  '));
