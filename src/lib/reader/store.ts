'use client';

import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';

import { READER_DEFAULTS } from '@/lib/config';
import type { ReaderSettings } from '@/types';

/**
 * Reader settings live in one persisted store.
 *
 * They belong to the device, not the book: how large you like your type and
 * whether you read at night is a property of where you are reading, so it is
 * kept in localStorage and applies to every book you open. Reading *position*
 * is the opposite — it belongs to the book and the account — and lives in
 * Appwrite instead.
 */

export type ReaderSettingsStore = ReaderSettings & {
  set: <K extends keyof ReaderSettings>(key: K, value: ReaderSettings[K]) => void;
  patch: (values: Partial<ReaderSettings>) => void;
  reset: () => void;
};

const INITIAL: ReaderSettings = {
  layout: READER_DEFAULTS.layout,
  fit: READER_DEFAULTS.fit,
  zoom: READER_DEFAULTS.zoom,
  tone: READER_DEFAULTS.tone,
  fontFamily: READER_DEFAULTS.fontFamily,
  fontScale: READER_DEFAULTS.fontScale,
  lineHeight: READER_DEFAULTS.lineHeight,
  margin: READER_DEFAULTS.margin,
  justify: READER_DEFAULTS.justify,
  animatePageTurn: true,
  speechRate: 1,
  speechVoiceURI: null,
};

export const useReaderSettings = create<ReaderSettingsStore>()(
  persist(
    (setState) => ({
      ...INITIAL,
      set: (key, value) => setState({ [key]: value } as Partial<ReaderSettings>),
      patch: (values) => setState(values),
      reset: () => setState(INITIAL),
    }),
    {
      name: 'parva.reader.settings',
      version: 1,
      storage: createJSONStorage(() => localStorage),
      // Only the settings persist — the action functions would serialise to
      // nothing useful and would shadow the real ones on rehydrate.
      partialize: (state) => ({
        layout: state.layout,
        fit: state.fit,
        zoom: state.zoom,
        tone: state.tone,
        fontFamily: state.fontFamily,
        fontScale: state.fontScale,
        lineHeight: state.lineHeight,
        margin: state.margin,
        justify: state.justify,
        animatePageTurn: state.animatePageTurn,
        speechRate: state.speechRate,
        speechVoiceURI: state.speechVoiceURI,
      }),
    },
  ),
);

/* ═══════════════════════════════════════════════════════════════════
   Local position fallback

   Signed-in readers get their place stored in Appwrite. Everyone else still
   deserves to be put back where they stopped, so the last position is also
   written to localStorage — which doubles as the offline path when a save to
   Appwrite fails.
   ═══════════════════════════════════════════════════════════════════ */

const LOCAL_POSITION_KEY = 'parva.reader.positions';
/** Bounded so a heavy browser session cannot grow this without limit. */
const MAX_LOCAL_POSITIONS = 60;

export type LocalPosition = {
  bookId: string;
  locator: string;
  page: number;
  totalPages: number;
  percent: number;
  savedAt: number;
};

function readAll(): Record<string, LocalPosition> {
  if (typeof localStorage === 'undefined') return {};
  try {
    return JSON.parse(localStorage.getItem(LOCAL_POSITION_KEY) ?? '{}');
  } catch {
    return {};
  }
}

export function readLocalPosition(bookId: string): LocalPosition | null {
  return readAll()[bookId] ?? null;
}

export function writeLocalPosition(position: Omit<LocalPosition, 'savedAt'>) {
  if (typeof localStorage === 'undefined') return;
  try {
    const all = readAll();
    all[position.bookId] = { ...position, savedAt: Date.now() };

    // Drop the least recently saved once over the cap.
    const entries = Object.entries(all).sort((a, b) => b[1].savedAt - a[1].savedAt);
    const trimmed = Object.fromEntries(entries.slice(0, MAX_LOCAL_POSITIONS));

    localStorage.setItem(LOCAL_POSITION_KEY, JSON.stringify(trimmed));
  } catch {
    // A full or disabled localStorage costs the fallback, not the reading.
  }
}

/* ═══════════════════════════════════════════════════════════════════
   Cached EPUB location indexes

   Generating an EPUB's location index walks the whole book. Caching the
   serialised result turns a several-second open into an instant one.
   ═══════════════════════════════════════════════════════════════════ */

const LOCATIONS_KEY = 'parva.reader.epubLocations';

export function readCachedLocations(bookId: string): string | null {
  if (typeof localStorage === 'undefined') return null;
  try {
    const all = JSON.parse(localStorage.getItem(LOCATIONS_KEY) ?? '{}');
    return typeof all[bookId] === 'string' ? all[bookId] : null;
  } catch {
    return null;
  }
}

export function writeCachedLocations(bookId: string, serialized: string) {
  if (typeof localStorage === 'undefined') return;
  try {
    const all = JSON.parse(localStorage.getItem(LOCATIONS_KEY) ?? '{}');
    all[bookId] = serialized;

    // These are large. Keep only the handful of books being read right now.
    const keys = Object.keys(all);
    if (keys.length > 8) {
      for (const key of keys.slice(0, keys.length - 8)) delete all[key];
    }

    localStorage.setItem(LOCATIONS_KEY, JSON.stringify(all));
  } catch {
    // Over quota. The book still opens, just slower next time.
  }
}
