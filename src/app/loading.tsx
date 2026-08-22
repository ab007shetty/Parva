/**
 * Route-level loading. Deliberately just the shelf rule drawing itself — a
 * skeleton of fake book covers would flash a layout that may not match what
 * arrives, which reads worse than a single honest line.
 */
export default function Loading() {
  return (
    <div className="px-[var(--page-gutter)] pt-16">
      <div className="h-[1px] w-full overflow-hidden bg-rule-soft">
        <div className="h-full w-1/3 animate-[shelf-draw_1.1s_ease-in-out_infinite] bg-ink" />
      </div>

      <style>{`
        @keyframes shelf-draw {
          0%   { transform: translateX(-100%); }
          100% { transform: translateX(300%); }
        }
      `}</style>
    </div>
  );
}
