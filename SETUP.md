# Setting up Parva

About fifteen minutes, and ten of those are Google's OAuth screen. You need
**Node 20.9+** and an **Appwrite** project — [Cloud](https://cloud.appwrite.io)
free tier is enough, or self-hosted on 1.8 or newer (the app uses TablesDB,
which arrived in 1.8).

```bash
npm install     # also copies the pdf.js worker into public/pdfjs
```

---

## 1. Appwrite project

In the Appwrite console:

**Create a project**, then copy the **endpoint** and **project ID** from
**Settings**. Cloud endpoints are region-specific — read the value rather than
assuming (`https://fra.cloud.appwrite.io/v1`, `https://sgp.cloud.appwrite.io/v1`,
…).

**Create an API key** at **Overview → Integrations → API keys**, with these
scopes:

| Group     | Scopes                                                     |
| --------- | ---------------------------------------------------------- |
| Databases | `databases.read` `databases.write`                         |
| Tables    | `tables.read` `tables.write`                               |
| Columns   | `columns.read` `columns.write`                             |
| Indexes   | `indexes.read` `indexes.write`                             |
| Rows      | `rows.read` `rows.write`                                   |
| Storage   | `buckets.read` `buckets.write` `files.read` `files.write`   |
| Auth      | `users.read` `users.write` `sessions.write` `targets.read`  |
| Tokens    | `tokens.write` — optional, see below                       |

Copy the secret when shown; Appwrite will not show it again. `columns.write` and
`indexes.write` are the two people usually miss.

> **`tokens.write` is worth adding.** With it, a reader's browser streams a book
> straight from Appwrite and none of that traffic touches your app. Without it,
> Parva relays the bytes through `/api/book-stream` — identical for the reader,
> byte-range requests included, but the traffic goes through your hosting.
> Nothing breaks either way; the app detects which it has.

**Add a Web platform** at **Overview → Platforms → Add platform → Web**. Add
`localhost` now and your production hostname when you deploy. Appwrite blocks
browser requests and OAuth redirects from hostnames that are not registered
here, and this is the single most common reason sign-in or uploads fail.

Now fill in `.env`:

```ini
NEXT_PUBLIC_APPWRITE_ENDPOINT=https://fra.cloud.appwrite.io/v1
NEXT_PUBLIC_APPWRITE_PROJECT_ID=your-project-id
APPWRITE_API_KEY=your-api-key-secret
NEXT_PUBLIC_SITE_URL=http://localhost:3000
```

Leave `APPWRITE_DATABASE_ID`, `APPWRITE_BOOKS_BUCKET_ID` and
`NEXT_PUBLIC_MAX_BOOK_MB` as they ship, and leave `APPWRITE_COVERS_BUCKET_ID`
blank — the free plan allows one bucket, so covers share the books bucket and
are served through `/api/cover/[id]`.

---

## 2. Provision it

```bash
npm run setup
```

Creates the database, seven tables with their columns and indexes, and the
storage bucket — printing a line per resource. **Safe to run again:** anything
that already exists is skipped, so it doubles as a migration when you pull a
version that adds a column.

If it says a table's indexes were skipped, wait a minute and run it again.
Appwrite builds columns asynchronously and an index cannot be created until its
columns are ready.

| Table          | Holds                                                 |
| -------------- | ----------------------------------------------------- |
| `books`        | The catalogue. Public read, admin write.              |
| `users`        | A profile mirror, so admins can see who signed in.    |
| `progress`     | Where each reader is in each book.                    |
| `bookmarks`    | Saved positions with an optional note.                |
| `favorites`    | Kept books.                                           |
| `highlights`   | Marked passages and their notes.                      |
| `reading_days` | One row per reader per day, for streaks and the graph. |

Everything except `books` and `users` has **row security on**, with each row
written owner-only — so Appwrite itself refuses to let one reader see another's
bookmarks, rather than it depending on the app getting a query filter right.

**File size** is set by your Appwrite instance, not by Parva. Cloud's free plan
refuses anything over **50,000,000 bytes** (a decimal number — 50 MiB is over
the line and gets rejected); self-hosted uses `_APP_STORAGE_LIMIT`, 30 MiB by
default. Setup asks for the largest it can and steps down until one is accepted,
then prints what you got:

```
✓ Bucket "parva_books" (private) — files up to 47.7 MiB (50000000 bytes)
```

To raise it later, set `NEXT_PUBLIC_MAX_BOOK_MB` higher and re-run `npm run
setup` — it will raise an existing bucket, never lower it. On Cloud that means
upgrading the plan first.

---

## 3. Google sign-in

**Google Cloud Console** → create an OAuth 2.0 Web client. For the authorised
redirect URI, use the one **Appwrite shows you** on its Google provider screen —
it points at Appwrite, not at your app, and does not change between local and
production.

**Appwrite** → **Auth → Settings → Google** → toggle on, paste the client ID and
secret, save.

---

## 4. Make yourself an administrator

Admin rights are an `admin` label on the Appwrite account — set server-side
only, so nobody can grant it to themselves. There is no sign-up form and no
"make me an admin" button.

1. Sign in once at `/sign-in` so the account exists (Google, or create the user
   in the console and use **Administrator sign-in**).
2. Console → **Auth → Users** → select the user → **Labels** → add `admin`.
3. Sign out and back in for it to take effect.

Removing the label removes the rights, from the next sign-in.

---

## 5. Run it

```bash
npm run dev
```

Open <http://localhost:3000>, go to `/admin/books/new`, and drop a PDF or EPUB
on the page. Title, author and cover are read out of the file, so most books
need nothing typed.

---

## Scripts

Only two, both in `scripts/`:

| Command             | What it does                                                                                              |
| ------------------- | --------------------------------------------------------------------------------------------------------- |
| `npm run setup`     | `scripts/setup-appwrite.mjs` — provisions the database, tables, indexes and bucket. Idempotent; also your migration step. |
| `npm install`       | Runs `scripts/copy-pdf-assets.mjs` via `postinstall` — copies the pdf.js worker, cmaps, fonts and wasm decoders into `public/pdfjs/`. |

`public/pdfjs/` is gitignored because it is generated. **If PDFs stop
rendering, run `npm install` again** — that directory has to exist locally, and
a fresh clone has no copy of it.

Both read configuration from `.env` and need `APPWRITE_API_KEY`. Neither stores
anything.

Other useful commands: `npm run typecheck`, `npm run lint`, `npm run build`.

### The icons

All of them are drawn in code from one place, `src/lib/brand-mark.tsx` — a bold
"P" on a solid ink square. `app/icon.tsx` (browser tab), `app/apple-icon.tsx`
(iOS) and `app/icons/[icon]/route.tsx` (the PWA manifest sizes) render it on
request, so no size can drift from the others and there are no image binaries in
the repo.

The one exception is `src/app/favicon.ico`, which is a real file because some
crawlers request `/favicon.ico` directly instead of reading the tag Next emits.
Editing the mark means regenerating that one by hand.

The mark needs a bold weight, and `next/og` ships only a regular one — it reads
Liberation Sans Bold out of `public/pdfjs/standard_fonts/`, a file the pdf.js
copy step already puts there.

---

## Deploying

1. Push to GitHub and import at [vercel.com/new](https://vercel.com/new).
   Framework detection handles the build; `vercel.json` is already in the repo.

2. Add the `.env` variables, with **`NEXT_PUBLIC_SITE_URL` set to your real
   domain** (no trailing slash). Do not skip it: `.env` is gitignored and never
   reaches the host, so a deployment without it falls back to
   `http://localhost:3000` — which puts localhost into every canonical URL and
   the sitemap, and sends the Google sign-in redirect to a machine that is not
   the one signing in. Keep the `.env` copy pointing at localhost; that is what
   makes sign-in work while developing.

3. **Add your production hostname** under **Overview → Platforms** in Appwrite.
   Without it, browser uploads fail with a CORS error and sign-in will not
   return.

Book files never pass through a serverless function — the browser uploads
straight to Appwrite and the reader streams straight from it — so a host's
request body limit is not a constraint on book size. (Uploads under 4 MB do go
through `/api/admin/upload`; larger ones go direct, because Vercel caps a
function request body at 4.5 MB.)

Anywhere else that runs Node: `npm run build && npm start`, port 3000, same
environment variables.

---

## Troubleshooting

**`Project with the requested ID could not be found`**
Endpoint and project ID disagree — check the region in
`NEXT_PUBLIC_APPWRITE_ENDPOINT`.

**Setup says the API key was rejected (401)**
A missing scope. Usually `columns.write` or `indexes.write`.

**Setup says the plan allows no more databases or buckets**
Fine — it adopts the existing database and shares the one bucket. Only an error
if it also cannot find *any* database, in which case create one in the console.

**Upload fails with a CORS error, or 403 with no `Access-Control-Allow-Origin`**
The site's origin is not registered under **Overview → Platforms** in Appwrite.
Add it exactly, protocol included.

**Upload fails with 413 / `FUNCTION_PAYLOAD_TOO_LARGE`**
Vercel refuses request bodies over 4.5 MB. Files above 4 MB are meant to go
straight to Appwrite instead, which needs the platform registered as above.

**Google sign-in returns to `/sign-in?error=google`**
Hostname not registered in Appwrite, or the redirect URI in Google Cloud does
not match Appwrite's, character for character. `error=config` instead means the
Google provider is off, or its client ID and secret are blank.

**A book opens, then fails with "the link may have expired"**
Signed URLs last four hours; reloading mints a new one. Immediately, every time,
means the API key is missing `files.read`.

**Covers do not appear**
The bucket must accept image types. Re-running `npm run setup` reconciles that
and says so. If it reports covers are *separate*, `APPWRITE_COVERS_BUCKET_ID` is
set — blank it unless you really have a second bucket.

**The admin dashboard says the database is not set up**
`npm run setup` has not run successfully against this project.

**`fetch failed` / `EAI_AGAIN` / `ENOTFOUND` against Appwrite**
DNS on the machine, not the app or Appwrite. Catalogue reads retry four times
with a DNS nudge between each, so most of these never reach you — but if the
error is frequent, check what is answering:

```bash
node -e "console.log(require('dns').getServers())"
```

If that prints `127.0.0.1`, something local is proxying DNS — a VPN client, an
ad-blocker, or antivirus web filtering — and dropping requests intermittently.
Confirm by comparing:

```bash
node -e "const d=require('dns');const r=new d.Resolver();r.setServers(['1.1.1.1']);
r.resolve4('cloud.appwrite.io',(e,a)=>console.log('1.1.1.1:',e?e.code:a.length+' addrs'));
d.lookup('cloud.appwrite.io',(e,a)=>console.log('system :',e?e.code:'ok'))"
```

A public resolver answering while the system one fails means the local proxy is
the problem. Point the adapter's DNS at `1.1.1.1` or `8.8.8.8` (or pause
whatever is intercepting) and the errors stop. Retrying in the app only hides
this; it cannot fix a resolver that will not answer.
