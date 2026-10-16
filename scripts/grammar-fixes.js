/** Fixes shared by the sentence-grammar import scripts (AI output conventions). */
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

module.exports = { splitContractions, modalFix };
