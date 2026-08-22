'use client';

import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { Check, ChevronDown } from 'lucide-react';

import { cn } from '@/lib/utils';

/**
 * A select drawn in the app's own language.
 *
 * A native `<select>` was here first, on the reasoning that the platform picker
 * is the best one on a phone. That reasoning is sound and the result was not:
 * the open list is painted by the OS, so it arrives with rounded corners, a
 * system blue highlight and a font from somewhere else entirely — a hole in the
 * middle of a page built from hairlines and one ink. On a monochrome design it
 * is the single loudest thing on screen.
 *
 * So the list is ours: square, hairline, one ink, and the same 44px touch rows
 * a platform picker would have given. Keyboard behaviour follows the listbox
 * pattern — arrows move, Enter or Space commits, Escape closes without
 * changing anything, Home and End jump the ends, and typing a letter goes to
 * the next option starting with it.
 */

export type SelectOption<T extends string> = {
  value: T;
  label: string;
  /** Second line, for options that need explaining. */
  note?: string;
};

export function Select<T extends string>({
  label,
  value,
  onChange,
  options,
  /** Shown when nothing matches `value` — a placeholder, not an option. */
  placeholder,
  /** Fills its container instead of hugging the current label. */
  block = false,
  size = 'sm',
  className,
}: {
  label: string;
  value: T;
  onChange: (value: T) => void;
  options: SelectOption<T>[];
  placeholder?: string;
  block?: boolean;
  size?: 'sm' | 'md';
  className?: string;
}) {
  const id = useId();
  const wrapRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLUListElement>(null);

  const [open, setOpen] = useState(false);
  const selectedIndex = useMemo(() => options.findIndex((o) => o.value === value), [options, value]);
  /** Which row the keyboard is on. Separate from the committed value. */
  const [cursor, setCursor] = useState(Math.max(0, selectedIndex));

  const current = selectedIndex >= 0 ? options[selectedIndex] : null;

  /* ── Opening and closing ──────────────────────────────────────── */

  function show() {
    // Always open onto the current value, wherever the cursor was left.
    setCursor(Math.max(0, selectedIndex));
    setOpen(true);
  }

  function hide({ refocus = true }: { refocus?: boolean } = {}) {
    setOpen(false);
    if (refocus) buttonRef.current?.focus();
  }

  function commit(index: number) {
    const option = options[index];
    if (option) onChange(option.value);
    hide();
  }

  useEffect(() => {
    if (!open) return;

    function onPointerDown(event: PointerEvent) {
      if (!wrapRef.current?.contains(event.target as Node)) setOpen(false);
    }
    // A scroll or resize while the list is open would leave it detached from a
    // trigger that has moved. Closing is cheaper and less surprising than
    // repositioning mid-gesture.
    function onDismiss() {
      setOpen(false);
    }

    document.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('resize', onDismiss);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('resize', onDismiss);
    };
  }, [open]);

  // Keep the cursor row in view when arrowing through a list long enough to
  // scroll.
  useEffect(() => {
    if (!open) return;
    listRef.current?.querySelector<HTMLElement>('[data-cursor="true"]')?.scrollIntoView({ block: 'nearest' });
  }, [open, cursor]);

  /* ── Keyboard ─────────────────────────────────────────────────── */

  function onKeyDown(event: React.KeyboardEvent) {
    if (!open) {
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp' || event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        show();
      }
      return;
    }

    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault();
        setCursor((c) => (c + 1) % options.length);
        break;
      case 'ArrowUp':
        event.preventDefault();
        setCursor((c) => (c - 1 + options.length) % options.length);
        break;
      case 'Home':
        event.preventDefault();
        setCursor(0);
        break;
      case 'End':
        event.preventDefault();
        setCursor(options.length - 1);
        break;
      case 'Enter':
      case ' ':
        event.preventDefault();
        commit(cursor);
        break;
      case 'Escape':
        event.preventDefault();
        // Stop here: an Escape meant for this list must not also close the
        // drawer or reader panel it might be sitting inside.
        event.stopPropagation();
        hide();
        break;
      case 'Tab':
        // Tabbing away is a dismissal, not a choice. Let focus move on.
        setOpen(false);
        break;
      default: {
        if (event.key.length !== 1) break;
        const letter = event.key.toLowerCase();
        // Search after the cursor first so repeated presses cycle matches.
        const order = [...options.slice(cursor + 1), ...options.slice(0, cursor + 1)];
        const hit = order.find((o) => o.label.toLowerCase().startsWith(letter));
        if (hit) setCursor(options.indexOf(hit));
      }
    }
  }

  return (
    <div ref={wrapRef} className={cn('relative', block ? 'w-full' : 'w-auto', className)}>
      <button
        ref={buttonRef}
        type="button"
        onClick={() => (open ? hide({ refocus: false }) : show())}
        onKeyDown={onKeyDown}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-labelledby={`${id}-label`}
        className={cn(
          'flex w-full items-center justify-between gap-2 border bg-transparent text-left transition-colors',
          size === 'sm' ? 'h-9 pl-3 pr-2.5 text-[0.8125rem]' : 'h-10 pl-3 pr-2.5 text-[0.875rem]',
          open ? 'border-ink' : 'border-rule hover:border-ink',
        )}
      >
        <span id={`${id}-label`} className="sr-only">
          {label}
        </span>
        <span className={cn('truncate', current ? 'text-ink' : 'text-mute')}>
          {current?.label ?? placeholder ?? label}
        </span>
        <ChevronDown
          className={cn('size-3.5 shrink-0 text-graphite transition-transform', open && 'rotate-180')}
          strokeWidth={1.5}
        />
      </button>

      {open && (
        <ul
          ref={listRef}
          role="listbox"
          aria-label={label}
          tabIndex={-1}
          // Anchored to the trigger and never wider than the viewport allows, so
          // a long option label cannot push the page sideways on a phone.
          className={cn(
            'absolute top-full left-0 z-50 mt-px max-h-[min(18rem,60dvh)] overflow-y-auto overflow-x-hidden',
            'w-max min-w-full max-w-[calc(100vw-2*var(--page-gutter))]',
            'border border-ink bg-paper py-0.5 shadow-[0_12px_34px_-20px_rgba(0,0,0,0.4)]',
          )}
        >
          {options.map((option, index) => {
            const isSelected = option.value === value;
            const isCursor = index === cursor;
            return (
              <li key={option.value} role="option" aria-selected={isSelected}>
                <button
                  type="button"
                  tabIndex={-1}
                  data-cursor={isCursor}
                  // mousedown, not click: the trigger blurs first otherwise and
                  // the list is gone before the click lands.
                  onMouseDown={(event) => {
                    event.preventDefault();
                    commit(index);
                  }}
                  onMouseEnter={() => setCursor(index)}
                  className={cn(
                    'flex w-full items-center gap-3 px-3 text-left transition-colors',
                    // Full-height rows rather than a tighter list: this is the
                    // one control most likely to be used with a thumb.
                    'min-h-11 py-2',
                    isCursor ? 'bg-wash' : 'bg-transparent',
                  )}
                >
                  <span className="min-w-0 flex-1">
                    <span
                      className={cn(
                        'block truncate text-[0.8125rem]',
                        isSelected ? 'text-ink' : 'text-ink-soft',
                      )}
                    >
                      {option.label}
                    </span>
                    {option.note && (
                      <span className="mt-0.5 block truncate text-[0.6875rem] text-mute">
                        {option.note}
                      </span>
                    )}
                  </span>
                  {isSelected && <Check className="size-3.5 shrink-0 text-ink" strokeWidth={2} />}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
