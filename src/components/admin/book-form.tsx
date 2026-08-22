'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { FileUp, Loader2, Trash2, Wand2 } from 'lucide-react';

import { AuthorsField } from '@/components/admin/authors-field';
import { Select } from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import { toast } from '@/components/ui/toast';
import { ACCEPTED_BOOK_EXTENSIONS, BOOK_LANGUAGES, LIMITS } from '@/lib/config';
import {
  extractMetadata,
  getUploadCredentials,
  uploadFile,
  type UploadCredentials,
} from '@/lib/admin/upload';
import { cn, formatBytes, slugify } from '@/lib/utils';
import type { BookRow } from '@/types';

/**
 * The add/edit desk.
 *
 * The design goal is that most books need one action: drop the file. Title,
 * author, publisher, language, page count and cover are read out of the file
 * itself, so the form arrives pre-filled and the librarian is correcting rather
 * than transcribing.
 */

type Draft = {
  title: string;
  subtitle: string;
  authors: string;
  description: string;
  tags: string;
  language: string;
  slug: string;
  publisher: string;
  publishedYear: string;
  isbn: string;
  series: string;
  seriesIndex: string;
  featured: boolean;
  allowDownload: boolean;
  status: 'draft' | 'published';
};

const BLANK: Draft = {
  title: '',
  subtitle: '',
  authors: '',
  description: '',
  tags: '',
  language: 'en',
  slug: '',
  publisher: '',
  publishedYear: '',
  isbn: '',
  series: '',
  seriesIndex: '',
  featured: false,
  allowDownload: false,
  status: 'published',
};

function draftFromBook(book: BookRow): Draft {
  return {
    title: book.title ?? '',
    subtitle: book.subtitle ?? '',
    authors: (book.authors ?? []).join(', '),
    description: book.description ?? '',
    tags: (book.tags ?? []).join(', '),
    language: book.language ?? 'en',
    slug: book.slug ?? '',
    publisher: book.publisher ?? '',
    publishedYear: book.publishedYear ? String(book.publishedYear) : '',
    isbn: book.isbn ?? '',
    series: book.series ?? '',
    seriesIndex: book.seriesIndex != null ? String(book.seriesIndex) : '',
    featured: Boolean(book.featured),
    allowDownload: Boolean(book.allowDownload),
    status: book.status === 'published' ? 'published' : 'draft',
  };
}

export function BookForm({ book }: { book?: BookRow }) {
  const router = useRouter();
  const editing = Boolean(book);

  const [draft, setDraft] = useState<Draft>(book ? draftFromBook(book) : BLANK);
  const [file, setFile] = useState<File | null>(null);
  const [format, setFormat] = useState<'pdf' | 'epub' | null>(book?.format ?? null);

  const [cover, setCover] = useState<{ blob: Blob; ratio: number; color: string; preview: string } | null>(
    null,
  );
  // A newly chosen cover lives in `cover`; this is only the one already stored,
  // which never changes within a single edit.
  const existingCoverId = book?.coverId ?? null;
  const [pageCount, setPageCount] = useState<number | null>(book?.pageCount ?? null);

  const [reading, setReading] = useState(false);
  const [uploadPercent, setUploadPercent] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const [dragging, setDragging] = useState(false);

  const inputRef = useRef<HTMLInputElement>(null);
  const credentials = useRef<UploadCredentials | null>(null);

  /**
   * The real ceiling, read from the bucket. Until it arrives the app's own limit
   * stands in — but the bucket is the authority, because Appwrite will refuse a
   * file above its limit no matter what this form thinks.
   */
  const [maxBookBytes, setMaxBookBytes] = useState(LIMITS.bookFileBytes);
  const [maxCoverBytes, setMaxCoverBytes] = useState(LIMITS.coverFileBytes);

  useEffect(() => {
    void fetch('/api/admin/limits')
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (!data) return;
        if (data.maxBookBytes) setMaxBookBytes(data.maxBookBytes);
        if (data.maxCoverBytes) setMaxCoverBytes(data.maxCoverBytes);
      })
      .catch(() => {
        // Keep the fallback; a failed probe should not stop an upload.
      });
  }, []);

  const set = <K extends keyof Draft>(key: K, value: Draft[K]) =>
    setDraft((current) => ({ ...current, [key]: value }));

  /* ── Choosing a file ──────────────────────────────────────────── */

  const acceptFile = useCallback(
    async (picked: File) => {
      const extension = picked.name.split('.').pop()?.toLowerCase() ?? '';
      if (!ACCEPTED_BOOK_EXTENSIONS.includes(extension as 'pdf' | 'epub')) {
        toast.warn('Only PDF and EPUB files can be shelved.');
        return;
      }
      if (picked.size > maxBookBytes) {
        // Says where the limit comes from, because it is not this app's to raise.
        toast.warn(
          `That file is ${formatBytes(picked.size)}, and your Appwrite storage allows ${formatBytes(maxBookBytes)} per book.`,
        );
        return;
      }

      setFile(picked);
      setFormat(extension === 'epub' ? 'epub' : 'pdf');
      setReading(true);

      try {
        const meta = await extractMetadata(picked);

        // Only fill blanks — never overwrite something already typed.
        setDraft((current) => ({
          ...current,
          title: current.title || meta.title || '',
          authors: current.authors || meta.authors.join(', '),
          publisher: current.publisher || meta.publisher || '',
          publishedYear: current.publishedYear || (meta.publishedYear ? String(meta.publishedYear) : ''),
          language: meta.language && !current.language ? meta.language : current.language,
          isbn: current.isbn || meta.isbn || '',
          description: current.description || meta.description || '',
          slug: current.slug || slugify(meta.title || current.title || ''),
        }));

        if (meta.pageCount) setPageCount(meta.pageCount);

        if (meta.cover) {
          setCover({
            blob: meta.cover.blob,
            ratio: meta.cover.ratio,
            color: meta.cover.color,
            preview: URL.createObjectURL(meta.cover.blob),
          });
        }

        toast.done(
          meta.title
            ? `Read “${meta.title}” from the file.`
            : 'File ready. Add a title and it can go on the shelf.',
        );
      } catch {
        toast.note('Could not read details from that file. Fill them in below.');
      } finally {
        setReading(false);
      }
    },
    [maxBookBytes],
  );

  /* ── Saving ───────────────────────────────────────────────────── */

  async function save() {
    if (!draft.title.trim()) {
      toast.warn('A book needs a title.');
      return;
    }
    if (!editing && !file) {
      toast.warn('Choose a PDF or EPUB file first.');
      return;
    }

    setSaving(true);

    try {
      // Re-mints if the cached JWT is near expiry, so a slow form fill does not
      // fail at the last step.
      const creds = await getUploadCredentials(credentials.current);
      credentials.current = creds;

      // The web address is the one thing about this book guaranteed unique, so
      // files are named after it rather than after whatever the source PDF was
      // called — "the-brothers-karamazov.pdf" in the Appwrite console is worth
      // more than "download (3).pdf". Falls back to the title if the slug field
      // was somehow left blank.
      //
      // This is the slug as submitted, not necessarily the one the book ends up
      // with — a same-titled book already on the shelf makes the server append
      // "-2". The stored filename would then read one step behind the real
      // address, which is a cosmetic gap: nothing resolves a book by its
      // filename, only by fileId.
      const slugBase = draft.slug.trim() || slugify(draft.title) || 'book';

      let fileId = book?.fileId ?? null;
      let fileSize = book?.fileSize ?? null;
      let fileName = book?.fileName ?? null;

      if (file) {
        setUploadPercent(0);
        const renamed = new File([file], `${slugBase}.${format}`, { type: file.type });
        const uploaded = await uploadFile(creds, 'book', renamed, setUploadPercent);
        fileId = uploaded.fileId;
        fileSize = uploaded.bytes;
        fileName = uploaded.name;
        setUploadPercent(null);
      }

      let coverId = existingCoverId;
      if (cover) {
        // Give the cover a real filename so Appwrite's extension allow-list and
        // its image transforms both behave.
        const type = cover.blob.type || 'image/webp';
        const extension = type.split('/')[1]?.replace('jpeg', 'jpg') ?? 'webp';
        const coverFile = new File([cover.blob], `${slugBase}-cover.${extension}`, { type });
        const uploaded = await uploadFile(creds, 'cover', coverFile);
        coverId = uploaded.fileId;
      }

      const payload = {
        title: draft.title.trim(),
        subtitle: draft.subtitle.trim() || null,
        authors: draft.authors,
        description: draft.description.trim() || null,
        tags: draft.tags,
        language: draft.language || null,
        slug: draft.slug.trim() || undefined,
        publisher: draft.publisher.trim() || null,
        publishedYear: draft.publishedYear ? Number(draft.publishedYear) : null,
        isbn: draft.isbn.trim() || null,
        series: draft.series.trim() || null,
        seriesIndex: draft.seriesIndex ? Number(draft.seriesIndex) : null,
        featured: draft.featured,
        allowDownload: draft.allowDownload,
        status: draft.status,
        coverId,
        coverColor: cover?.color ?? book?.coverColor ?? null,
        coverRatio: cover?.ratio ?? book?.coverRatio ?? null,
        pageCount,
        ...(editing ? {} : { fileId, fileSize, fileName, format }),
      };

      const response = await fetch(editing ? `/api/admin/books/${book!.$id}` : '/api/admin/books', {
        method: editing ? 'PATCH' : 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
      });

      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? 'Saving failed.');

      toast.done(editing ? 'Changes saved.' : `${payload.title} is on the shelf.`);
      router.push('/admin/books');
      router.refresh();
    } catch (error) {
      toast.warn(error instanceof Error ? error.message : 'That could not be saved.');
    } finally {
      setSaving(false);
      setUploadPercent(null);
    }
  }

  const busy = saving || reading || uploadPercent !== null;

  return (
    <div className="grid gap-12 lg:grid-cols-[1fr_20rem] lg:gap-16">
      <div className="min-w-0 space-y-10">
        {/* ── The file ─────────────────────────────────────────── */}
        {!editing && (
          <section>
            <p className="label mb-4">The file</p>

            <div
              onDragOver={(e) => {
                e.preventDefault();
                setDragging(true);
              }}
              onDragLeave={() => setDragging(false)}
              onDrop={(e) => {
                e.preventDefault();
                setDragging(false);
                const dropped = e.dataTransfer.files?.[0];
                if (dropped) void acceptFile(dropped);
              }}
              className={cn(
                'flex flex-col items-center justify-center border border-dashed px-6 py-14 text-center transition-colors',
                dragging ? 'border-ink bg-wash' : 'border-rule',
              )}
            >
              {reading ? (
                <>
                  <Loader2 className="size-5 animate-spin text-graphite" strokeWidth={1.5} />
                  <p className="mt-4 text-[0.875rem]">Reading the file</p>
                  <p className="mt-1 text-[0.75rem] text-graphite">
                    Pulling out the title, author and cover
                  </p>
                </>
              ) : file ? (
                <>
                  <p className="display text-[1.125rem]">{file.name}</p>
                  <p className="mt-1.5 text-[0.75rem] text-graphite">
                    {formatBytes(file.size)} · {format?.toUpperCase()}
                    {pageCount ? ` · ${pageCount} pages` : ''}
                  </p>
                  <button
                    type="button"
                    onClick={() => {
                      setFile(null);
                      setFormat(null);
                      setCover(null);
                      setPageCount(null);
                    }}
                    className="link-rule mt-4 text-[0.75rem] text-graphite hover:text-ink"
                  >
                    Choose a different file
                  </button>
                </>
              ) : (
                <>
                  <FileUp className="size-5 text-faint" strokeWidth={1.25} />
                  <p className="display mt-4 text-[1.125rem]">Drop a PDF or EPUB here</p>
                  <p className="mt-1.5 max-w-sm text-[0.75rem] leading-relaxed text-graphite">
                    The title, author and cover are read straight out of the file, so most
                    books need nothing else typed.
                  </p>
                  <Button variant="outline" size="sm" className="mt-5" onClick={() => inputRef.current?.click()}>
                    Choose a file
                  </Button>
                </>
              )}

              <input
                ref={inputRef}
                type="file"
                accept=".pdf,.epub,application/pdf,application/epub+zip"
                className="sr-only"
                onChange={(e) => {
                  const picked = e.target.files?.[0];
                  if (picked) void acceptFile(picked);
                }}
              />
            </div>

            {uploadPercent !== null && (
              <div className="mt-4">
                <div className="h-[3px] bg-rule">
                  <div
                    className="h-full bg-ink transition-[width] duration-200"
                    style={{ width: `${uploadPercent}%` }}
                  />
                </div>
                <p className="mt-2 text-[0.75rem] text-graphite tnum">Uploading {uploadPercent}%</p>
              </div>
            )}
          </section>
        )}

        {/* ── Details ──────────────────────────────────────────── */}
        <section className="space-y-6">
          <p className="label">Details</p>

          <Field label="Title" required>
            <input
              value={draft.title}
              onChange={(e) => {
                set('title', e.target.value);
                // Keep the slug tracking the title until it is edited by hand.
                if (!editing) set('slug', slugify(e.target.value));
              }}
              className={INPUT}
            />
          </Field>

          <Field label="Subtitle">
            <input value={draft.subtitle} onChange={(e) => set('subtitle', e.target.value)} className={INPUT} />
          </Field>

          <AuthorsField value={draft.authors} onChange={(value) => set('authors', value)} />

          <Field label="Web address" hint={`Readers will see /book/${draft.slug || 'your-slug'}`}>
            <input
              value={draft.slug}
              onChange={(e) => set('slug', slugify(e.target.value))}
              className={INPUT}
            />
          </Field>

          <Field label="Description" hint="Blank lines become paragraphs.">
            <textarea
              value={draft.description}
              onChange={(e) => set('description', e.target.value)}
              rows={7}
              className={cn(INPUT, 'resize-y py-2.5 leading-relaxed')}
            />
          </Field>

          <Field label="Subjects" hint="Commas. These become the browse filters.">
            <input value={draft.tags} onChange={(e) => set('tags', e.target.value)} className={INPUT} />
          </Field>

          <div className="grid gap-6 sm:grid-cols-2">
            <div>
              <p className="label mb-2">Language</p>
              <Select
                label="Language"
                size="md"
                block
                value={draft.language}
                onChange={(value) => set('language', value)}
                options={BOOK_LANGUAGES.map((language) => ({
                  value: language.code,
                  label: language.label,
                }))}
              />
            </div>

            <Field label="Published">
              <input
                value={draft.publishedYear}
                onChange={(e) => set('publishedYear', e.target.value.replace(/[^0-9]/g, '').slice(0, 4))}
                inputMode="numeric"
                placeholder="1979"
                className={INPUT}
              />
            </Field>

            <Field label="Publisher">
              <input value={draft.publisher} onChange={(e) => set('publisher', e.target.value)} className={INPUT} />
            </Field>

            <Field label="ISBN">
              <input value={draft.isbn} onChange={(e) => set('isbn', e.target.value)} className={INPUT} />
            </Field>

            <Field label="Series">
              <input value={draft.series} onChange={(e) => set('series', e.target.value)} className={INPUT} />
            </Field>

            <Field label="Number in series">
              <input
                value={draft.seriesIndex}
                onChange={(e) => set('seriesIndex', e.target.value.replace(/[^0-9.]/g, ''))}
                inputMode="decimal"
                className={INPUT}
              />
            </Field>
          </div>
        </section>
      </div>

      {/* ── Sidebar ───────────────────────────────────────────────── */}
      <aside className="space-y-8 lg:sticky lg:top-24 lg:self-start">
        <section>
          <p className="label mb-4">Cover</p>

          <div
            className="book-object relative w-full max-w-[180px]"
            style={{ aspectRatio: `${cover?.ratio ?? book?.coverRatio ?? 0.66}` }}
          >
            {cover?.preview ? (
              // A local object URL; next/image would add nothing here.
              // eslint-disable-next-line @next/next/no-img-element
              <img src={cover.preview} alt="" className="size-full rounded-[2px] object-cover" />
            ) : existingCoverId ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={`/api/cover/${existingCoverId}?w=360`}
                alt=""
                className="size-full rounded-[2px] object-cover"
              />
            ) : (
              <div className="grid size-full place-items-center text-center text-[0.6875rem] text-mute">
                No cover yet
              </div>
            )}
            <span className="book-spine" aria-hidden="true" />
            <span className="book-edges" aria-hidden="true" />
          </div>

          {(cover || existingCoverId) && (
            <div className="mt-4 flex items-center gap-3">
              <span
                className="size-5 border border-rule"
                style={{ background: cover?.color ?? book?.coverColor ?? '#e9e9e9' }}
                aria-hidden="true"
              />
              <p className="text-[0.6875rem] leading-tight text-graphite">
                Accent taken from the cover.
                <br />
                Used on this book’s pages.
              </p>
            </div>
          )}

          <label className="mt-4 block">
            <span className="sr-only">Replace the cover</span>
            <input
              type="file"
              accept="image/*"
              className="sr-only"
              onChange={async (e) => {
                const picked = e.target.files?.[0];
                if (!picked) return;
                if (picked.size > maxCoverBytes) {
                  toast.warn(`Covers must be under ${formatBytes(maxCoverBytes)}.`);
                  return;
                }
                const { measureCover } = await import('@/lib/admin/measure-cover');
                const measured = await measureCover(picked);
                // measured.blob is a downscaled copy when the original was
                // larger than any slot paints — Appwrite will not resize on a
                // free plan, so covers have to be right before they are stored.
                setCover({
                  blob: measured.blob,
                  ratio: measured.ratio,
                  color: measured.color,
                  preview: URL.createObjectURL(measured.blob),
                });
              }}
            />
            <span className="link-rule cursor-pointer text-[0.75rem] text-graphite hover:text-ink">
              {cover || existingCoverId ? 'Replace the cover' : 'Choose a cover image'}
            </span>
          </label>

          {!cover && !existingCoverId && (
            <p className="mt-3 flex items-start gap-2 text-[0.6875rem] leading-relaxed text-mute">
              <Wand2 className="mt-0.5 size-3 shrink-0" strokeWidth={1.5} />
              Without one, the shelf sets a typographic cover from the title.
            </p>
          )}
        </section>

        <section className="space-y-4 border-t border-rule pt-8">
          <p className="label">Shelving</p>

          <Choice
            label="Visible to readers"
            hint="Drafts are only visible here."
            checked={draft.status === 'published'}
            onChange={(value) => set('status', value ? 'published' : 'draft')}
          />
          <Choice
            label="Feature on the home page"
            hint="One slot. Turning this on takes it from whichever book has it."
            checked={draft.featured}
            onChange={(value) => set('featured', value)}
          />
          <Choice
            label="Allow downloads"
            hint="Off means read-here-only."
            checked={draft.allowDownload}
            onChange={(value) => set('allowDownload', value)}
          />
        </section>

        <div className="space-y-3 border-t border-rule pt-8">
          <Button variant="ink" size="lg" onClick={() => void save()} disabled={busy} className="w-full">
            {busy && <Loader2 className="size-4 animate-spin" strokeWidth={2} />}
            {saving
              ? uploadPercent !== null
                ? `Uploading ${uploadPercent}%`
                : 'Saving'
              : editing
                ? 'Save changes'
                : 'Put it on the shelf'}
          </Button>

          {editing && <DeleteBook bookId={book!.$id} title={book!.title} />}
        </div>
      </aside>
    </div>
  );
}

const INPUT =
  'h-10 w-full border border-rule bg-transparent px-3 text-[0.875rem] outline-none transition-colors focus:border-ink';

function Field({
  label,
  hint,
  required,
  children,
}: {
  label: string;
  hint?: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="label mb-2 block">
        {label}
        {required && <span className="ml-1 text-ribbon">*</span>}
      </span>
      {children}
      {hint && <span className="mt-1.5 block text-[0.6875rem] text-mute">{hint}</span>}
    </label>
  );
}

function Choice({
  label,
  hint,
  checked,
  onChange,
}: {
  label: string;
  hint?: string;
  checked: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className="flex w-full items-start gap-3 text-left"
    >
      <span
        className={cn(
          'mt-0.5 grid size-4 shrink-0 place-items-center border transition-colors',
          checked ? 'border-ink bg-ink' : 'border-rule',
        )}
        aria-hidden="true"
      >
        {checked && (
          <svg viewBox="0 0 10 10" className="size-2.5 text-paper" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M1.5 5.5L4 8L8.5 2.5" strokeLinecap="square" />
          </svg>
        )}
      </span>
      <span className="min-w-0">
        <span className="block text-[0.8125rem] text-ink">{label}</span>
        {hint && <span className="mt-0.5 block text-[0.6875rem] text-mute">{hint}</span>}
      </span>
    </button>
  );
}

/** Two-step, because deleting a book takes its file with it. */
function DeleteBook({ bookId, title }: { bookId: string; title: string }) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);

  async function remove() {
    setBusy(true);
    try {
      const response = await fetch(`/api/admin/books/${bookId}`, { method: 'DELETE' });
      if (!response.ok && response.status !== 204) throw new Error('failed');
      toast.done(`Removed ${title} from the shelf.`);
      router.push('/admin/books');
      router.refresh();
    } catch {
      toast.warn('That book could not be removed.');
      setBusy(false);
    }
  }

  if (!confirming) {
    return (
      <button
        type="button"
        onClick={() => setConfirming(true)}
        className="flex w-full items-center justify-center gap-2 py-2 text-[0.75rem] text-graphite transition-colors hover:text-ribbon"
      >
        <Trash2 className="size-3.5" strokeWidth={1.5} />
        Remove this book
      </button>
    );
  }

  return (
    <div className="border border-ribbon p-3.5">
      <p className="text-[0.75rem] leading-relaxed text-ink">
        Removing {title} deletes its file and cover. Readers keep their bookmarks, but the
        book disappears from the shelf.
      </p>
      <div className="mt-3 flex gap-2">
        <Button variant="ribbon" size="sm" onClick={() => void remove()} disabled={busy} className="flex-1">
          {busy ? 'Removing' : 'Remove it'}
        </Button>
        <Button variant="outline" size="sm" onClick={() => setConfirming(false)} disabled={busy}>
          Keep
        </Button>
      </div>
    </div>
  );
}
