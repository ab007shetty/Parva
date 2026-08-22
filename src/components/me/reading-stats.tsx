import { formatDuration, pluralize } from '@/lib/utils';
import type { ReadingDayRow } from '@/types';

/**
 * Reading stats, kept to the four numbers that mean something, plus a year of
 * reading days as a strip of marks.
 *
 * The heatmap is monochrome on purpose: this is the one place in the app with a
 * dense field of small elements, and giving it colour would make it the loudest
 * thing on a page whose subject is books. Ink at four opacities carries the same
 * information.
 */
export function ReadingStats({
  booksStarted,
  booksFinished,
  totalSeconds,
  streak,
  days,
}: {
  booksStarted: number;
  booksFinished: number;
  totalSeconds: number;
  streak: { current: number; longest: number };
  days: ReadingDayRow[];
}) {
  const stats = [
    { label: 'Books opened', value: String(booksStarted) },
    { label: 'Finished', value: String(booksFinished) },
    { label: 'Time reading', value: formatDuration(totalSeconds) },
    {
      label: 'Current streak',
      value: streak.current ? pluralize(streak.current, 'day') : '—',
      hint: streak.longest > streak.current ? `Best ${pluralize(streak.longest, 'day')}` : undefined,
    },
  ];

  return (
    <section aria-label="Your reading">
      <dl className="grid gap-px border border-rule bg-rule sm:grid-cols-2 lg:grid-cols-4">
        {stats.map((stat) => (
          <div key={stat.label} className="bg-paper p-5">
            <dt className="label">{stat.label}</dt>
            <dd className="display mt-2.5 text-[1.75rem] tnum">{stat.value}</dd>
            {stat.hint && <p className="mt-1 text-[0.625rem] text-mute">{stat.hint}</p>}
          </div>
        ))}
      </dl>

      {days.length > 0 && <ReadingYear days={days} />}
    </section>
  );
}

const WEEKS = 26;

function ReadingYear({ days }: { days: ReadingDayRow[] }) {
  const byDay = new Map(days.map((row) => [row.day, row.seconds]));

  // Half a year back, aligned to a Sunday so the columns are real weeks.
  const end = new Date();
  const start = new Date(end);
  start.setDate(end.getDate() - WEEKS * 7 + 1);
  start.setDate(start.getDate() - start.getDay());

  const cells: { key: string; seconds: number; label: string }[] = [];
  const cursor = new Date(start);

  while (cursor <= end) {
    const key = `${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, '0')}-${String(
      cursor.getDate(),
    ).padStart(2, '0')}`;
    const seconds = byDay.get(key) ?? 0;
    cells.push({
      key,
      seconds,
      label: seconds
        ? `${formatDuration(seconds)} on ${cursor.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}`
        : `Nothing read on ${cursor.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}`,
    });
    cursor.setDate(cursor.getDate() + 1);
  }

  /** Four steps, thresholded on real reading lengths rather than percentiles. */
  function shade(seconds: number) {
    if (!seconds) return 'bg-rule-soft';
    if (seconds < 300) return 'bg-faint';
    if (seconds < 1200) return 'bg-mute';
    if (seconds < 3600) return 'bg-graphite';
    return 'bg-ink';
  }

  return (
    <div className="mt-8">
      <p className="label mb-3.5">Reading days</p>

      {/* Scrolls rather than shrinking: legible squares matter more than fitting
          the whole span on a phone. */}
      <div className="no-bar overflow-x-auto pb-2">
        <div
          className="grid w-max grid-flow-col gap-[3px]"
          style={{ gridTemplateRows: 'repeat(7, minmax(0, 1fr))' }}
        >
          {cells.map((cell) => (
            <span
              key={cell.key}
              title={cell.label}
              aria-label={cell.label}
              className={`size-[9px] ${shade(cell.seconds)}`}
            />
          ))}
        </div>
      </div>

      <div className="mt-2.5 flex items-center gap-2 text-[0.625rem] text-mute">
        <span>Less</span>
        <span className="size-[9px] bg-rule-soft" aria-hidden="true" />
        <span className="size-[9px] bg-faint" aria-hidden="true" />
        <span className="size-[9px] bg-mute" aria-hidden="true" />
        <span className="size-[9px] bg-graphite" aria-hidden="true" />
        <span className="size-[9px] bg-ink" aria-hidden="true" />
        <span>More</span>
      </div>
    </div>
  );
}
