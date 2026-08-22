/**
 * The root loading state pins its rule to the top of the page under the site
 * header, which the reader route does not render — left there it would sit in a
 * corner of an otherwise empty full-screen surface. Same single line, centred
 * on the page the book is about to occupy.
 */
export default function ReadLoading() {
  return (
    <div className="grid min-h-dvh place-items-center">
      <div className="h-[1px] w-40 overflow-hidden bg-rule-soft">
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
