import type { Level } from '../common/constants';

// Offline word list used by lookup before going online.
// ipa, pos, meaning, vi, example, synonyms, antonyms, level
export const BUILTIN_DICT: Record<string, [string, string, string, string, string, string[], string[], Level]> = {
  resilient: ['/rɪˈzɪliənt/', 'Adjective', 'Able to recover quickly from problems or difficult situations.', 'kiên cường, có khả năng phục hồi', 'A resilient system keeps working even when one server fails.', ['tough', 'robust'], ['fragile'], 'B2'],
  leverage: ['/ˈlevərɪdʒ/', 'Verb', 'To use something you already have to get the best result.', 'tận dụng', 'We can leverage our existing tools to save time.', ['use', 'exploit'], [], 'C1'],
  concise: ['/kənˈsaɪs/', 'Adjective', 'Giving information clearly in few words.', 'ngắn gọn, súc tích', 'Please keep your summary concise.', ['brief', 'succinct'], ['wordy'], 'B2'],
  persistent: ['/pərˈsɪstənt/', 'Adjective', 'Continuing to try even when things are difficult.', 'kiên trì, bền bỉ', 'Being persistent is the key to learning a language.', ['determined', 'tenacious'], ['irresolute'], 'B2'],
  prioritize: ['/praɪˈɔːrətaɪz/', 'Verb', 'To decide which things are most important and do them first.', 'ưu tiên', 'We should prioritize bugs that affect users.', ['rank', 'put first'], [], 'B2'],
  estimate: ['/ˈestɪmeɪt/', 'Verb', 'To guess the size, cost or time of something.', 'ước tính', 'Can you estimate how long this task will take?', ['calculate', 'approximate'], [], 'B1'],
  bottleneck: ['/ˈbɑːtəlnek/', 'Noun', 'A point that slows down a whole process.', 'điểm nghẽn', 'The database became a bottleneck under heavy traffic.', ['obstacle', 'holdup'], [], 'C1'],
  insight: ['/ˈɪnsaɪt/', 'Noun', 'A clear, deep understanding of something.', 'sự hiểu biết sâu sắc', 'The survey gave us useful insight into user needs.', ['understanding', 'perception'], [], 'B2'],
  accurate: ['/ˈækjərət/', 'Adjective', 'Correct and exact, without mistakes.', 'chính xác', 'Make sure the numbers in the report are accurate.', ['correct', 'precise'], ['inaccurate'], 'B1'],
  improve: ['/ɪmˈpruːv/', 'Verb', 'To make something better.', 'cải thiện', 'I want to improve my English pronunciation.', ['enhance', 'upgrade'], ['worsen'], 'A2']
};
