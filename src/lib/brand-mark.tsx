import { BRAND_FONT_FAMILY } from '@/lib/brand-font';

/**
 * The Parva mark: a single letter on a solid square.
 *
 * An earlier version drew an abstract closed book — a spine crease and two
 * page-edge bars, no letterform — on the theory that a fine serif "P" would
 * turn to mud at 16–32 pixels. In practice the abstract version was the one
 * that didn't read: at favicon size it looked like a dark blob rather than
 * anything identifiable. A bold, high-contrast letter on a solid fill is the
 * pattern that actually survives a browser tab (Notion's "N", Medium's "M") —
 * a heavy sans letterform has none of a serif's fine terminals to lose.
 *
 * Solid ink rather than white, so the mark stays a dark, visible square against
 * both a light and a dark browser tab bar — a white-on-white mark is the
 * specific way this could vanish entirely on an unfocused tab.
 *
 * Shared by the favicon, the apple icon, the installable app icons and the
 * share image, so all of them are the same drawing at different sizes.
 */
export function BrandMark({ size, padded = true }: { size: number; padded?: boolean }) {
  // Maskable icons get clipped to a circle by the platform and the apple icon
  // gets rounded corners, so both need real breathing room around the glyph.
  // A browser tab favicon has neither — every pixel of a 16px square is
  // legibility, so the letter is allowed to sit close to the edge.
  const inset = padded ? size * 0.22 : size * 0.08;
  const box = size - inset * 2;

  return (
    <div
      style={{
        width: size,
        height: size,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: '#0a0a0a',
      }}
    >
      <div
        style={{
          display: 'flex',
          width: box,
          height: box,
          alignItems: 'center',
          justifyContent: 'center',
          fontFamily: BRAND_FONT_FAMILY,
          fontWeight: 700,
          fontSize: box * 0.92,
          lineHeight: 1,
          color: '#ffffff',
          // A capital letter's ink sits above the baseline with a little air
          // below it built into the font's own metrics; nudging up a few percent
          // is what centres it optically rather than by the box math alone.
          transform: 'translateY(-4%)',
        }}
      >
        P
      </div>
    </div>
  );
}
