'use client';

import { useEffect, useState } from 'react';
import { Copy, Highlighter, Volume2, X } from 'lucide-react';

import { cn } from '@/lib/utils';
import type { HighlightColor } from '@/types';

/**
 * What appears when a reader selects a passage.
 *
 * It follows the selection rather than living in the chrome, because the whole
 * point is that it refers to *those words*. It is positioned above the selection
 * where there is room and below it where there is not, and clamped to the
 * viewport so a selection at the edge of the screen never puts the controls
 * off it.
 */

export type SelectionPayload = {
  text: string;
  /** Viewport-space box of the selection, used only for placement. */
  rect: { top: number; left: number; width: number; height: number };
  /** Engine-native locator: a CFI range, or JSON page + rects for a PDF. */
  locator: string;
  page: number | null;
  percent: number;
};

const COLORS: { key: HighlightColor; label: string; swatch: string }[] = [
  { key: 'marker', label: 'Highlighter', swatch: 'var(--color-marker)' },
  { key: 'ribbon', label: 'Red', swatch: 'var(--color-ribbon)' },
  { key: 'ink', label: 'Grey', swatch: 'var(--color-graphite)' },
];

const WIDTH = 232;
const HEIGHT = 44;
const GAP = 10;
const EDGE = 8;

/**
 * Sits the toolbar above the selection, or below it when the selection is close
 * to the top of the viewport, and clamps horizontally so a passage selected at
 * the edge of the screen never pushes the controls off it.
 */
function placeAbove(
  rect: SelectionPayload['rect'],
  width: number,
): { top: number; left: number } {
  const above = rect.top - HEIGHT - GAP;
  const below = rect.top + rect.height + GAP;

  return {
    top: above > EDGE ? above : below,
    left: Math.min(
      Math.max(EDGE, rect.left + rect.width / 2 - width / 2),
      Math.max(EDGE, window.innerWidth - width - EDGE),
    ),
  };
}

export function SelectionPopover({
  selection,
  onHighlight,
  onReadAloud,
  onDismiss,
}: {
  selection: SelectionPayload;
  onHighlight: (color: HighlightColor) => void;
  onReadAloud: () => void;
  onDismiss: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const [expanded, setExpanded] = useState(false);

  // Placement is a pure function of the selection box and which row of controls
  // is showing, so it is computed here rather than measured into state — which
  // would mean rendering once in the wrong place and then correcting it.
  const position = placeAbove(selection.rect, expanded ? WIDTH + 96 : WIDTH);

  // Escape dismisses, and so does scrolling — a popover anchored to a selection
  // that has moved is worse than no popover.
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') onDismiss();
    }
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('scroll', onDismiss, { passive: true, capture: true });
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('scroll', onDismiss, { capture: true });
    };
  }, [onDismiss]);

  async function copy() {
    try {
      await navigator.clipboard.writeText(selection.text);
      setCopied(true);
      setTimeout(onDismiss, 700);
    } catch {
      // Clipboard permission denied; the selection is still there to copy by hand.
      onDismiss();
    }
  }

  return (
    <div
      role="toolbar"
      aria-label="Selected text"
      className="fixed z-70 flex items-stretch border border-ink bg-paper shadow-[0_10px_34px_-12px_rgb(0_0_0/0.4)]"
      style={{ top: position.top, left: position.left, height: HEIGHT }}
      // Keep the browser from clearing the selection when the toolbar is clicked.
      onMouseDown={(event) => event.preventDefault()}
    >
      {expanded ? (
        <>
          {COLORS.map((color) => (
            <button
              key={color.key}
              type="button"
              onClick={() => onHighlight(color.key)}
              aria-label={`Highlight in ${color.label.toLowerCase()}`}
              title={color.label}
              className="flex w-11 items-center justify-center border-r border-rule transition-colors last:border-r-0 hover:bg-wash"
            >
              <span
                className="size-4 border border-rule"
                style={{ background: color.swatch }}
                aria-hidden="true"
              />
            </button>
          ))}
          <button
            type="button"
            onClick={() => setExpanded(false)}
            aria-label="Back"
            className="flex w-10 items-center justify-center text-mute transition-colors hover:text-ink"
          >
            <X className="size-3.5" strokeWidth={1.75} />
          </button>
        </>
      ) : (
        <>
          <Action
            label={copied ? 'Copied' : 'Copy'}
            icon={<Copy className="size-3.5" strokeWidth={1.5} />}
            onClick={() => void copy()}
          />
          <Action
            label="Highlight"
            icon={<Highlighter className="size-3.5" strokeWidth={1.5} />}
            onClick={() => setExpanded(true)}
          />
          <Action
            label="Read"
            icon={<Volume2 className="size-3.5" strokeWidth={1.5} />}
            onClick={onReadAloud}
            last
          />
        </>
      )}
    </div>
  );
}

function Action({
  label,
  icon,
  onClick,
  last = false,
}: {
  label: string;
  icon: React.ReactNode;
  onClick: () => void;
  last?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'flex items-center gap-2 px-3.5 text-[0.75rem] text-ink transition-colors hover:bg-wash',
        !last && 'border-r border-rule',
      )}
    >
      {icon}
      {label}
    </button>
  );
}
