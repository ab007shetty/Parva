# Setting up Parva

Start to finish, this takes about fifteen minutes. Ten of them are Google's
OAuth screen.

There are four things to do:

1. [Create an Appwrite project](#1-appwrite-project)
2. [Run the setup script](#2-run-the-setup-script)
3. [Enable Google sign-in](#3-google-sign-in)
4. [Make yourself an administrator](#4-make-yourself-an-administrator)

---

## Before you start

- **Node 20.9 or newer.** Check with `node -v`.
- **An Appwrite project.** Either [Appwrite Cloud](https://cloud.appwrite.io)
  (free tier is enough to run this) or a self-hosted instance on 1.8 or newer.
  The app uses Appwrite's TablesDB API, which arrived in 1.8.

```bash
cd parva
npm install
```

---

## 1. Appwrite project

In the Appwrite console:

1. **Create a project.** Any name.

2. **Copy the endpoint and project ID.** Both are on **Settings** for the
   project. Appwrite Cloud endpoints are region-specific, so read the value
   rather than assuming — it looks like `https://fra.cloud.appwrite.io/v1` or
   `https://nyc.cloud.appwrite.io/v1`. Self-hosted is
   `https://your-domain.com/v1`.

3. **Create an API key.** **Overview → Integrations → API keys → Create API
   key**. Give it these scopes:

   | Group     | Scopes                                                    |
   | --------- | --------------------------------------------------------- |
   | Databases | `databases.read` `databases.write`                        |
   | Tables    | `tables.read` `tables.write`                              |
   | Columns   | `columns.read` `columns.write`                            |
   | Indexes   | `indexes.read` `indexes.write`                            |
   | Rows      | `rows.read` `rows.write`                                  |
   | Storage   | `buckets.read` `buckets.write` `files.read` `files.write`  |
   | Tokens    | `tokens.write` — optional, see below                      |
   | Auth      | `users.read` `users.write` `sessions.write` `targets.read` |

   Copy the secret when it is shown. Appwrite will not show it again.

   **`tokens.write` is worth adding.** With it, a reader's browser streams a
   book straight from Appwrite and none of the traffic touches your app. Without
   it, Parva relays the bytes through `/api/book-stream` instead — identical
   behaviour for the reader, including the byte-range requests that let a large
   scan open on its first page, but the traffic passes through your own hosting.
   Nothing breaks either way; the app detects which it has and says so in the
   dev server log.

4. **Add a Web platform.** **Settings → Platforms → Add platform → Web**. Add
   `localhost` now, and your production hostname when you deploy. Appwrite
   refuses OAuth redirects to hostnames that are not registered here, so
   forgetting this is the most common reason sign-in fails.

Now fill in the blanks in `.env`:

```ini
NEXT_PUBLIC_APPWRITE_ENDPOINT=https://fra.cloud.appwrite.io/v1
NEXT_PUBLIC_APPWRITE_PROJECT_ID=your-project-id
APPWRITE_API_KEY=your-api-key-secret
NEXT_PUBLIC_SITE_URL=http://localhost:3000
```

Leave the `APPWRITE_DATABASE_ID` and bucket variables as they are — the setup
script uses exactly those names, and leaves `APPWRITE_COVERS_BUCKET_ID` blank on
purpose (see below).

---

## 2. Run the setup script

```bash
npm run setup
```

This creates the database, seven tables with their columns and indexes, and the
storage bucket. It prints a line per resource.

It is **safe to run again**. Anything that already exists is skipped, so it also
serves as a migration when you pull a version that adds a column.

If it warns that a table's indexes were skipped, wait a minute and run it again.
Appwrite builds columns asynchronously, and an index cannot be created until
every column it covers is ready.

### What it creates

| Table          | What it holds                                          |
| -------------- | ------------------------------------------------------ |
| `books`        | The catalogue. Public read, admin write.               |
| `users`        | A profile mirror, so the admin can see who signed in.  |
| `progress`     | Where each reader is in each book.                     |
| `bookmarks`    | Saved positions with an optional note.                 |
| `favorites`    | Kept books.                                            |
| `highlights`   | Marked passages and their notes.                       |
| `reading_days` | One row per reader per day, for streaks and the graph.  |

Everything except `books` and `users` has **row security on**, and each row is
written with owner-only permissions. That means Appwrite itself refuses to let
one reader see another's bookmarks — it does not depend on the app getting a
query filter right.

One bucket, `parva_books`, **private**:

- Book files are never public. They reach a reader either through a
  short-lived signed token or relayed by `/api/book-stream`, depending on
  whether the API key has `tokens.write`.
- Covers live in the same bucket and are served through `/api/cover/[id]`, which
  reads them with the API key — so nothing is publicly listable.

Appwrite Cloud's free plan allows exactly **one bucket per project**, which is
why covers share it rather than getting their own. Set
`APPWRITE_COVERS_BUCKET_ID` to a different id on a plan with room, and setup will
create a separate one.

Note that on a project which already holds books, setting that variable is not
enough on its own: the existing cover files are physically in the books bucket,
so the app would start looking for them somewhere they are not. Splitting an
existing install means moving those files too.

Free plans are also capped at **one database**. If your project already has one,
setup adopts it instead of failing — Parva's tables are namespaced by their own
ids and sit alongside anything else in there.

### How large a book can be

This is set by your Appwrite instance, not by Parva:

| Where you run Appwrite | Largest single file    | Total storage |
| ---------------------- | ---------------------- | ------------- |
| Cloud — Free           | ~**30 MB** in practice | 2 GB          |
| Cloud — Pro            | up to **5 GB**         | 150 GB        |
| Self-hosted            | `_APP_STORAGE_LIMIT`, **30 MB** by default | your disk |

> Appwrite's pricing page lists 50 MB for the free plan, but a real free project
> rejected 50 and accepted 30. Do not trust a number here — the script probes for
> the true value and prints it.

`npm run setup` does not guess. It asks for the largest size it can and steps
down until Appwrite accepts one, then prints what you actually got:

```
✓ Bucket "parva_books" (private) — files up to 30 MB
```

The upload form then reads that number back off the bucket, so it rejects an
oversized file immediately with the real limit in the message rather than letting
the upload run and fail.

**To raise it:** on Cloud, upgrade the plan. Self-hosted, set
`_APP_STORAGE_LIMIT` (in bytes) in *Appwrite's own* `.env` — the one next to its
`docker-compose.yml`, not Parva's — and restart it. Either way, delete the
`parva_books` bucket afterwards and re-run `npm run setup` so it picks up the new
ceiling; an existing bucket keeps whatever it was created with.

For context: most EPUBs are 1–5 MB and a typical text PDF is 2–20 MB, so 30 MB
still covers most books. Large scanned or image-heavy PDFs are what run past it.

Free-tier bandwidth is worth a thought too: 5 GB/month is roughly 150 reads of a
30 MB scan — fine for a private library, tight for a public one. That quota is
Appwrite's, and it is spent either way, since the bytes leave Appwrite whether
the reader fetches them directly or they are relayed through the app.

---

## 3. Google sign-in

Reading needs no account, so this is only needed for bookmarks, favourites and
"where you left off". You can skip it and come back.

### In Google Cloud Console

1. Create or pick a project at
   [console.cloud.google.com](https://console.cloud.google.com).
2. **APIs & Services → OAuth consent screen.** Fill it in. "External" is fine.
   While it is in Testing, add your own address under **Test users**.
3. **APIs & Services → Credentials → Create credentials → OAuth client ID**,
   type **Web application**.
4. Under **Authorised redirect URIs**, add the URI Appwrite gives you. It is
   shown in the Appwrite console when you open the Google provider, and looks
   like:

   ```
   https://fra.cloud.appwrite.io/v1/account/sessions/oauth2/callback/google/YOUR_PROJECT_ID
   ```

   Copy it from Appwrite rather than typing it — the region and project ID both
   have to match exactly.

5. Copy the **client ID** and **client secret**.

### In Appwrite

**Auth → Settings → Google →** toggle on, paste the client ID and secret, save.

That is all. Parva needs no extra configuration for OAuth; the redirect URLs it
uses are derived from `NEXT_PUBLIC_SITE_URL`.

> **Deploying?** Set `NEXT_PUBLIC_SITE_URL` to your real origin and add that
> hostname under **Settings → Platforms** in Appwrite. The Google redirect URI
> does not change — it points at Appwrite, not at your app.

---

## 4. Make yourself an administrator

Administrators are made from the command line, never through the app. There is
no sign-up form and no "make me an admin" button, which is the point: the admin
label lives on the Appwrite account and only the API key can set it.

**The easy path** — sign in with Google once at `/sign-in`, then:

```bash
npm run make-admin -- you@example.com "Your Name"
```

That promotes the account that already exists. Sign out and back in for the
label to take effect.

**Without Google** — the same command creates an account and prints a generated
password:

```bash
npm run make-admin -- you@example.com "Your Name"
```

Then sign in at `/sign-in` under **Administrator sign-in**. You can set the
password yourself with `--password "at-least-8-chars"`, and remove admin rights
with `--demote`.

---

## Run it

```bash
npm run dev
```

Open <http://localhost:3000>, go to `/admin/books/new`, and drop a PDF or EPUB
on the page. Its title, author and cover are read out of the file, so most books
need nothing else typed. Publish it and it is on the shelf.

---

## Deploying

### Vercel

1. Push the repo to GitHub and import it at
   [vercel.com/new](https://vercel.com/new). Framework detection handles the
   build settings; `vercel.json` is already in the repo.

2. Add the environment variables from `.env`, with
   `NEXT_PUBLIC_SITE_URL` set to your real domain (no trailing slash).

3. Add that domain under **Settings → Platforms** in Appwrite.

Book files never pass through a Vercel function — the browser uploads straight
to Appwrite, and the reader streams straight from it — so the platform's request
body limit is not a constraint on how large a book can be.

### Anywhere that runs Node

```bash
npm ci
npm run build
npm start
```

`npm start` serves on port 3000. Put it behind your usual reverse proxy. Nothing
in the app requires Vercel.

### Docker

There is no Dockerfile in the repo, because the build is a plain Next.js
standalone build. If you want one, `node:22-alpine`, `npm ci`, `npm run build`,
`npm start` is the whole recipe — just remember `npm run postinstall` copies the
pdf.js assets into `public/`, so run it after `npm ci` if you skip lifecycle
scripts.

---

## Troubleshooting

**`Project with the requested ID could not be found`**
The endpoint and project ID disagree. Appwrite Cloud is region-specific — check
that `NEXT_PUBLIC_APPWRITE_ENDPOINT` matches the region your project is in.

**Setup says the API key was rejected (401)**
The key is missing a scope. The table above lists all of them; `columns.write`
and `indexes.write` are the two people usually miss.

**Google sign-in returns to `/sign-in?error=google`**
Either the hostname is not registered under **Settings → Platforms** in
Appwrite, or the redirect URI in Google Cloud does not match the one Appwrite
shows, character for character.

**Google sign-in returns `error=config`**
The Google provider is not enabled in Appwrite, or its client ID and secret are
blank.

**A book opens, then fails with "the link may have expired"**
Signed file URLs last four hours. Reloading mints a new one. If it happens
immediately, the API key is missing `files.read`.

**Covers do not appear, or a cover upload is rejected**
The bucket has to accept image types and have transformations enabled. Re-running
`npm run setup` reconciles both on an existing bucket and says so:

```
✓ Updated "parva_books" — now accepts jpg, jpeg, png, webp, avif, gif
```

If it instead reports that covers are separate, `APPWRITE_COVERS_BUCKET_ID` is
set in `.env`. Blank it unless you really have a second bucket.

**Setup says the plan allows no more databases or buckets**
Not a problem — it adopts the existing database and shares the one bucket. Only
an error if it also says it could not find *any* database, which means you need
to create one in the console first.

**The admin dashboard says the database is not set up**
`npm run setup` has not run successfully against this project.

**PDFs fail to render after a dependency change**
`npm run postinstall` copies the pdf.js worker and its wasm decoders into
`public/pdfjs/`. That directory is gitignored, so it has to exist locally. Run
`npm install` again.
