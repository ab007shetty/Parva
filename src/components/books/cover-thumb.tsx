import { cn, readableInk } from '@/lib/utils';

/**
 * A small cover, for lists rather than shelves.
 *
 * The full BookObject is a physical thing with a spine, page edges and a lift
 * shadow — right at shelf size, noise at 28 pixels. This is the same cover
 * reduced to what still reads at that size: the image, a hairline, and nothing
 * else.
 *
 * Deliberately not a client component: the admin tables that use it are server
 * rendered, and the search palette that also uses it is not. Sharing one
 * component is what stops these lists drifting back into coloured rectangles.
 */
export function CoverThumb({
  coverId,
  coverColor,
  title,
  /** Rendered width in CSS pixels. The height follows from the class. */
  width,
  className,
}: {
  coverId: string | null | undefined;
  coverColor: string | null | undefined;
  title: string;
  width: number;
  className?: string;
}) {
  const bloom = coverColor ?? '#e9e9e9';

  return (
    <span
      className={cn('relative block shrink-0 overflow-hidden border border-rule', className)}
      style={{ background: bloom }}
      aria-hidden="true"
    >
      {coverId ? (
        // Asks for twice the painted width so it stays sharp on a retina
        // screen. /api/cover caches hard, so a repeated cover costs nothing.
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={`/api/cover/${coverId}?w=${Math.round(width * 2)}`}
          alt=""
          loading="lazy"
          decoding="async"
          draggable={false}
          className="size-full object-cover"
        />
      ) : (
        // No cover: the first letter on the sampled bloom, which is at least
        // recognisable at a glance in a long list.
        <span
          className="display grid size-full place-items-center text-[0.6875rem] leading-none"
          style={{ color: readableInk(bloom) }}
        >
          {title.trim().charAt(0).toUpperCase() || '?'}
        </span>
      )}
    </span>
  );
}
