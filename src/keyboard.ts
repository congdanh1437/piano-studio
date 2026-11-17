import { Note } from './song';

export interface Key {
  midi: number;
  x: number;
  w: number;
  black: boolean;
}

export interface Range {
  lo: number;
  hi: number;
}

const BLACK_KEYS = new Set([1, 3, 6, 8, 10]);
const PIANO_LOW = 21;
const PIANO_HIGH = 108;
/** Fewer keys would only waste the screen; two octaves also leaves room to move. */
const MIN_WHITE_KEYS = 15;
export const BLACK_KEY_HEIGHT = 0.62;

export const isBlack = (midi: number) => BLACK_KEYS.has(((midi % 12) + 12) % 12);

const countWhite = (lo: number, hi: number) => {
  let count = 0;
  for (let m = lo; m <= hi; m++) if (!isBlack(m)) count++;
  return count;
};

/** Smallest white-to-white range holding these notes, so keys stay as wide as possible. */
export function fitRange(notes: Note[]): Range {
  if (notes.length === 0) return { lo: 60, hi: 84 };
  let lo = Math.max(PIANO_LOW, Math.min(...notes.map((n) => n.midi)) - 1);
  let hi = Math.min(PIANO_HIGH, Math.max(...notes.map((n) => n.midi)) + 1);
  while (countWhite(lo, hi) < MIN_WHITE_KEYS && (lo > PIANO_LOW || hi < PIANO_HIGH)) {
    if (hi < PIANO_HIGH) hi++;
    if (countWhite(lo, hi) < MIN_WHITE_KEYS && lo > PIANO_LOW) lo--;
  }
  if (isBlack(lo)) lo--;
  if (isBlack(hi)) hi++;
  return { lo, hi };
}

export function layoutKeys({ lo, hi }: Range, width: number): Key[] {
  const whiteWidth = width / countWhite(lo, hi);
  const blackWidth = whiteWidth * 0.62;
  const keys: Key[] = [];
  let whiteIndex = 0;
  for (let midi = lo; midi <= hi; midi++) {
    if (isBlack(midi)) {
      keys.push({ midi, x: whiteIndex * whiteWidth - blackWidth / 2, w: blackWidth, black: true });
    } else {
      keys.push({ midi, x: whiteIndex * whiteWidth, w: whiteWidth, black: false });
      whiteIndex++;
    }
  }
  return keys;
}

// Physical key positions (event.code), so Vietnamese input methods and Caps Lock don't matter.
const LOW_ROW = ['KeyZ', 'KeyS', 'KeyX', 'KeyD', 'KeyC', 'KeyV', 'KeyG', 'KeyB', 'KeyH', 'KeyN', 'KeyJ', 'KeyM', 'Comma', 'KeyL', 'Period', 'Semicolon', 'Slash'];
const HIGH_ROW = ['KeyQ', 'Digit2', 'KeyW', 'Digit3', 'KeyE', 'KeyR', 'Digit5', 'KeyT', 'Digit6', 'KeyY', 'Digit7', 'KeyU', 'KeyI', 'Digit9', 'KeyO', 'Digit0', 'KeyP', 'BracketLeft', 'Equal', 'BracketRight'];
const LOW_ROW_START = 48; // Z = Đô 3
const HIGH_ROW_START = 60; // Q = Đô giữa
const REACH_LOW = LOW_ROW_START;
const REACH_HIGH = HIGH_ROW_START + HIGH_ROW.length - 1;
const SYMBOLS: Record<string, string> = { Comma: ',', Period: '.', Semicolon: ';', Slash: '/', BracketLeft: '[', BracketRight: ']', Equal: '=' };

const codeLabel = (code: string) => SYMBOLS[code] ?? code.replace(/^(Key|Digit)/, '');

export function midiForCode(code: string, octaveShift: number): number | null {
  const high = HIGH_ROW.indexOf(code);
  if (high >= 0) return HIGH_ROW_START + high + octaveShift * 12;
  const low = LOW_ROW.indexOf(code);
  return low >= 0 ? LOW_ROW_START + low + octaveShift * 12 : null;
}

/** The two rows overlap by a few notes; those notes are labelled with the upper row. */
export function computerKeyLabels(octaveShift: number): Map<number, string> {
  const labels = new Map<number, string>();
  LOW_ROW.forEach((code, i) => labels.set(LOW_ROW_START + i + octaveShift * 12, codeLabel(code)));
  HIGH_ROW.forEach((code, i) => labels.set(HIGH_ROW_START + i + octaveShift * 12, codeLabel(code)));
  return labels;
}

/** Stays on the usual octave (Q = middle C) unless the notes need another one. */
export function fitOctaveShift(notes: Note[]): number {
  let best = 0;
  let bestCount = -1;
  for (const shift of [0, -1, 1, -2, 2, -3, 3]) {
    const count = notes.filter((n) => n.midi >= REACH_LOW + shift * 12 && n.midi <= REACH_HIGH + shift * 12).length;
    if (count > bestCount) {
      best = shift;
      bestCount = count;
    }
  }
  return best;
}

/** Black keys sit on top of white keys, so they win in the upper part of the keyboard. */
export function keyAt(keys: Key[], x: number, y: number, keyboardHeight: number): number | null {
  if (y < 0 || y > keyboardHeight) return null;
  const inside = (k: Key) => x >= k.x && x < k.x + k.w;
  if (y < keyboardHeight * BLACK_KEY_HEIGHT) {
    const black = keys.find((k) => k.black && inside(k));
    if (black) return black.midi;
  }
  return keys.find((k) => !k.black && inside(k))?.midi ?? null;
}
