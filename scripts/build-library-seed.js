// Merges the per-topic word lists in src/library/seed/<topic>.json into
// src/library/seed/library.json: validates entries, removes words that appear in
// more than one topic, and keeps PER_TOPIC words from each topic (TOTAL overall).
// Usage: node scripts/build-library-seed.js
const fs = require('fs');
const path = require('path');

const DIR = path.join(__dirname, '..', 'src', 'library', 'seed');
const TOPICS = ['it', 'interview', 'customer', 'leader'];
const TOTAL = 500;
const PER_TOPIC = TOTAL / TOPICS.length;
const POS = ['Noun', 'Verb', 'Adjective', 'Adverb', 'Pronoun', 'Preposition', 'Conjunction', 'Other'];
const LEVELS = ['A1', 'A2', 'B1', 'B2', 'C1', 'C2'];

const seen = new Set();
const picked = {};
const spare = [];
const problems = [];

for (const topic of TOPICS) {
  const list = JSON.parse(fs.readFileSync(path.join(DIR, topic + '.json'), 'utf8'));
  picked[topic] = [];
  for (const e of list) {
    const key = String(e.word || '').trim().toLowerCase();
    const bad =
      !key ? 'empty word' :
      !POS.includes(e.pos) ? 'pos ' + e.pos :
      !LEVELS.includes(e.level) ? 'level ' + e.level :
      !e.meaning || !e.vi ? 'missing meaning/vi' :
      e.ex && !e.ex.includes(e.word) ? 'example does not contain the word' : '';
    if (bad) { problems.push(topic + ': ' + e.word + ' (' + bad + ')'); continue; }
    if (seen.has(key)) continue; // already taken by an earlier topic
    seen.add(key);
    const row = {
      word: e.word.trim(), ipa: e.ipa || '', pos: e.pos, meaning: e.meaning, vi: e.vi, ex: e.ex || '',
      syn: Array.isArray(e.syn) ? e.syn : [], ant: Array.isArray(e.ant) ? e.ant : [], level: e.level, topic
    };
    if (picked[topic].length < PER_TOPIC) picked[topic].push(row);
    else spare.push(row);
  }
}

// If a topic lost words to duplicates, top up from the spare words of whichever topic is smallest.
let out = TOPICS.flatMap((t) => picked[t]);
while (out.length < TOTAL && spare.length) {
  const count = (t) => out.filter((w) => w.topic === t).length;
  spare.sort((a, b) => count(a.topic) - count(b.topic));
  out.push(spare.shift());
}

fs.writeFileSync(path.join(DIR, 'library.json'), JSON.stringify(out, null, 1) + '\n');
const byTopic = Object.fromEntries(TOPICS.map((t) => [t, out.filter((w) => w.topic === t).length]));
console.log('library.json:', out.length, 'words', byTopic);
if (problems.length) console.log('skipped', problems.length, 'invalid entries:\n  ' + problems.join('\n  '));
