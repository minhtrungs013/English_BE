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
| `APP_TIMEZONE` | `Asia/Ho_Chi_Minh` | Time zone for the daily limit reset |

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
