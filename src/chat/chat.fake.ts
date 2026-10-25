import { CHAT_LESSONS } from './chat.ai';

/**
 * Test mode (CHAT_FAKE=1): a canned answer without calling OpenAI, so the chat can be tried end to end.
 * The word cards and lesson buttons still come from the real tools; only the text is made up here.
 */
export function fakePlan(text: string): { words: string[]; lesson: string | null; vi: string } {
  const low = text.toLowerCase();
  // "Present perfect" and "past simple" are both lessons; the first one mentioned wins.
  const hits = CHAT_LESSONS
    .map((l) => ({ id: l.id, at: Math.min(...[l.name.split(/[(:]/)[0].trim(), l.vi.split('(')[0].trim()].map((n) => { const i = low.indexOf(n.toLowerCase()); return i < 0 ? Infinity : i; })) }))
    .filter((h) => h.at < Infinity)
    .sort((a, b) => a.at - b.at);
  const words: string[] = [];
  for (const m of text.matchAll(/["“'‘]([A-Za-z][A-Za-z' -]{0,30})["”'’]/g)) words.push(m[1].trim());
  if (!words.length) {
    const m = /(?:từ|word|nghĩa của|đặt câu với|explain)\s+([A-Za-z][A-Za-z'-]*(?:\s[A-Za-z][A-Za-z'-]*)?)/i.exec(text);
    if (m) words.push(m[1]);
    else if (/^[A-Za-z][A-Za-z' -]{0,40}\??$/.test(text.trim()) && text.trim().split(/\s+/).length <= 3 && !hits.length) words.push(text.trim().replace(/\?$/, ''));
  }
  // The meaning meant, when the question says it: “platform” nghĩa là nền tảng.
  const vi = (/nghĩa là\s+([^?.,!“”"]{2,40})/i.exec(text)?.[1] ?? '').split(/\s+(?:thì|thế|và|có|được|khi|trong)\s/)[0].trim();
  return { words: [...new Set(words.map((w) => w.toLowerCase()))].slice(0, 3), lesson: hits[0]?.id ?? null, vi };
}

export function fakeText(cards: { word: string; pos?: string; vi?: string; ex?: string }[], lesson: { name: string; vi: string } | null): string {
  const parts = ['(Chế độ thử: đây là câu trả lời mẫu, chưa dùng AI thật.)'];
  for (const c of cards) {
    parts.push('**' + c.word + '**' + (c.pos ? ' (' + c.pos.toLowerCase() + ')' : '') + (c.vi ? ' nghĩa là “' + c.vi + '”.' : '.') +
      (c.ex ? '\n- Ví dụ: ' + c.ex : '') + '\n- Hãy thử tự đặt một câu với từ này về công việc của bạn.');
  }
  if (lesson) parts.push('Câu hỏi của bạn liên quan đến bài **' + lesson.name + '** (' + lesson.vi + '). Bấm nút bên dưới để mở bài hoặc luyện tập.');
  if (!cards.length && !lesson) {
    parts.push('Mình là trợ lý học tiếng Anh. Bạn có thể hỏi:\n- nghĩa của một từ, ví dụ “device”\n- một điểm ngữ pháp, ví dụ so sánh present perfect và past simple');
  }
  return parts.join('\n\n');
}
