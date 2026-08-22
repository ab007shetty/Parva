# Parva

A reading room. Every book opens straight into a full-screen reader — two pages
side by side, the way a book actually reads — with no account and no waiting.
Sign in and it starts keeping your place, your bookmarks and the passages you
marked.

Built with Next.js 16, React 19, Tailwind CSS 4 and Appwrite. PDF rendering is
pdf.js directly; EPUB is epub.js. Motion is GSAP with Lenis.

**[Setup instructions →](SETUP.md)** — about fifteen minutes.

```bash
npm install
# fill in the four blanks in .env — see SETUP.md
npm run setup                # provisions Appwrite
npm run make-admin -- you@example.com "Your Name"
npm run dev
```

---

## What it does

### Reading

- **PDF and EPUB**, in one reader with one set of controls. A reader should not
  have to know which format a book is in.
- **Two-page spread** with a gutter shadow, so it reads as one bound book rather
  than two images. Also single page and continuous scroll.
- **Page turns** that pivot about the gutter, where a real book has its spine.
- **Four tones** — paper, sepia, dusk, night. For PDFs these are applied during
  rasterisation via pdf.js `pageColors`, not as a CSS filter, so photographs and
  diagrams stay readable instead of inverting into negatives.
- **Zoom and fit** — whole page, fit width, actual size, or free zoom. Pinch
  works on touch.
- **Typography for EPUB** — four reading faces including
  [Atkinson Hyperlegible](https://www.brailleinstitute.org/freefont/), designed
  for low vision; text size, line spacing, margins, justification.
- **Search inside a book.** Streams results as it scans and starts from the page
  you are on, so nearby matches appear first. Cancels the moment you keep
  typing.
- **Contents** from the PDF outline or the EPUB navigation, with destinations
  resolved to real page numbers.
- **Page thumbnails**, rasterised as they scroll into view rather than all at
  once.
- **Read aloud** using the device's own speech voices — no key, no upload, works
  offline. Splits on sentences so pause, resume and skip behave.
- **Keyboard throughout.** Arrows, space, PageUp/Down, Home/End, `B` bookmark,
  `T` contents, `S` search, `M` bookmarks, `G` settings, `F` full screen, `±`
  zoom, `?` for the list.
- **Swipe** to turn on touch — strict enough that pinching or scrolling never
  turns a page by accident.
- **Chrome that gets out of the way**, leaving only the progress hairline.

### Keeping your place

- **Where you left off**, offered rather than forced: a quiet pill says where you
  stopped and you can ignore it. Saved to Appwrite when signed in, and to
  `localStorage` always — so it works signed out and survives a failed request.
- **Bookmarks** with a note, labelled automatically from the text at that point,
  so a list of bookmarks reads like a trail rather than a column of numbers.
- **Highlights** in three colours, with notes.
- **Favourites**, and a **finished** shelf.
- **Reading stats** — time read, books finished, a current streak, and half a
  year of reading days as a monochrome strip.
- **Deep links.** `?p=84` opens a PDF at page 84; the same parameter carries an
  EPUB CFI. Sharing a passage works.
- **Offline reading.** Opt in per book and the file is stored in IndexedDB, with
  a size cap and least-recently-opened eviction. Installable as a PWA.

### The catalogue

- **Search** across titles and authors, diacritic-insensitive — "Gita" finds
  "Gītā" — in a command palette on `/` or `⌘K`.
- **Filters** for author, subject, language, format and year, with real counts,
  all as URL parameters so a filtered view is a shareable link.
- **Authors index** grouped by initial.
- **Series** awareness, and related books that fall back from series to author
  to subject so a book page is never a dead end.

### Administration

- **Drop a file.** Title, authors, publisher, language, ISBN, description, page
  count and cover are read out of the PDF or EPUB in the browser before upload,
  so most books need nothing typed.
- **Covers generated** from a PDF's first page or an EPUB's embedded cover. A
  book with neither gets a typographic cover set from its title.
- **Direct uploads.** The browser uploads straight to Appwrite with a
  short-lived admin token, chunked with real progress — so a 200 MB scan is not
  limited by a serverless request body.
- **Drafts**, featuring, and per-book download permission.
- **Reader list** — who signed in and when. Deliberately not what they are
  reading.

---

## Design

The brief was a perfect-white theme, and on pure white there is nowhere to hide:
the design lives entirely in typography, rule weight, negative space, and the
covers themselves.

So the thesis is a **white-cube gallery for books**. The chrome is strictly
monochrome and the covers supply all the colour. The only two non-neutral tokens
are *material* rather than brand — a silk-ribbon red used for bookmarks and
nothing else, a highlighter yellow used for highlights and search hits and
nothing else. Each book also contributes its own extracted cover colour as a
`--bloom` custom property, so the accent is borrowed from the collection instead
of invented for it.

The signature is **physicality against a flat ground**. A book renders as an
object with mass: a darkened spine down the binding edge, stacked page-edge
hairlines on the fore-edge, and a contact shadow that deepens as it tilts off
the wall on hover. Covers keep their true aspect ratios rather than being
cropped to a uniform grid, and rows align to hairline shelf rules that draw
themselves in on load — so a shelf has the ragged top edge a real one has.

Type is three faces with three jobs. **Fraunces** carries the voice, set sharp
(`SOFT 0`, `WONK 1`) rather than friendly. **Archivo** is the interface, holding
up at 11px in labels and dense tables. The reading faces load only on `/read`
routes, because a visitor browsing the catalogue should not pay for fonts they
will never see.

---

## How it is put together

```
src/
  app/
    (pages)              home, library, book, authors, sign-in, me, admin
    read/[id]/           the reader, with its own font layout
    api/                 auth, catalogue, reader data, admin, file signing
  components/
    books/               the book object, shelves, grid, filters
    reader/              engines, chrome, panels
    chrome/              header, footer, command palette
    admin/               upload desk
    me/                  stats, settings, offline list
  lib/
    appwrite/            server clients, data access, file signing
    reader/              pdf + epub engines, store, offline, speech
    admin/               upload and metadata extraction
scripts/
  setup-appwrite.mjs     provisions everything, idempotent
  make-admin.mjs         creates or promotes an administrator
  copy-pdf-assets.mjs    copies pdf.js worker + wasm to public/ on install
  generate-favicon.mjs   redraws favicon.ico from the same mark as app/icon.tsx
```

### Decisions worth knowing about

**pdf.js directly, not a wrapper.** A component library would be less code, but
the spread needs canvas-level control: matched page heights across the gutter so
the gutter stays straight, high-DPI rasterisation with a cap, a text layer
aligned to the exact render scale, and cancellation when someone holds the arrow
key down. All of that *is* the feature, so the abstraction would be in the way.
It also sidesteps a real trap — `react-pdf@10` pins `pdfjs-dist@5`, and mixing
that with pdfjs 6 produces the classic API/worker version mismatch.

**One private bucket, and covers go through the app.** Appwrite Cloud's free
plan allows a single bucket per project, so books and covers share one — private,
with covers served by `/api/cover/[id]` reading them with the API key. Nothing is
publicly listable, and it works identically on every plan.

**Book files are signed, not proxied.** The reader gets a short-lived Appwrite
file token and streams from Appwrite directly. Piping a 200 MB scan through a
route handler would mean paying for the bandwidth twice and losing HTTP Range
support — which is exactly what lets pdf.js paint page one before the rest of
the file arrives. The bucket stays private; the URL expires on its own.

**Uploads go browser → Appwrite.** Serverless request bodies are capped far
below a large book. The server mints a short-lived JWT scoped to the signed-in
administrator, and Appwrite's own 5 MB chunking handles the size and progress.

**Two server clients, named at every call site.** `createSessionClient()` acts as
the signed-in reader, so Appwrite's row permissions apply and a reader cannot
touch another's data even if a route handler forgot to check. `createAdminClient()`
uses the API key and bypasses them. Getting these backwards is the one mistake
that turns a private bookmark public, so the distinction is explicit rather than
ambient.

**Admin rights are an Appwrite label**, set only by the API key from the command
line. Unlike a row field or a cookie flag, there is no path through the app by
which someone grants it to themselves.

**Reading settings are per device; reading position is per account.** How large
you like your type is a property of where you are reading. Where you stopped is
a property of you and the book. They are stored accordingly.

**Lenis is off inside the reader.** A book pages itself, and inertial scroll
there would feel like the page sliding out from under your thumb. Panels and the
reader viewport are marked `data-lenis-prevent`.

---

## Scripts

| Command                                        | What it does                                     |
| ---------------------------------------------- | ------------------------------------------------ |
| `npm run dev`                                  | Development server                               |
| `npm run build` / `npm start`                  | Production build and serve                       |
| `npm run typecheck`                            | `tsc --noEmit`                                   |
| `npm run lint`                                 | ESLint, including the React Compiler rules       |
| `npm run setup`                                | Provision Appwrite. Safe to re-run.              |
| `npm run make-admin -- email "Name"`           | Create or promote an administrator               |
| `npm run make-admin -- email --demote`         | Remove admin rights                              |
| `npm run favicon`                              | Regenerate favicon.ico after changing the brand mark |

---

## Accessibility

Not a checklist item — the reader is the whole product, so it has to work.

- Every PDF gets pdf.js's text layer, which is what makes selection, search,
  read-aloud and screen readers work at all on a page image.
- Atkinson Hyperlegible is offered as a reading face.
- `prefers-reduced-motion` is honoured in CSS, in every GSAP timeline via
  `gsap.matchMedia()`, and natively by Lenis.
- One focus treatment across the app: a square ink ring, always visible.
- Full keyboard navigation, with a discoverable shortcut list on `?`.
- Live regions are `polite`, so a saved bookmark never interrupts a screen
  reader mid-sentence.
- Read-aloud runs on the device's own voices, so it works offline and sends
  nothing anywhere.

---

## Notes

The folder is `parva`; the app name lives in one constant. To change it, edit
`APP_NAME` in [`src/lib/config.ts`](src/lib/config.ts) — metadata, the manifest,
the header wordmark and the footer all read from there.

## Licence

Yours. The books are your responsibility — Parva does not check what you upload,
so make sure you have the right to publish it.
