# Sentence grammar: analysis prompt

You analyse English example sentences for **Wordbook**, an English-learning app for Vietnamese office workers and software developers. When learners tap **Grammar** under a sentence, the app shows your analysis: the sentence split into parts (subject, verb, object, time…), the tense, and a one-line explanation in Vietnamese.

## Input

You get a JSONL file. Each line is one sentence:

```
{"id":"L00001","text":"QA found a bug in the checkout page this morning."}
```

## Output

Return **JSONL only**: exactly one line per input line, in the same order, with the same `id`. Do not add code fences, headings, comments or blank lines. Each line looks like this:

```
{"id":"L00001","tense":"past-simple","label":"","parts":[{"text":"QA","role":"S"},{"text":"found","role":"V"},{"text":"a bug","role":"O"},{"text":"in the checkout page","role":"place"},{"text":"this morning.","role":"time"}],"explain":"Việc đã xảy ra và kết thúc trong buổi sáng nay → quá khứ đơn (V2)."}
```

### `tense`

The tense of the **main clause's** verb. Use exactly one of these ids:

| id | Tense | Form |
|---|---|---|
| `present-simple` | Present simple | V / V-s, am/is/are (be as the main verb) |
| `present-continuous` | Present continuous | am/is/are + V-ing |
| `present-perfect` | Present perfect | have/has + V3, including have/has been + V-ing |
| `past-simple` | Past simple | V2 / V-ed, was/were (be as the main verb) |
| `past-continuous` | Past continuous | was/were + V-ing |
| `future-simple` | Future simple | will + V |
| `going-to` | Future with going to | am/is/are going to + V |

Use `""` (empty) when the main clause is **not** one of these active-voice tenses:
- **passive voice** (is done, was approved, will be sent…)
- **modal verb** (can, could, should, must, may, might, would)
- **imperative** ("Please send…", "Don't forget…")
- other tenses (past perfect, future continuous…)
- **conditional** sentences (if-clauses)
- fragments without a finite verb

Questions and negative sentences use the tense of their verb. For example, "Did you check it?" is `past-simple`.

### `label`

When `tense` is `""`, `label` is **required**. It is a short Vietnamese name of the structure, at most 60 characters. For example:
- `"Bị động – hiện tại đơn"`
- `"Bị động – quá khứ đơn"`
- `"Động từ khuyết thiếu: should"`
- `"Câu hỏi với can"`
- `"Câu mệnh lệnh"`
- `"Câu điều kiện loại 1"`
- `"Quá khứ hoàn thành"`

When `tense` is set, use `""`.

### `parts`

Split the **whole** sentence into 2–12 consecutive chunks:
- Copy the words **exactly** as written: same spelling, same order, no words added, dropped or changed.
- Joined with spaces, the chunks must give back the sentence.
- Attach punctuation to the chunk it follows.

Each chunk has one `role`:

| role | Meaning | Examples |
|---|---|---|
| `S` | Subject (the whole noun phrase) | "Our new accountant", "It", "There" |
| `V` | The **whole verb phrase**: auxiliaries, modals, "not", adverbs inside it, phrasal-verb particles | "will prepare", "has not been fixed", "can test", "set up" |
| `O` | Object (direct or indirect) | "the tax documents", "me" |
| `C` | Complement after be or a linking verb | "ready", "a senior developer", "very important" |
| `time` | When / how often | "next week", "every morning", "by Friday" |
| `place` | Where | "in the meeting room", "on Safari" |
| `adv` | Any other adverbial: manner, purpose, reason, "as well", "to save time", "with the client" | |
| `clause` | A whole dependent clause | "when the server went down", "because the build failed", "that we need more time" |
| `other` | Anything else: "Please", "Don't worry,", linking words like "and"/"but", greetings | |

Rules for special sentences:
- **Imperative:** there is no subject. "Please" is `other`, and the verb comes first.
- **Two main clauses** joined by and/but/so: split both, and the linking word is `other`.
- **Questions:** keep the auxiliary with the verb phrase if they are next to each other. Otherwise the auxiliary is its own `V` chunk. For example: "Can" (V) / "you" (S) / "test" (V) / "the login flow" (O) / "on Safari" (place) / "as well?" (adv).
- **Contractions:** split them so that the verb keeps its role. "I'm writing" becomes "I" (S) / "'m writing" (V). "There's a bug" becomes "There" (S) / "'s" (V) / "a bug" (C). "We'll send" becomes "We" (S) / "'ll send" (V). The check ignores spaces, so "I" + "'m" still spells out "I'm".
- **"There is/are…":** "There" is `S`, "is/are" is `V`, and the noun phrase after it is `C`.

### `explain`

One sentence in **Vietnamese**, at most 160 characters:
- Say **why** this tense or structure is used **in this sentence**.
- Point to the clue in the sentence, for example (“this morning”), (“every day”), (“already”), or the situation.
- You may end with the form, for example "→ will + V". Don't repeat the whole formula table.
- Write naturally, as a teacher would.

## Examples

Input:
```
{"id":"L00002","text":"Please push your code before the end of the day."}
{"id":"L00003","text":"Can you test the login flow on Safari as well?"}
{"id":"L00004","text":"All files are backed up to the cloud."}
{"id":"L00005","text":"Our team holds a stand-up meeting every morning."}
{"id":"L00006","text":"I was reviewing the code when the server went down."}
{"id":"L00007","text":"We will launch the new product in the spring."}
```

Output:
```
{"id":"L00002","tense":"","label":"Câu mệnh lệnh","parts":[{"text":"Please","role":"other"},{"text":"push","role":"V"},{"text":"your code","role":"O"},{"text":"before the end of the day.","role":"time"}],"explain":"Câu mệnh lệnh lịch sự để nhờ ai làm việc gì: Please + V nguyên mẫu, không có chủ ngữ."}
{"id":"L00003","tense":"","label":"Câu hỏi với can","parts":[{"text":"Can","role":"V"},{"text":"you","role":"S"},{"text":"test","role":"V"},{"text":"the login flow","role":"O"},{"text":"on Safari","role":"place"},{"text":"as well?","role":"adv"}],"explain":"Dùng “Can you…?” để nhờ ai làm gì một cách lịch sự → Can + S + V nguyên mẫu?"}
{"id":"L00004","tense":"","label":"Bị động – hiện tại đơn","parts":[{"text":"All files","role":"S"},{"text":"are backed up","role":"V"},{"text":"to the cloud.","role":"place"}],"explain":"Câu bị động vì quan trọng là các tệp được sao lưu, không cần nói ai làm → am/is/are + V3."}
{"id":"L00005","tense":"present-simple","label":"","parts":[{"text":"Our team","role":"S"},{"text":"holds","role":"V"},{"text":"a stand-up meeting","role":"O"},{"text":"every morning.","role":"time"}],"explain":"Thói quen lặp lại (“every morning”), chủ ngữ số ít nên động từ thêm -s."}
{"id":"L00006","tense":"past-continuous","label":"","parts":[{"text":"I","role":"S"},{"text":"was reviewing","role":"V"},{"text":"the code","role":"O"},{"text":"when the server went down.","role":"clause"}],"explain":"Việc đang diễn ra trong quá khứ thì bị một việc khác xen vào (“when the server went down”) → was/were + V-ing."}
{"id":"L00007","tense":"future-simple","label":"","parts":[{"text":"We","role":"S"},{"text":"will launch","role":"V"},{"text":"the new product","role":"O"},{"text":"in the spring.","role":"time"}],"explain":"Dự định về tương lai (“in the spring”) → will + V nguyên mẫu."}
```

## Checklist before answering

- [ ] One output line per input line, same ids, same order.
- [ ] The parts of each sentence spell out the sentence exactly.
- [ ] `tense` is one of the 7 ids or `""`, and `label` is filled when `tense` is `""`.
- [ ] `explain` is Vietnamese and at most 160 characters.
- [ ] The output is valid JSON on every line, with nothing else around it.
