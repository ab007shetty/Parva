/**
 * Route-level loading. Deliberately just the shelf rule drawing itself — a
 * skeleton of fake book covers would flash a layout that may not match what
 * arrives, which reads worse than a single honest line.
 *
 * It is positioned to *be* the header's bottom hairline rather than to sit
 * under it. The header carries `border-b border-rule` as the last pixel of its
 * own box and `main` begins immediately after, so a 1px bar at the very top of
 * main pulled up by 1px occupies exactly that row. The track is `bg-rule`, the
 * same token as the border it covers, so nothing appears to change until the
 * ink segment sweeps through — the line already on screen is the line that
 * moves.
 *
 * The z-index is what makes it visible at all: the header is a sticky z-60
 * stacking context, so without sitting above it this bar would be painted
 * behind the very border it is meant to replace.
 */
export default function Loading() {
  return (
    <div className="relative z-70 -mt-px h-px w-full overflow-hidden bg-rule">
      <div className="h-full w-1/3 animate-[shelf-draw_1.1s_ease-in-out_infinite] bg-ink" />

      <style>{`
        @keyframes shelf-draw {
          0%   { transform: translateX(-100%); }
          100% { transform: translateX(300%); }
        }
      `}</style>
    </div>
  );
}
