import type { Metadata } from 'next';
import Link from 'next/link';

import { getFacets } from '@/lib/appwrite/books';
import { APP_NAME } from '@/lib/config';
import { pluralize } from '@/lib/utils';

export const metadata: Metadata = {
  title: 'Authors',
  description: `Everyone with a book on the shelf at ${APP_NAME}.`,
};

export const revalidate = 600;

/**
 * The authors index, grouped by initial.
 *
 * Built from the same facet counts the browse filters use, so it can never
 * disagree with them. Grouping by letter rather than paginating means the whole
 * list is one page you can scan or use the browser's own find on — which is how
 * people actually look for a name.
 */
export default async function AuthorsPage() {
  const facets = await getFacets();

  const groups = new Map<string, { name: string; count: number }[]>();

  for (const author of facets.authors) {
    const name = author.value.trim();
    if (!name) continue;
    // Anything not a letter — a numeral, a transliterated name starting with a
    // mark — collects under one heading rather than creating a group of one.
    const first = name[0]!.toUpperCase();
    const key = /^[A-Z]$/.test(first) ? first : '#';
    const list = groups.get(key) ?? [];
    list.push({ name, count: author.count });
    groups.set(key, list);
  }

  const letters = Array.from(groups.keys()).sort((a, b) =>
    a === '#' ? 1 : b === '#' ? -1 : a.localeCompare(b),
  );

  const total = facets.authors.length;

  return (
    <div className="px-[var(--page-gutter)] pt-12 pb-16 sm:pt-16">
      <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-2">
        <h1 className="display text-[clamp(2.25rem,6vw,4rem)]">Authors</h1>
        {total > 0 && <p className="pb-2 text-[0.8125rem] text-graphite tnum">{total}</p>}
      </div>

      {letters.length ? (
        <>
          {/* Jump links. Lenis handles the easing on the anchors. */}
          <nav className="mt-9 flex flex-wrap gap-1" aria-label="Jump to a letter">
            {letters.map((letter) => (
              <a
                key={letter}
                href={`#letter-${letter === '#' ? 'other' : letter}`}
                className="grid size-8 place-items-center border border-rule text-[0.75rem] transition-colors hover:border-ink hover:ink-fill"
              >
                {letter}
              </a>
            ))}
          </nav>

          <div className="mt-14 space-y-14">
            {letters.map((letter) => (
              <section key={letter} id={`letter-${letter === '#' ? 'other' : letter}`}>
                <div className="flex items-baseline gap-4 border-b border-rule pb-2">
                  <h2 className="display text-[1.75rem]">{letter === '#' ? 'Other' : letter}</h2>
                  <span className="text-[0.6875rem] text-mute tnum">
                    {groups.get(letter)!.length}
                  </span>
                </div>

                <ul className="mt-5 grid gap-x-8 gap-y-2.5 sm:grid-cols-2 lg:grid-cols-3">
                  {groups
                    .get(letter)!
                    .sort((a, b) => a.name.localeCompare(b.name))
                    .map((author) => (
                      <li key={author.name}>
                        <Link
                          href={`/library?author=${encodeURIComponent(author.name)}`}
                          className="group flex items-baseline justify-between gap-3"
                        >
                          <span className="link-rule min-w-0 truncate text-[0.9375rem] text-ink-soft group-hover:text-ink">
                            {author.name}
                          </span>
                          <span className="shrink-0 text-[0.6875rem] text-mute tnum">
                            {author.count}
                          </span>
                        </Link>
                      </li>
                    ))}
                </ul>
              </section>
            ))}
          </div>
        </>
      ) : (
        <div className="border-t border-rule py-20">
          <p className="display text-[1.5rem]">No authors yet</p>
          <p className="prose-read mt-3 max-w-md">
            Authors appear here as soon as there are books on the shelf —{' '}
            {pluralize(0, 'book')} so far.
          </p>
          <Link href="/library" className="link-rule mt-6 inline-block text-[0.875rem] text-ink">
            Browse the library
          </Link>
        </div>
      )}
    </div>
  );
}
