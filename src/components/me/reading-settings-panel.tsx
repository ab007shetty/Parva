'use client';

import { useEffect, useState } from 'react';

import { Select } from '@/components/ui/select';
import { READER_FONTS, READER_TONES } from '@/lib/config';
import { useReaderSettings } from '@/lib/reader/store';
import { readAloud } from '@/lib/reader/speech';
import { useHydrated } from '@/hooks/use-reader-interaction';
import { cn } from '@/lib/utils';

/**
 * The same settings the reader exposes, reachable before opening a book — so
 * someone who knows they need large type or the hyperlegible face can set it
 * once instead of discovering the panel mid-chapter.
 *
 * The specimen at the top is the point: it renders in the exact face, size,
 * spacing and tone that a book will, so the choice is made by looking rather
 * than guessing.
 */
export function ReadingSettingsPanel() {
  const settings = useReaderSettings();
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  // Settings come from localStorage, so they are only correct once the client
  // has taken over. Until then the specimen renders the defaults, which is what
  // the server sent.
  const ready = useHydrated();

  useEffect(() => {
    void readAloud.voices().then(setVoices);
  }, []);

  const face = READER_FONTS.find((f) => f.key === settings.fontFamily) ?? READER_FONTS[0]!;
  const tone = READER_TONES.find((t) => t.key === settings.tone) ?? READER_TONES[0]!;

  return (
    <section>
      <p className="label mb-4">How a page will look</p>

      {/* The specimen. Real prose, because lorem ipsum cannot tell you whether a
          face is comfortable to read. */}
      <div
        className="border border-rule p-6 transition-colors sm:p-8"
        style={{ background: tone.swatch }}
      >
        <p
          suppressHydrationWarning
          style={{
            fontFamily: ready ? face.stack : 'var(--font-read-serif)',
            fontSize: `${(ready ? settings.fontScale : 1) * 1.0625}rem`,
            lineHeight: ready ? settings.lineHeight : 1.6,
            textAlign: ready && settings.justify ? 'justify' : 'left',
            hyphens: ready && settings.justify ? 'auto' : 'manual',
            color: settings.tone === 'night' ? '#e6e6e6' : '#2e2e2e',
            paddingInline: `${(ready ? settings.margin : 1) * 4}px`,
          }}
        >
          A book is a physical thing before it is anything else — paper, a spine, the
          weight of the pages you have already turned held in one hand. A screen has none
          of that, so it has to earn the same attention by getting the small things right:
          the shape of the letters, how much air sits between the lines, where the margin
          falls.
        </p>
      </div>

      <div className="mt-8 divide-y divide-rule border-y border-rule">
        <Row label="Reading face">
          <div className="grid gap-1.5 sm:grid-cols-2">
            {READER_FONTS.map((font) => (
              <button
                key={font.key}
                type="button"
                onClick={() => settings.set('fontFamily', font.key)}
                aria-pressed={settings.fontFamily === font.key}
                className={cn(
                  'flex items-baseline justify-between gap-3 border px-3 py-2.5 text-left transition-colors',
                  settings.fontFamily === font.key ? 'border-ink' : 'border-rule hover:border-mute',
                )}
              >
                <span className="text-[0.9375rem]" style={{ fontFamily: font.stack }}>
                  {font.label}
                </span>
                {font.note && <span className="shrink-0 text-[0.625rem] text-mute">{font.note}</span>}
              </button>
            ))}
          </div>
        </Row>

        <Row label="Tone">
          <div className="flex gap-2">
            {READER_TONES.map((option) => (
              <button
                key={option.key}
                type="button"
                onClick={() => settings.set('tone', option.key)}
                aria-pressed={settings.tone === option.key}
                aria-label={option.label}
                className={cn(
                  'flex flex-1 flex-col items-center gap-2 border p-2.5 transition-colors',
                  settings.tone === option.key ? 'border-ink' : 'border-rule hover:border-mute',
                )}
              >
                <span
                  className="h-9 w-full border border-rule"
                  style={{ background: option.swatch }}
                  aria-hidden="true"
                />
                <span className="text-[0.625rem] tracking-[0.08em] uppercase">{option.label}</span>
              </button>
            ))}
          </div>
        </Row>

        <Row label={`Text size — ${Math.round(settings.fontScale * 100)}%`}>
          <Range min={0.7} max={2.4} step={0.05} value={settings.fontScale} onChange={(v) => settings.set('fontScale', v)} />
        </Row>

        <Row label={`Line spacing — ${settings.lineHeight.toFixed(2)}`}>
          <Range min={1.1} max={2.4} step={0.05} value={settings.lineHeight} onChange={(v) => settings.set('lineHeight', v)} />
        </Row>

        <Row label={`Margins — ${settings.margin.toFixed(1)}×`}>
          <Range min={0} max={6} step={0.5} value={settings.margin} onChange={(v) => settings.set('margin', v)} />
        </Row>

        <Row label="Page layout" hint="Two pages needs a wide window; a phone always shows one.">
          <div className="flex border border-rule">
            {(['spread', 'single', 'scroll'] as const).map((option, i) => (
              <button
                key={option}
                type="button"
                onClick={() => settings.set('layout', option)}
                aria-pressed={settings.layout === option}
                className={cn(
                  'flex-1 px-3 py-2.5 text-[0.8125rem] transition-colors',
                  i > 0 && 'border-l border-rule',
                  settings.layout === option ? 'ink-fill' : 'text-graphite hover:bg-wash hover:text-ink',
                )}
              >
                {option === 'spread' ? 'Two pages' : option === 'single' ? 'One page' : 'Scroll'}
              </button>
            ))}
          </div>
        </Row>

        <Row label="Justify text" hint="Justified with hyphenation, as a printed book sets it.">
          <Switch checked={settings.justify} onChange={(v) => settings.set('justify', v)} label="Justify text" />
        </Row>

        <Row label="Animate page turns" hint="Ignored if your system asks for reduced motion.">
          <Switch
            checked={settings.animatePageTurn}
            onChange={(v) => settings.set('animatePageTurn', v)}
            label="Animate page turns"
          />
        </Row>

        <Row label="Read-aloud voice" hint="Voices come from this device, so nothing is sent anywhere.">
          {voices.length ? (
            <Select
              label="Read-aloud voice"
              size="md"
              block
              value={settings.speechVoiceURI ?? ''}
              onChange={(value) => settings.set('speechVoiceURI', value || null)}
              options={[
                { value: '', label: 'System default' },
                ...voices.map((voice) => ({
                  value: voice.voiceURI,
                  label: voice.name,
                  note: voice.lang,
                })),
              ]}
            />
          ) : (
            <p className="text-[0.75rem] text-mute">No speech voices are installed on this device.</p>
          )}
        </Row>

        <Row label={`Reading speed — ${settings.speechRate.toFixed(1)}×`}>
          <Range min={0.5} max={2.5} step={0.1} value={settings.speechRate} onChange={(v) => settings.set('speechRate', v)} />
        </Row>
      </div>

      <button
        type="button"
        onClick={() => settings.reset()}
        className="link-rule mt-5 text-[0.75rem] text-graphite hover:text-ink"
      >
        Reset to defaults
      </button>
    </section>
  );
}

function Row({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="grid gap-3 py-5 sm:grid-cols-[11rem_1fr] sm:gap-6">
      <div>
        <p className="text-[0.8125rem] text-ink">{label}</p>
        {hint && <p className="mt-1 text-[0.6875rem] leading-relaxed text-mute">{hint}</p>}
      </div>
      <div className="min-w-0">{children}</div>
    </div>
  );
}

function Range({
  min,
  max,
  step,
  value,
  onChange,
}: {
  min: number;
  max: number;
  step: number;
  value: number;
  onChange: (value: number) => void;
}) {
  const filled = ((value - min) / (max - min)) * 100;
  return (
    <div className="relative flex h-6 items-center">
      <div className="pointer-events-none absolute inset-x-0 h-[3px] bg-rule">
        <div className="h-full bg-ink" style={{ width: `${Math.max(0, Math.min(100, filled))}%` }} />
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="relative z-10 h-6 w-full cursor-pointer appearance-none bg-transparent [&::-moz-range-thumb]:size-3 [&::-moz-range-thumb]:cursor-pointer [&::-moz-range-thumb]:appearance-none [&::-moz-range-thumb]:border-0 [&::-moz-range-thumb]:bg-ink [&::-webkit-slider-thumb]:size-3 [&::-webkit-slider-thumb]:cursor-pointer [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:bg-ink"
      />
    </div>
  );
}

function Switch({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: (value: boolean) => void;
  label: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className={cn(
        'flex h-6 w-11 items-center border p-0.5 transition-colors',
        checked ? 'border-ink bg-ink' : 'border-rule bg-transparent',
      )}
    >
      <span
        className={cn('size-4 transition-transform', checked ? 'translate-x-5 bg-paper' : 'translate-x-0 bg-mute')}
      />
    </button>
  );
}
