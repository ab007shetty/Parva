'use client';

import { useEffect, useId, useMemo, useRef, useState } from 'react';

import { cn, foldDiacritics } from '@/lib/utils';

/**
 * The authors line, with the catalogue suggesting itself.
 *
 * A free-text author field is how a library ends up with "R. K. Narayan",
 * "R.K. Narayan" and "Narayan, R. K." as three separate authors, each holding a
 * third of the books and none of them findable from the others. The fix is not
 * validation — it is making the spelling already in use the easiest thing to
 * pick.
 *
 * Suggestions come from the books already shelved, drafts included, ranked by
 * how many books each name is on. They appear from the first letter, they only
 * ever replace the name the caret is sitting in, and the field stays a plain
 * comma-separated text input underneath: type a genuinely new author and
 * nothing gets in the way.
 */

type Author = { name: string; count: number };

/** Suggestions past this many stop being a shortlist and start being a scroll. */
const MAX_SHOWN = 7;

export function AuthorsField({
  value,
  onChange,
}: {
  /** Comma-separated author names, exactly as the field holds them. */
  value: string;
  onChange: (value: string) => void;
}) {
  const fieldId = useId();
  const inputId = `${fieldId}-authors`;

  const inputRef = useRef<HTMLInputElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);

  const [authors, setAuthors] = useState<Author[] | null>(null);
  const [open, setOpen] = useState(false);
  const [cursor, setCursor] = useState(0);
  /** Where the caret is, so a suggestion replaces the right name. */
  const [caret, setCaret] = useState(0);

  /* ── The catalogue's own names ─────────────────────────────────── */

  // Fetched on first focus rather than on mount: most edits never touch this
  // field, and the form has an upload to be getting on with.
  const asked = useRef(false);

  function loadAuthors() {
    if (asked.current) return;
    asked.current = true;

    void fetch('/api/admin/authors')
      .then((response) => (response.ok ? response.json() : null))
      .then((data) => setAuthors(data?.authors ?? []))
      .catch(() => setAuthors([]));
  }

  /* ── Which name is being typed ─────────────────────────────────── */

  /**
   * The comma-separated segment the caret sits in, with its bounds. Editing the
   * middle of "Kuvempu, Bhyrappa, Karanth" has to suggest for Bhyrappa, not for
   * whatever happens to be last on the line.
   */
  const active = useMemo(() => {
    const position = Math.min(caret, value.length);
    let start = value.lastIndexOf(',', Math.max(0, position - 1)) + 1;
    let end = value.indexOf(',', position);
    if (end === -1) end = value.length;
    // A caret parked immediately after a comma belongs to the segment ahead.
    if (start > end) start = end;

    return { start, end, index: countCommas(value, start), text: value.slice(start, end) };
  }, [value, caret]);

  const query = active.text.trim();

  /** Names already on the line, so the list never offers a duplicate. */
  const taken = useMemo(() => {
    const set = new Set<string>();
    value.split(',').forEach((part, index) => {
      const name = part.trim();
      // The segment being typed is not a duplicate of itself.
      if (name && index !== active.index) set.add(foldDiacritics(name).toLowerCase());
    });
    return set;
  }, [value, active.index]);

  const matches = useMemo(() => {
    if (!authors || !query) return [];
    const needle = foldDiacritics(query).toLowerCase();

    return authors
      .map((author) => {
        const folded = foldDiacritics(author.name).toLowerCase();
        if (taken.has(folded)) return null;
        const at = folded.indexOf(needle);
        if (at === -1) return null;
        // A name that starts with what was typed is what the typist meant;
        // reaching "Salman Rushdie" from "rush" is a fallback, not a first answer.
        return { author, rank: at === 0 ? 0 : 1, at };
      })
      .filter((hit): hit is { author: Author; rank: number; at: number } => hit !== null)
      .sort((a, b) => a.rank - b.rank || a.at - b.at)
      .slice(0, MAX_SHOWN)
      .map((hit) => hit.author);
  }, [authors, query, taken]);

  const showing = open && matches.length > 0;
  // Keep the highlight on a row that still exists as the list narrows.
  const safeCursor = Math.min(cursor, Math.max(0, matches.length - 1));

  /* ── Choosing one ─────────────────────────────────────────────── */

  function choose(name: string) {
    // Preserve the leading space of ", Name" so the line stays readable.
    const lead = active.text.startsWith(' ') ? ' ' : '';
    const next = `${value.slice(0, active.start)}${lead}${name}${value.slice(active.end)}`;
    // Land the caret after the name just accepted, ready for a comma.
    const at = active.start + lead.length + name.length;

    onChange(next);
    setOpen(false);
    setCursor(0);

    const input = inputRef.current;
    if (!input) return;

    // After React has written the new value — otherwise the caret is placed in
    // the old one and the browser moves it again on re-render.
    requestAnimationFrame(() => {
      input.focus();
      input.setSelectionRange(at, at);
      setCaret(at);
    });
  }

  function onKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (!showing) {
      // ArrowDown on a closed field is a request to see what is available.
      if (event.key === 'ArrowDown' && query) setOpen(true);
      return;
    }

    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setCursor((c) => (c + 1) % matches.length);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setCursor((c) => (c - 1 + matches.length) % matches.length);
    } else if (event.key === 'Enter' || event.key === 'Tab') {
      // Enter would submit the form and Tab would leave the field — both worse
      // than accepting the name sitting highlighted under the caret.
      event.preventDefault();
      choose(matches[safeCursor].name);
    } else if (event.key === 'Escape') {
      // Only the list closes. Escape must not reach whatever is around it.
      event.preventDefault();
      event.stopPropagation();
      setOpen(false);
    }
  }

  /* ── Dismissal ────────────────────────────────────────────────── */

  useEffect(() => {
    if (!showing) return;

    function onPointerDown(event: PointerEvent) {
      if (!wrapRef.current?.contains(event.target as Node)) setOpen(false);
    }

    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [showing]);

  return (
    <div ref={wrapRef}>
      <label htmlFor={inputId} className="label mb-2 block">
        Authors
      </label>

      <div className="relative">
        <input
          ref={inputRef}
          id={inputId}
          value={value}
          onFocus={(event) => {
            loadAuthors();
            setCaret(event.target.selectionStart ?? value.length);
          }}
          onChange={(event) => {
            onChange(event.target.value);
            setCaret(event.target.selectionStart ?? event.target.value.length);
            setOpen(true);
            setCursor(0);
          }}
          onClick={(event) => setCaret(event.currentTarget.selectionStart ?? 0)}
          onKeyUp={(event) => setCaret(event.currentTarget.selectionStart ?? 0)}
          onKeyDown={onKeyDown}
          autoComplete="off"
          spellCheck={false}
          role="combobox"
          aria-expanded={showing}
          aria-controls={`${inputId}-list`}
          aria-autocomplete="list"
          aria-activedescendant={showing ? `${inputId}-option-${safeCursor}` : undefined}
          className="h-10 w-full border border-rule bg-transparent px-3 text-[0.875rem] outline-none transition-colors focus:border-ink"
        />

        {showing && (
          // Absolute, so suggestions never push the form around, and exactly as
          // wide as the field, so nothing here can widen the page.
          <ul
            id={`${inputId}-list`}
            role="listbox"
            aria-label="Authors in the catalogue"
            className="absolute top-full left-0 z-30 mt-px max-h-[15rem] w-full overflow-x-hidden overflow-y-auto border border-ink bg-paper shadow-[0_10px_30px_-18px_rgba(0,0,0,0.35)]"
          >
            {matches.map((author, i) => (
              <li
                key={author.name}
                id={`${inputId}-option-${i}`}
                role="option"
                aria-selected={i === safeCursor}
              >
                <button
                  type="button"
                  tabIndex={-1}
                  // mousedown, not click: the input blurs first otherwise and
                  // the list is gone before the click lands.
                  onMouseDown={(event) => {
                    event.preventDefault();
                    choose(author.name);
                  }}
                  onMouseEnter={() => setCursor(i)}
                  className={cn(
                    'flex w-full items-baseline justify-between gap-3 px-3 py-2 text-left transition-colors',
                    i === safeCursor ? 'bg-wash' : 'bg-transparent',
                  )}
                >
                  <span className="min-w-0 flex-1 truncate text-[0.8125rem] text-ink">
                    <Marked text={author.name} query={query} />
                  </span>
                  <span className="shrink-0 text-[0.6875rem] text-mute tnum">
                    {author.count === 1 ? '1 book' : `${author.count} books`}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <span className="mt-1.5 block text-[0.6875rem] text-mute">
        Separate several with commas. Suggestions come from books already shelved.
      </span>
    </div>
  );
}

/** How many commas precede an offset — i.e. which segment it falls in. */
function countCommas(value: string, offset: number): number {
  let count = 0;
  for (let i = 0; i < offset; i += 1) if (value[i] === ',') count += 1;
  return count;
}

/**
 * The typed part of a name, underlined inside the suggestion.
 *
 * Matched on the folded string but sliced from the original, so an accented name
 * keeps its accents while still matching a plain-ASCII query. Folding is
 * length-preserving for precomposed text; where it is not, this drops the
 * underline rather than slicing the name in the wrong place.
 */
function Marked({ text, query }: { text: string; query: string }) {
  const folded = foldDiacritics(text);
  if (!query || folded.length !== text.length) return <>{text}</>;

  const at = folded.toLowerCase().indexOf(foldDiacritics(query).toLowerCase());
  if (at === -1) return <>{text}</>;

  return (
    <>
      {text.slice(0, at)}
      <span className="underline decoration-mute underline-offset-2">
        {text.slice(at, at + query.length)}
      </span>
      {text.slice(at + query.length)}
    </>
  );
}
