'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useState } from 'react';
import { ChevronDown, Search, SlidersHorizontal, X } from 'lucide-react';

import { Select } from '@/components/ui/select';
import { SORTS, languageLabel, type SortKey } from '@/lib/config';
import { cn } from '@/lib/utils';
import type { BrowseParams, Facets } from '@/types';

/**
 * Browse filters.
 *
 * Every filter is a URL parameter, so a filtered view is a shareable link, the
 * back button works, and the server can render it. Facet counts come from the
 * real collection, and any facet with nothing behind it is simply absent —
 * offering a filter that returns zero results is a small lie.
 *
 * The bar carries the two things wanted most often — a name to search for and
 * an order to see it in — and hides the rest behind one disclosure. On a phone
 * the search field takes the first row on its own, because a 44px field sharing
 * a line with two buttons is a field nobody can type in.
 */
export function BrowseFilters({ facets, active }: { facets: Facets; active: BrowseParams }) {
  const router = useRouter();
  const searchParams = useSearchParams();

  const activeFilters = [
    active.q && { key: 'q', label: `“${active.q}”` },
    active.author && { key: 'author', label: active.author },
    active.tag && { key: 'tag', label: active.tag },
    active.language && { key: 'language', label: languageLabel(active.language) ?? active.language },
    active.format && { key: 'format', label: active.format.toUpperCase() },
    active.year && { key: 'year', label: String(active.year) },
  ].filter(Boolean) as { key: string; label: string }[];

  // Arriving on a filtered link opens the panel, so it is obvious which facet
  // is doing the filtering and where to let go of it.
  const [expanded, setExpanded] = useState(activeFilters.length > 0);

  const apply = useCallback(
    (key: string, value: string | null) => {
      const next = new URLSearchParams(searchParams.toString());
      if (value === null) next.delete(key);
      else next.set(key, value);
      // Any filter change invalidates the page you were on.
      next.delete('page');
      router.push(`/library?${next.toString()}`, { scroll: false });
    },
    [router, searchParams],
  );

  return (
    <div className="mt-8">
      <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center">
        {/* Remounts when the URL's q changes — clearing the chip empties the
            field without a state-syncing effect. */}
        <SearchField
          key={active.q ?? ''}
          initial={active.q ?? ''}
          onSubmit={(term) => apply('q', term || null)}
        />

        <div className="flex items-center gap-2 sm:gap-3">
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            aria-expanded={expanded}
            className={cn(
              'flex h-9 shrink-0 items-center gap-2 border px-3 text-[0.8125rem] transition-colors',
              expanded ? 'border-ink ink-fill' : 'border-rule text-ink hover:border-ink',
            )}
          >
            <SlidersHorizontal className="size-3.5" strokeWidth={1.5} />
            Filters
            {activeFilters.length > 0 && (
              <span className="tnum text-[0.6875rem] opacity-70">{activeFilters.length}</span>
            )}
            <ChevronDown
              className={cn('size-3.5 transition-transform', expanded && 'rotate-180')}
              strokeWidth={1.5}
            />
          </button>

          <Select<SortKey>
            label="Sort books by"
            value={(active.sort ?? 'recent') as SortKey}
            onChange={(value) => apply('sort', value)}
            options={SORTS.map((s) => ({ value: s.key, label: s.label }))}
            className="min-w-0 flex-1 sm:w-44 sm:flex-none"
            block
          />
        </div>
      </div>

      {activeFilters.length > 0 && (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          {activeFilters.map((filter) => (
            <button
              key={filter.key}
              type="button"
              onClick={() => apply(filter.key, null)}
              aria-label={`Remove filter ${filter.label}`}
              className="flex h-8 max-w-full items-center gap-2 border border-ink bg-ink px-2.5 text-[0.75rem] text-paper transition-opacity hover:opacity-80"
            >
              <span className="min-w-0 truncate">{filter.label}</span>
              <X className="size-3 shrink-0" strokeWidth={2} />
            </button>
          ))}
          {activeFilters.length > 1 && (
            <button
              type="button"
              onClick={() => router.push('/library')}
              className="link-rule ml-1 text-[0.75rem] text-graphite hover:text-ink"
            >
              Clear all
            </button>
          )}
        </div>
      )}

      {expanded && (
        <div className="mt-6 grid gap-x-8 gap-y-9 border-t border-rule pt-8 sm:grid-cols-2 lg:grid-cols-4">
          <FacetList
            title="Author"
            items={facets.authors.slice(0, 14).map((a) => ({ value: a.value, label: a.value, count: a.count }))}
            activeValue={active.author}
            onPick={(value) => apply('author', value)}
          />
          <FacetList
            title="Subject"
            items={facets.tags.slice(0, 14).map((t) => ({ value: t.value, label: t.value, count: t.count }))}
            activeValue={active.tag}
            onPick={(value) => apply('tag', value)}
          />
          <FacetList
            title="Language"
            items={facets.languages.map((l) => ({
              value: l.value,
              label: languageLabel(l.value) ?? l.value,
              count: l.count,
            }))}
            activeValue={active.language}
            onPick={(value) => apply('language', value)}
          />
          <div className="space-y-9">
            <FacetList
              title="Format"
              items={facets.formats.map((f) => ({
                value: f.value,
                label: f.value.toUpperCase(),
                count: f.count,
              }))}
              activeValue={active.format}
              onPick={(value) => apply('format', value)}
            />
            {facets.years.length > 1 && (
              <FacetList
                title="Published"
                items={facets.years.slice(0, 10).map((y) => ({
                  value: String(y.value),
                  label: String(y.value),
                  count: y.count,
                }))}
                activeValue={active.year ? String(active.year) : undefined}
                onPick={(value) => apply('year', value)}
              />
            )}
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * Search by title or author, submitted rather than live.
 *
 * Live filtering would mean a server round trip per keystroke on a route that
 * renders the whole grid. Enter — or the magnifier, which is the submit button —
 * is one request for one intention.
 */
function SearchField({
  initial,
  onSubmit,
}: {
  initial: string;
  onSubmit: (term: string) => void;
}) {
  const [term, setTerm] = useState(initial);

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit(term.trim());
      }}
      role="search"
      className="relative min-w-0 sm:w-72"
    >
      <label htmlFor="library-search" className="sr-only">
        Search this shelf by title or author
      </label>
      <input
        id="library-search"
        value={term}
        onChange={(event) => setTerm(event.target.value)}
        type="search"
        enterKeyHint="search"
        autoComplete="off"
        placeholder="Title or author"
        className="h-9 w-full border border-rule bg-transparent pl-3 pr-16 text-[0.8125rem] outline-none transition-colors placeholder:text-mute focus:border-ink"
      />

      <div className="absolute inset-y-0 right-0 flex items-center">
        {term && (
          <button
            type="button"
            onClick={() => {
              setTerm('');
              onSubmit('');
            }}
            aria-label="Clear the search"
            className="grid size-9 place-items-center text-mute transition-colors hover:text-ink"
          >
            <X className="size-3.5" strokeWidth={1.5} />
          </button>
        )}
        <button
          type="submit"
          aria-label="Search this shelf"
          className="grid size-9 place-items-center text-graphite transition-colors hover:text-ink"
        >
          <Search className="size-3.5" strokeWidth={1.5} />
        </button>
      </div>
    </form>
  );
}

function FacetList({
  title,
  items,
  activeValue,
  onPick,
}: {
  title: string;
  items: { value: string; label: string; count: number }[];
  activeValue?: string;
  onPick: (value: string | null) => void;
}) {
  // An empty facet is not rendered — a filter that can only ever return zero
  // results is noise.
  if (!items.length) return null;

  return (
    <div>
      <p className="label mb-3.5">{title}</p>
      <ul>
        {items.map((item) => {
          const isActive = activeValue === item.value;
          return (
            <li key={item.value}>
              <button
                type="button"
                onClick={() => onPick(isActive ? null : item.value)}
                aria-pressed={isActive}
                className={cn(
                  // A comfortable row rather than a tight line: on a phone this
                  // list is the filter, and every row has to be tappable.
                  'flex w-full items-baseline justify-between gap-3 py-1.5 text-left text-[0.8125rem] transition-colors',
                  isActive ? 'text-ink' : 'text-graphite hover:text-ink',
                )}
              >
                <span className={cn('min-w-0 truncate', isActive && 'font-medium')}>{item.label}</span>
                <span className="shrink-0 text-[0.6875rem] text-mute tnum">{item.count}</span>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
