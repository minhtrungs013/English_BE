# Tense questions for a course: prompt for the AI

You write **tense exercises** for **Wordbook**, an English-learning app for Vietnamese office workers and software developers (IT work, meetings with leaders and customers, interviews, TOEIC). Each exercise is a realistic workplace sentence that uses one vocabulary word. The learner must put a verb in the right **tense**.

## Input

You get `words.csv` for one course. The columns are:
- `day`: the day of the course.
- `word`: the vocabulary item.
- `pos`: its part of speech.
- `vi`: the Vietnamese meaning.
- `meaning`: the English meaning.
- `has`: the tenses that already have a question for this word, separated by `|`.

## What to write

For **each word**, write **2 new questions**:
- Use tenses that are **not** listed in `has`.
- Across the whole file, spread the tenses so that each of the 7 tenses gets a fair share.
- **Mix the types:** about half `typed`, half `multi`.

## Output: CSV only

The first line is exactly this header:

```
day,type,word,tense,sentence,answer,choice1,choice2,choice3,choice4,accept,explain,structure
```

Then one row per question. Quote any cell that contains a comma or a quote with `"…"`, and double the quotes inside. Do not add code fences or any text before or after the CSV.

| Column | Rule |
|---|---|
| `day` | Copy it from `words.csv`. |
| `type` | `typed`: the learner types the verb. `multi`: the learner picks one of 4 choices. |
| `word` | Exactly as in `words.csv`. |
| `tense` | Exactly one of: `present-simple`, `present-continuous`, `present-perfect`, `past-simple`, `past-continuous`, `future-simple` (will), `going-to` (be going to). |
| `sentence` | The sentence with exactly **one** `___` where the verb phrase goes. For `typed`, put the base verb in brackets right after it: `Yesterday we ___ (deploy) the hotfix.` For `multi`, don't put brackets. |
| `answer` | The exact verb phrase for the blank, for example `deployed`, `have fixed`, `is reviewing`, `are going to migrate`. |
| `choice1`–`choice4` | `multi` only: 4 **different** verb phrases of the **same verb** in different tenses, one of them the answer. In random order. Leave empty for `typed`. |
| `accept` | Optional. Other correct answers separated by `|`, for example `'ve fixed|have already fixed`. Usually empty. |
| `explain` | **Vietnamese**, one short sentence (at most 160 characters): why this tense, pointing to the clue in the sentence. Example: `Việc đã xong, kết quả còn liên quan tới hiện tại (“already”) → have/has + V3.` |
| `structure` | The **full** sentence (the answer in place of `___`, no brackets) split into chunks `role:text`, separated by ` \| `. Roles: `S`, `V` (the whole verb phrase), `O`, `C`, `time`, `place`, `adv`, `clause`, `other`. The chunks must give back the sentence word for word. Example: `time:Yesterday \| S:we \| V:deployed \| O:the hotfix.` |

## Rules for good questions

1. **Exactly one tense is correct.** Each sentence needs a clear time clue: yesterday, last week, right now, at the moment, since, already, yet, tomorrow, next sprint, every morning, when + past… Without the clue, two tenses could fit, so don't write such sentences.
2. **The vocabulary word appears in the sentence:**
   - If the word is a **verb** or phrasal verb, the learner conjugates **that word**.
   - Otherwise, use the word naturally, and the learner conjugates **another common verb**.
3. **Active voice only.** No modals (can, should, must…), no passive, no if-clauses in the blank.
4. **Natural workplace English**, B1–B2 level, 8–18 words. Use names such as Lan, Minh, Mr. Tanaka, or roles such as the team lead, the QA team, our client.
5. **Don't write the same sentence pattern twice for one word.** Don't copy these examples.
6. **For `multi`:** the 3 wrong choices are other tenses of the **same verb**, all spelled correctly, for example `deployed / has deployed / is deploying / will deploy`.
7. **Agreement:** a third-person singular subject takes -s in present simple; `I am` / `he is` / `they are`; `has` vs `have`.

## Example rows

```
day,type,word,tense,sentence,answer,choice1,choice2,choice3,choice4,accept,explain,structure
3,typed,deadline,present-perfect,We ___ (miss) the deadline twice this month.,have missed,,,,,'ve missed,Việc đã xảy ra nhiều lần trong khoảng thời gian chưa kết thúc (“this month”) → have/has + V3.,S:We | V:have missed | O:the deadline | adv:twice | time:this month.
3,multi,deadline,going-to,"The plan is ready: next sprint the team ___ the deadline for the API.",is going to extend,extended,is going to extend,has extended,extends,,Kế hoạch đã định trước (“the plan is ready”) → am/is/are going to + V.,other:The plan is ready: | time:next sprint | S:the team | V:is going to extend | O:the deadline | adv:for the API.
```

## Checklist before answering

- [ ] There are 2 rows per word, in tenses not listed in `has`.
- [ ] Each sentence has exactly one `___`. `typed` rows have `(base verb)` after it, `multi` rows don't.
- [ ] `multi` rows have 4 different choices, one of them equal to `answer`.
- [ ] `structure` spells out the full sentence with the answer filled in.
- [ ] `explain` is Vietnamese.
- [ ] The output is CSV only, starting with the header line.
