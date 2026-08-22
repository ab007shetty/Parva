'use client';

/**
 * Read-aloud, on the Web Speech API.
 *
 * This uses the voices already on the device, so it costs nothing, needs no key
 * and works offline. It is also the single biggest accessibility feature in the
 * app: a scanned PDF with a text layer becomes listenable.
 *
 * The awkward part of speechSynthesis is that it is a global singleton with no
 * reliable queue introspection, and Chrome cuts long utterances off. So text is
 * split into sentence-sized utterances and spoken one at a time, which also
 * makes pause, resume and "skip to next sentence" behave.
 */

export type SpeechState = 'idle' | 'speaking' | 'paused';

export type SpeechHandle = {
  state: SpeechState;
  /** Index of the sentence currently being spoken. */
  index: number;
  total: number;
};

type Listener = (handle: SpeechHandle) => void;

/** Splits on sentence ends, keeping the punctuation, and merges fragments too
 *  short to be worth an utterance of their own. */
export function splitSentences(text: string, maxChars = 240): string[] {
  const cleaned = text.replace(/\s+/g, ' ').trim();
  if (!cleaned) return [];

  const rough = cleaned.match(/[^.!?…]+[.!?…]+(\s|$)|[^.!?…]+$/g) ?? [cleaned];

  const out: string[] = [];
  let buffer = '';

  for (const piece of rough) {
    const sentence = piece.trim();
    if (!sentence) continue;

    if (buffer.length + sentence.length + 1 <= maxChars) {
      buffer = buffer ? `${buffer} ${sentence}` : sentence;
    } else {
      if (buffer) out.push(buffer);
      // A single sentence longer than the cap still has to be broken, or
      // Chrome truncates it mid-word.
      if (sentence.length > maxChars) {
        for (let i = 0; i < sentence.length; i += maxChars) {
          out.push(sentence.slice(i, i + maxChars));
        }
        buffer = '';
      } else {
        buffer = sentence;
      }
    }
  }
  if (buffer) out.push(buffer);

  return out;
}

class ReadAloud {
  private sentences: string[] = [];
  private cursor = 0;
  private state: SpeechState = 'idle';
  private listeners = new Set<Listener>();
  private current: SpeechSynthesisUtterance | null = null;
  private voiceURI: string | null = null;
  private rate = 1;
  /** Set while we cancel deliberately, so the `end` handler does not advance. */
  private stopping = false;

  get supported() {
    return typeof window !== 'undefined' && 'speechSynthesis' in window;
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    listener(this.snapshot());
    // Returns void rather than Set.delete's boolean, so it can be used directly
    // as a React effect cleanup.
    return () => {
      this.listeners.delete(listener);
    };
  }

  private snapshot(): SpeechHandle {
    return { state: this.state, index: this.cursor, total: this.sentences.length };
  }

  private emit() {
    const snapshot = this.snapshot();
    for (const listener of this.listeners) listener(snapshot);
  }

  /** Voices load asynchronously in most browsers; resolve once they exist. */
  async voices(): Promise<SpeechSynthesisVoice[]> {
    if (!this.supported) return [];
    const existing = speechSynthesis.getVoices();
    if (existing.length) return existing;

    return new Promise((resolve) => {
      const timeout = setTimeout(() => resolve(speechSynthesis.getVoices()), 1200);
      speechSynthesis.addEventListener(
        'voiceschanged',
        () => {
          clearTimeout(timeout);
          resolve(speechSynthesis.getVoices());
        },
        { once: true },
      );
    });
  }

  configure({ voiceURI, rate }: { voiceURI?: string | null; rate?: number }) {
    if (voiceURI !== undefined) this.voiceURI = voiceURI;
    if (rate !== undefined) this.rate = Math.min(3, Math.max(0.5, rate));
  }

  start(text: string, startIndex = 0) {
    if (!this.supported) return;
    this.stop();

    this.sentences = splitSentences(text);
    this.cursor = Math.min(Math.max(0, startIndex), Math.max(0, this.sentences.length - 1));

    if (!this.sentences.length) {
      this.state = 'idle';
      this.emit();
      return;
    }

    this.state = 'speaking';
    this.emit();
    this.speakCurrent();
  }

  private async speakCurrent() {
    const sentence = this.sentences[this.cursor];
    if (!sentence) {
      this.state = 'idle';
      this.current = null;
      this.emit();
      return;
    }

    const utterance = new SpeechSynthesisUtterance(sentence);
    utterance.rate = this.rate;

    if (this.voiceURI) {
      const available = await this.voices();
      const voice = available.find((v) => v.voiceURI === this.voiceURI);
      if (voice) utterance.voice = voice;
    }

    utterance.onend = () => {
      if (this.stopping) return;
      this.cursor += 1;
      if (this.cursor >= this.sentences.length) {
        this.state = 'idle';
        this.current = null;
        this.emit();
        return;
      }
      this.emit();
      this.speakCurrent();
    };

    utterance.onerror = () => {
      // 'interrupted' and 'canceled' are our own doing; anything else stops.
      if (this.stopping) return;
      this.state = 'idle';
      this.current = null;
      this.emit();
    };

    this.current = utterance;
    speechSynthesis.speak(utterance);
  }

  pause() {
    if (!this.supported || this.state !== 'speaking') return;
    speechSynthesis.pause();
    this.state = 'paused';
    this.emit();
  }

  resume() {
    if (!this.supported || this.state !== 'paused') return;
    speechSynthesis.resume();
    this.state = 'speaking';
    this.emit();
  }

  next() {
    if (!this.supported || !this.sentences.length) return;
    this.cursor = Math.min(this.sentences.length - 1, this.cursor + 1);
    this.restartAtCursor();
  }

  previous() {
    if (!this.supported || !this.sentences.length) return;
    this.cursor = Math.max(0, this.cursor - 1);
    this.restartAtCursor();
  }

  private restartAtCursor() {
    this.stopping = true;
    speechSynthesis.cancel();
    this.stopping = false;
    this.state = 'speaking';
    this.emit();
    this.speakCurrent();
  }

  stop() {
    if (!this.supported) return;
    this.stopping = true;
    speechSynthesis.cancel();
    this.stopping = false;
    this.current = null;
    this.state = 'idle';
    this.cursor = 0;
    this.emit();
  }
}

/** One instance, because speechSynthesis itself is a singleton. */
export const readAloud = new ReadAloud();
