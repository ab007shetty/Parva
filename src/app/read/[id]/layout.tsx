import { Atkinson_Hyperlegible, Literata, Newsreader } from 'next/font/google';

/**
 * Reading faces load only here.
 *
 * next/font scopes its CSS to the route that imports it, so a visitor browsing
 * the catalogue never downloads three text faces they will not see. They arrive
 * with the reader, which is the only place they are ever painted.
 *
 * The three are a deliberate spread rather than three of the same thing:
 * Newsreader is a modern text serif, Literata was drawn for long-form reading
 * on screens, and Atkinson Hyperlegible was designed by the Braille Institute
 * to keep similar letterforms distinguishable for readers with low vision.
 */

const newsreader = Newsreader({
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-newsreader',
  style: ['normal', 'italic'],
});

const literata = Literata({
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-literata',
  style: ['normal', 'italic'],
});

const atkinson = Atkinson_Hyperlegible({
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-atkinson',
  weight: ['400', '700'],
});

export default function ReadLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className={`${newsreader.variable} ${literata.variable} ${atkinson.variable}`}>{children}</div>
  );
}
