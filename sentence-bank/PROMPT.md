# Word sentence bank: prompt for the AI

You write **example sentences** for **Wordbook**, an English-learning app for Vietnamese office workers and software developers (IT work, meetings with leaders and customers, interviews, emails, TOEIC).

The app turns each sentence into several exercises:
- fill in the word;
- put the verb in the right tense;
- listen and type;
- a "Grammar" explanation of the sentence.

So every sentence must be **natural, correct and clear**, and different from the others.

## Input

A JSONL file, one vocabulary word per line:

```
{"id":"6a1f…","word":"deadline","pos":"Noun","level":"B1","topic":"it","vi":"hạn chót","meaning":"The time by which something must be done.","ex":"We need to meet the deadline for the new release.","have":0}
```

- `ex` is the word's current example sentence. Your sentences must be **different** from it.
- `topic` is one of: `it`, `interview`, `customer`, `leader`, `toeic`, `other`.

## What to write

For **each word**, write **4 new sentences**. Make the 4 sentences different from each other in three ways:

- **Situation.** Use 4 different situations, for example: a stand-up meeting, an email to a client, a job interview, a chat with a colleague, a report, a phone call.
- **Tense.** Use at least 3 different tenses across the 4 sentences. The tense ids:

  | id | Form |
  |---|---|
  | `present-simple` | V / V-s |
  | `present-continuous` | am/is/are + V-ing |
  | `present-perfect` | have/has + V3 |
  | `past-simple` | V2 |
  | `past-continuous` | was/were + V-ing |
  | `future-simple` | will + V |
  | `going-to` | am/is/are going to + V |

  At most 1 of the 4 sentences may use another structure: a modal, the passive, an imperative or a question. For that sentence, set `tense` to `""` and fill `label` in Vietnamese, for example `"Động từ khuyết thiếu: should"`, `"Bị động – quá khứ đơn"`, `"Câu hỏi với can"`.
- **Form.** Use statements, plus at least one negative or question when it sounds natural.

## Rules for each sentence

1. Use the **word with the same meaning** as `vi` / `meaning`. You may inflect it: deadline → deadlines; negotiate → negotiated. Write the exact form you used in `form`.
2. **8–20 words.** Natural workplace English at the word's `level` (A1–C1). Use names such as Lan, Minh, Mr. Tanaka, Sarah, or roles such as the team lead, our client.
3. Add a **clear time clue** when the tense needs one: yesterday, last week, right now, since 2022, already, tomorrow, next sprint, every Monday.
4. **No copying** of `ex`, of the examples here, or of your own other sentences. Don't start all 4 sentences the same way.
5. American spelling. Exactly one sentence per line, ending with `.`, `?` or `!`.

## Output: JSONL only

Write one line per **sentence**, so 4 lines per word, in the same word order as the input. Do not add code fences or any other text.

```
{"id":"6a1f…","word":"deadline","form":"deadline","sentence":"Our team has never missed a deadline since Minh became the project manager.","context":"meeting","tense":"present-perfect","label":"","verb":"has never missed","base":"miss","parts":[{"text":"Our team","role":"S"},{"text":"has never missed","role":"V"},{"text":"a deadline","role":"O"},{"text":"since Minh became the project manager.","role":"clause"}],"explain":"Việc kéo dài từ quá khứ đến nay (“since …”) → have/has + V3."}
```

| Field | Rule |
|---|---|
| `id`, `word` | Copied from the input line. |
| `form` | The vocabulary word **exactly as it appears** in the sentence, for example "deadlines" or "negotiated". |
| `sentence` | The sentence. |
| `context` | One of: `meeting`, `email`, `interview`, `chat`, `phone`, `report`, `presentation`, `customer`, `other`. |
| `tense` | One of the 7 ids, or `""` with a `label`. |
| `label` | `""` when `tense` is set. Otherwise a short Vietnamese name of the structure. |
| `verb` | The **main verb phrase exactly as written** in the sentence, including helping verbs, "not" and adverbs inside it. For example "has never missed", "will send", "is reviewing", "didn't attend". |
| `base` | The base form of the main verb, for example "miss", "send", "review", "attend". For a phrasal verb, include the particle: "follow up". |
| `parts` | The whole sentence split into chunks. Joined with spaces, the chunks must give back the sentence word for word, with punctuation attached. Contractions are split: "I" + "'ll send". Roles: `S` (subject), `V` (whole verb phrase, the same as `verb` when possible), `O` (object), `C` (complement after be or a linking verb), `time`, `place`, `adv` (other adverbial), `clause` (a whole dependent clause), `other` (Please, Don't worry, and/but…). |
| `explain` | **Vietnamese**, at most 160 characters. Why this tense or structure is used, pointing to the clue in the sentence. |

## Checklist before answering

- [ ] 4 lines per word, same `id` and `word` as the input.
- [ ] `form` appears in `sentence` exactly, and `verb` appears in `sentence` exactly.
- [ ] `parts` spell out the sentence.
- [ ] At least 3 different tenses and 4 different contexts per word.
- [ ] No sentence equal or nearly equal to `ex`.
- [ ] `explain` in Vietnamese.
- [ ] JSONL only.
