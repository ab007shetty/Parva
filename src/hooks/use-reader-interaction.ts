'use client';

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';

/**
 * Hides the reader chrome once the reader stops touching anything, and brings
 * it back the moment they do. A full-screen book should be nothing but the
 * book, but controls that are hard to summon are worse than controls that stay.
 *
 * Pointer movement, keys, touch and wheel all count as activity. The chrome is
 * pinned open while a panel is showing, or the reader would lose the panel they
 * are using by reading for three seconds.
 */
export function useIdleChrome(idleMs: number, pinned: boolean) {
  const [idle, setIdle] = useState(false);

  useEffect(() => {
    if (pinned) return;

    let timer: ReturnType<typeof setTimeout> | undefined;

    function schedule() {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => setIdle(true), idleMs);
    }

    function wake() {
      setIdle(false);
      schedule();
    }

    const events: (keyof WindowEventMap)[] = [
      'pointermove',
      'pointerdown',
      'keydown',
      'wheel',
      'touchstart',
    ];
    for (const event of events) window.addEventListener(event, wake, { passive: true });
    schedule();

    return () => {
      for (const event of events) window.removeEventListener(event, wake);
      if (timer) clearTimeout(timer);
    };
  }, [idleMs, pinned]);

  useEffect(() => {
    if (!pinned) return;
    // Runs when the pin is released — closing a panel is itself an interaction,
    // so the countdown should start over rather than the chrome vanishing
    // because the reader was idle before they opened it.
    return () => setIdle(false);
  }, [pinned]);

  return pinned || !idle;
}

/**
 * Keyboard shortcuts.
 *
 * Bindings are ignored while the reader is typing in a field — otherwise
 * searching for "next" would page the book four times.
 */
export type Hotkey = {
  /** `event.key`, matched case-insensitively. */
  key: string;
  run: (event: KeyboardEvent) => void;
  shift?: boolean;
  meta?: boolean;
  /** Allow the binding even while an input has focus. Escape wants this. */
  whileTyping?: boolean;
};

export function useHotkeys(hotkeys: Hotkey[], enabled = true) {
  // The listener is bound once; the handler list is read through a ref so a
  // re-created array does not re-bind it. Written in an effect rather than
  // during render, so the value is only ever mutated after commit.
  const ref = useRef(hotkeys);

  useEffect(() => {
    ref.current = hotkeys;
  });

  useEffect(() => {
    if (!enabled) return;

    function onKeyDown(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null;
      const typing =
        target?.tagName === 'INPUT' ||
        target?.tagName === 'TEXTAREA' ||
        target?.tagName === 'SELECT' ||
        target?.isContentEditable === true;

      for (const hotkey of ref.current) {
        if (hotkey.key.toLowerCase() !== event.key.toLowerCase()) continue;
        if (typing && !hotkey.whileTyping) continue;
        if (hotkey.shift && !event.shiftKey) continue;
        // A shifted character key is a different binding; unshifted ones should
        // not fire for it.
        if (!hotkey.shift && event.shiftKey && event.key.length === 1) continue;
        if (hotkey.meta && !(event.metaKey || event.ctrlKey)) continue;
        if (!hotkey.meta && (event.metaKey || event.ctrlKey)) continue;

        event.preventDefault();
        hotkey.run(event);
        return;
      }
    }

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [enabled]);
}

/**
 * Horizontal swipe for page turns on touch.
 *
 * Deliberately strict: a swipe has to be mostly horizontal and fast enough to
 * be intentional, so pinch-zooming or scrolling a panel never turns a page.
 */
export function useSwipe(
  onSwipe: (direction: 1 | -1) => void,
  options: { enabled?: boolean; minDistance?: number } = {},
) {
  const enabled = options.enabled ?? true;
  const minDistance = options.minDistance ?? 55;

  const start = useRef<{ x: number; y: number; time: number } | null>(null);
  const handler = useRef(onSwipe);

  useEffect(() => {
    handler.current = onSwipe;
  });

  useEffect(() => {
    if (!enabled) return;

    function onTouchStart(event: TouchEvent) {
      // Two fingers means a pinch, not a page turn.
      if (event.touches.length !== 1) {
        start.current = null;
        return;
      }
      const touch = event.touches[0]!;
      start.current = { x: touch.clientX, y: touch.clientY, time: Date.now() };
    }

    function onTouchEnd(event: TouchEvent) {
      const from = start.current;
      start.current = null;
      if (!from) return;

      const touch = event.changedTouches[0];
      if (!touch) return;

      const dx = touch.clientX - from.x;
      const dy = touch.clientY - from.y;
      const elapsed = Date.now() - from.time;

      if (Math.abs(dx) < minDistance) return;
      // Mostly horizontal, or it was a scroll.
      if (Math.abs(dx) < Math.abs(dy) * 1.6) return;
      // A slow drag is a scroll or a text selection.
      if (elapsed > 700) return;

      // Swiping left advances, the way every reader on a phone behaves.
      handler.current(dx < 0 ? 1 : -1);
    }

    window.addEventListener('touchstart', onTouchStart, { passive: true });
    window.addEventListener('touchend', onTouchEnd, { passive: true });
    return () => {
      window.removeEventListener('touchstart', onTouchStart);
      window.removeEventListener('touchend', onTouchEnd);
    };
  }, [enabled, minDistance]);
}

/**
 * Tracks a media query.
 *
 * Uses useSyncExternalStore rather than state plus an effect: matchMedia *is*
 * an external store, and reading it through the proper channel means the first
 * render already has the right answer instead of correcting itself afterwards.
 */
export function useMediaQuery(query: string) {
  const subscribe = useCallback(
    (onChange: () => void) => {
      const media = window.matchMedia(query);
      media.addEventListener('change', onChange);
      return () => media.removeEventListener('change', onChange);
    },
    [query],
  );

  return useSyncExternalStore(
    subscribe,
    () => window.matchMedia(query).matches,
    // On the server there is no viewport. `false` keeps the narrow layout as
    // the server-rendered default, which is the safe direction to be wrong in.
    () => false,
  );
}

/**
 * True once the client has taken over.
 *
 * Anything read from localStorage — reading settings, saved positions — is only
 * correct after hydration. Going through useSyncExternalStore gives React a
 * distinct server snapshot, so the first client render matches the server and
 * then updates, instead of mismatching.
 */
const noopSubscribe = () => () => {};

export function useHydrated() {
  return useSyncExternalStore(
    noopSubscribe,
    () => true,
    () => false,
  );
}

/**
 * Seconds of *actual* reading, for stats and streaks.
 *
 * Stops counting when the tab is hidden or the reader idles, so leaving a book
 * open overnight does not claim eight hours of reading.
 */
export function useReadingClock(active: boolean, idleAfterMs = 90_000) {
  const seconds = useRef(0);
  // Date.now() during render would be an impure read; the clock starts when the
  // effect does, which is also when reading actually starts.
  const lastActivity = useRef(0);

  useEffect(() => {
    if (!active) return;

    lastActivity.current = Date.now();

    function markActive() {
      lastActivity.current = Date.now();
    }

    const events: (keyof WindowEventMap)[] = ['pointermove', 'keydown', 'wheel', 'touchstart'];
    for (const event of events) window.addEventListener(event, markActive, { passive: true });

    const tick = setInterval(() => {
      if (document.visibilityState !== 'visible') return;
      if (Date.now() - lastActivity.current > idleAfterMs) return;
      seconds.current += 1;
    }, 1000);

    return () => {
      clearInterval(tick);
      for (const event of events) window.removeEventListener(event, markActive);
    };
  }, [active, idleAfterMs]);

  return {
    /** Reads the accumulated seconds and resets, so each save reports a delta. */
    take: () => {
      const value = seconds.current;
      seconds.current = 0;
      return value;
    },
    peek: () => seconds.current,
  };
}
