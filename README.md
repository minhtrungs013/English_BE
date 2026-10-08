# Wordbook API

NestJS + MongoDB (Mongoose) backend for the Wordbook vocabulary app (frontend in `D:\English`).

## Run

```bash
npm install
cp .env.example .env   # then fill in the MongoDB password and a JWT secret
npm run start:dev      # development (watch mode): http://localhost:3000/api, Swagger at /api/docs
```

## Environment

| Variable | Default | |
|---|---|---|
| `MONGODB_URI` | — | Atlas connection string |
| `MONGODB_DB` | `English` | Database name |
| `PORT` | `3000` | |
| `CORS_ORIGIN` | `http://localhost:5173` | Comma-separated allowed frontend origins |
| `JWT_SECRET` | — | Secret used to sign login tokens (required) |
| `JWT_EXPIRES_IN` | `7d` | How long a login lasts |
| `OPENAI_API_KEY` | — | Optional. Lets auto-fill ask OpenAI for words not in the library |
| `OPENAI_MODEL` | `gpt-4o-mini` | Model used for auto-fill |
| `AUTOFILL_DAILY_LIMIT` | `3` | Auto-fills per user per day that go to OpenAI / online dictionaries (answers from your words or the library are free) |
| `APP_TIMEZONE` | `Asia/Ho_Chi_Minh` | Time zone for the daily limit reset and course days |
| `COURSE_AI_DAILY_LIMIT` | `30` | Words per user per day that a course owner can generate with AI (library words are free) |

## Accounts

- Register / log in with email + password; the API returns a JWT (`accessToken`).
- Send it as `Authorization: Bearer <token>` on every other request. Without it the API returns 401.
- Passwords are hashed with scrypt (Node's built-in `crypto`); they are never returned.
- Every word, category, tag and setting belongs to one user. Users can't see or change each other's data.
- Login and register are rate-limited (10 and 5 requests per minute per IP).
- New accounts start with an empty vocabulary and save words from the library. (Upgrade note: vocabulary saved before accounts existed is given to the first account that registers.)

## Endpoints (prefix `/api`)

| Method | Path | |
|---|---|---|
| POST | `/auth/register` | `{ name, email, password }` → `{ accessToken, user }` (public) |
| POST | `/auth/login` | `{ email, password }` → `{ accessToken, user }` (public) |
| GET / PATCH / DELETE | `/auth/me` | Current user / rename `{ name }` / delete account and all its data |
| POST | `/auth/change-password` | `{ currentPassword, newPassword }` |
| GET | `/health` | `{ ok, db }` (public) |
| GET | `/bootstrap` | Your words, categories, tags, settings and progress in one call |
| GET / POST | `/words` | List (newest first) / create |
| GET / PATCH / DELETE | `/words/:id` | |
| POST | `/words/:id/review` | `{ rating: Again\|Hard\|Good\|Easy, practice?, day? }` — reschedules the word, updates streak |
| GET / POST | `/categories` | |
| PATCH / DELETE | `/categories/:id` | Deleting leaves its words uncategorized |
| GET / POST | `/tags` | Tag names are normalized (`#Front End` → `front-end`) |
| DELETE | `/tags/:name` | Also removes the tag from every word |
| GET | `/profile` | Settings + progress |
| PATCH | `/profile/settings` | Learning preferences (goal, direction, autoplay, examples, theme) |
| GET | `/lookup?word=` | Auto-fill: your words → library → OpenAI (if configured) → dictionaryapi.dev + MyMemory. Max 20/min per IP; going past the library uses one of the user's daily auto-fills (429 when used up). Responses include `quota: { used, limit }` |
| DELETE | `/data` | Delete your words, categories and tags (keeps the account) |
| GET | `/library` | Shared library: `?q=&topic=it\|interview\|customer\|leader\|other&level=&source=builtin\|community\|me&page=&limit=` → items, total, per-topic counts |
| GET | `/library/:id` | One library word |
| POST | `/library/:id/save` | Copy a library word into my vocabulary (tagged with its topic) |
| POST | `/library/share` | `{ wordId, topic }` — share one of my words; my name is shown as the author |
| DELETE | `/library/:id` | Remove a word I shared (only the author can) |

## Courses (30 days)

Anyone can create a course. Each day has a few words (3–10, set by the owner), taken from the library or
generated with AI; the owner can optionally add generated words to the library. Courses are **private**
(owner + people with the 6-letter join code) or **public** (listed for everyone).
Each learner starts at **day 1 on the day they join**; one more day opens every day (app time zone).
An owner can instead set a **start date** (`startDate`, YYYY-MM-DD): then day 1 is that date for everyone, nothing opens
before it, and people who join later start on the course's current day (earlier days count as late).
Learning a day marks it learned; learners choose which of its words to save to My Vocabulary (tagged with the course tag).

| Method | Path | |
|---|---|---|
| GET | `/courses?scope=joined\|mine\|public` | Course cards (with my progress) |
| POST | `/courses` | `{ title, description?, wordsPerDay?, visibility?, startDate? }` |
| GET / PATCH / DELETE | `/courses/:id` | Detail (learners see words only for open days) / edit / delete (owner) |
| PUT | `/courses/:id/days/:day` | `{ words }` — set a day's words (owner) |
| POST | `/courses/ai-word` | `{ word }` — library entry, or AI-generated details (daily limit) |
| POST | `/courses/:id/days/:day/words/:index/library` | Add a course word to the library (owner) |
| POST | `/courses/join` / `/courses/:id/join` | Join with a code / join a public course |
| DELETE | `/courses/:id/enrollment` | Leave |
| POST | `/courses/:id/days/:day/learn` | `{ save?: string[] }` — mark an open day learned; also save the listed words to My Vocabulary (`[]` = none, left out = all) |
| POST | `/courses/:id/days/:day/words/save` | `{ words }` — save chosen words of an open day to My Vocabulary |
| GET | `/courses/:id/days/:day/homework` | The day's homework (answers only after handing in) |
| POST | `/courses/:id/days/:day/homework` | `{ answers }` — hand in once; graded on the server |
| GET | `/courses/:id/leaderboard?day=` | One day's ranking, total score, and on-time streaks (real names) |
| POST | `/courses/:id/days/:day/warmup/done` | `{ correct?, total? }` — mark the warm-up finished (shown in `enrollment.warmedUp`) |
| GET | `/courses/:id/days/:day/warmup` | Warm-up before the day: earlier words (missed ones first) with practice questions, and the day's recap story |
| GET | `/courses/:id/days/:day/listening` | The day's listening dialogue (practice; answers included) with a word bank, or `{ dialogue: null }` |
| POST | `/courses/:id/days/:day/listening/done` | `{ correct?, total? }` — mark listening finished/skipped (`enrollment.listened`) |
| POST | `/courses/:id/days/:day/dialogue/generate` | AI writes a listening dialogue with the day's words (pending approval; daily AI limit) |
| GET | `/courses/:id/members` | Owner: everyone taking the course with progress (days learned/reviewed/listened, homework, avg/total score, late, missing, streak, last activity) |
| GET | `/courses/:id/members/:userId` | Owner: one member's day-by-day progress |
| DELETE | `/courses/:id/members/:userId` | Owner: remove someone (their homework goes too) |
| GET | `/courses/:id/questions?day=` | Question bank: tense questions and recaps with their status (owner) |
| POST | `/courses/:id/days/:day/questions/generate` | `{ tenses?, perWord? }` — AI writes tense questions + a recap (pending approval; uses the daily AI limit) |
| POST | `/courses/:id/days/:day/questions` | Add a question / recap by hand (approved) |
| PATCH / DELETE | `/courses/:id/questions/:qid` | Edit (incl. `status`) / delete |
| POST | `/courses/:id/days/:day/questions/import` | `{ items }` — import typed / multiple-choice tense questions (rows from CSV/JSON: `type` typed|multi, `word`, `tense?`, `sentence`, `answer`, `choice1–4` or `choices`, `accept?` (a|b), `explain?`); approved; bad rows are returned in `errors` |
| POST | `/courses/:id/questions/status` | `{ ids, status: approved\|rejected\|pending }` |

### Homework

Each open day has homework, the same for every learner: two questions per new word (pick the meaning or the word,
then type it or fill the gap in the example) and one question each for a few words from earlier days.
It's graded on the server and can be handed in once. Late homework keeps part of its score:
on the day **100%**, 1 day late **80%**, 2 days **60%**, 3+ days **50%**. Ties on a day's board go to the faster learner
(time from opening the homework to handing it in). A streak counts days in a row handed in on time.

### Tense questions, recap and warm-up

The owner can have AI write **tense exercises** for a day's words (present simple / continuous / perfect, past simple /
continuous, will, going to; typed or multiple choice, with a Vietnamese explanation) and a short **recap story** using
earlier days' words. AI-written items wait for the owner's approval; only approved ones are used. Up to 4 tense
questions about the day's words and 2 about review words go into the homework (made when the first learner opens it,
fixed after the first hand-in). When AI isn't available, verbs get built-in template questions instead.
Before each day, learners get a **warm-up**: the recap story and practice questions on earlier words, starting with
the words they got wrong in earlier homework (not graded).

### Listening

Each day can have one approved **listening dialogue** (bank kind `dialogue`, created by hand/import with
`{ kind: 'dialogue', data }` or by AI): `data = { title, scenario, speakers: [{ name, gender }] ×2, lines: [{ s: 0|1, text, vi }],
questions: [{ question, choices ×4, answer, explain }] }`. Blanks are written in a line as `[[word]]` or `[[said form|word]]`.
Learners listen (device text-to-speech, one voice per speaker), fill the blanks from a word bank or by typing, and answer
the comprehension questions. It's practice only (not graded) and can be skipped.

## Notifications

In-app notifications, created when the user opens the app (no push or background jobs yet). Checking (at most once a
minute per user, app time zone) creates whatever is missing, once each (unique key per user):
day open, homework due tonight (after 18:00), streak about to end (after 20:00, streak ≥ 3), late homework (last 3 days,
with the % kept), course starting tomorrow, words due for review; for owners: items waiting for approval and days without
words a learner reaches within 2 days. Events add notifications right away: someone joined your course (grouped per day),
you were removed from a course, someone saved your shared library word (grouped per day). Users can turn types off with
`settings.mute`. Notifications are kept for 60 days.

| Method | Path | |
|---|---|---|
| GET | `/notifications?limit=&before=` | Newest first (checks for new ones first) → `{ items, hasMore, unread }` |
| GET | `/notifications/unread` | `{ unread }` (checks for new ones first) |
| POST | `/notifications/read` | `{ ids }` or `{ all: true }` → `{ unread }` |
| DELETE | `/notifications/:id` | |

## Grammar

Two groups of lessons (theory in Vietnamese, examples and drills in English; content in `src/grammar/content/<id>.json`):

- **Foundations: helping verbs** — `be`, `do`, `have`, `agreement` (subject–verb agreement): conjugation tables by
  subject × present / past / future, uses, common mistakes, 40 drills each; plus `aux-cheatsheet` (helping verbs in each
  tense, no drills).
- **Tenses** — present simple / continuous / perfect, past simple / continuous, will, going to: formula (with the helping
  verb by subject and a link to its Foundations lesson), uses, signal words, common mistakes, a comparison with a
  neighbouring tense, 40 drills each (a few contrast it with the neighbouring tense).

Practice is graded on the server; mastery per lesson (0–100) comes from the last 20 answers (at least 10 needed for 100%).

| Method | Path | |
|---|---|---|
| GET | `/grammar` | The lessons (with `group`) and my mastery |
| GET | `/grammar/:id` | One lesson (no drills) |
| GET | `/grammar/practice?mode=<lesson>\|mix\|mix-tenses\|mix-foundations&n=10` | Questions (no answers). One lesson: easier first while mastery is low; mixes: weaker lessons more often; recent drills avoided |
| POST | `/grammar/practice` | `{ answers: [{ id, answer }] }` → results (answer, explanation, tense), score, new mastery |

## Vocabulary library

A shared collection every user can browse. On first start it is filled with 500 built-in
words (IT, interview, customer meetings, leader meetings) from `src/library/seed/library.json`.
That file is built from the per-topic lists with `node scripts/build-library-seed.js`
(validates entries and removes words that appear in more than one topic).
Each word appears once in the library (case-insensitive); users' own words stay private
until they choose to share them.

Dates are returned as epoch milliseconds.

## Collections

`users`, `words`, `categories`, `tags`, `profiles` in the `English` database.
