'use client';

import { useEffect, useRef } from 'react';
import { usePathname } from 'next/navigation';
import { ReactLenis, type LenisRef } from 'lenis/react';
import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';

/**
 * Lenis drives page scrolling; GSAP drives everything that reacts to it.
 *
 * Two things have to be true for them not to fight:
 *  1. ScrollTrigger updates from Lenis's scroll event, not the native one.
 *  2. Lenis advances on GSAP's ticker rather than its own rAF loop, so there is
 *     a single clock and no half-frame drift between a pinned element and the
 *     page behind it.
 *
 * The reader is deliberately excluded. A book viewport does its own
 * paging and inertial scroll there would feel like the page was sliding
 * out from under the reader's thumb.
 */

if (typeof window !== 'undefined') {
  gsap.registerPlugin(ScrollTrigger);
}

export function SmoothScroll({ children }: { children: React.ReactNode }) {
  const lenisRef = useRef<LenisRef>(null);
  const pathname = usePathname();

  // The reader owns its own scrolling.
  const enabled = !pathname?.startsWith('/read/');

  useEffect(() => {
    if (!enabled) return;

    function raf(time: number) {
      // GSAP's ticker reports seconds; Lenis expects milliseconds.
      lenisRef.current?.lenis?.raf(time * 1000);
    }

    gsap.ticker.add(raf);
    // Without this, a long frame makes GSAP fast-forward and the scroll jumps.
    gsap.ticker.lagSmoothing(0);

    // ScrollTrigger must recompute against Lenis's virtual scroll position,
    // not the native one it would otherwise read.
    const update = () => ScrollTrigger.update();
    const lenis = lenisRef.current?.lenis;
    lenis?.on('scroll', update);

    return () => {
      lenis?.off('scroll', update);
      gsap.ticker.remove(raf);
      gsap.ticker.lagSmoothing(500, 33);
    };
  }, [enabled]);

  // New route, new layout: measured trigger positions are stale.
  useEffect(() => {
    const lenis = lenisRef.current?.lenis;
    lenis?.resize();
    ScrollTrigger.refresh();
  }, [pathname]);

  if (!enabled) return <>{children}</>;

  return (
    <ReactLenis
      root
      ref={lenisRef}
      options={{
        // Lenis runs on the GSAP ticker instead.
        autoRaf: false,
        // A shelf should glide, not float. Higher lerp than the default keeps
        // it responsive so a flick still feels direct.
        lerp: 0.12,
        wheelMultiplier: 1,
        touchMultiplier: 1.6,
        // Native scrolling on touch. Overriding it on phones costs more in
        // feel than it gains.
        syncTouch: false,
        // Lenis disables smoothing itself when the reader asks for less motion.
        respectReducedMotion: true,
        // Anchor links (the footer, in-page jumps) go through Lenis so they
        // ease rather than snap.
        anchors: { offset: -96 },
        // Panels and the reader's inner scrollers keep native behaviour.
        allowNestedScroll: true,
      }}
    >
      {children}
    </ReactLenis>
  );
}
