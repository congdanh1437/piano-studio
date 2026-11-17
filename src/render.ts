import { BLACK_KEY_HEIGHT, Key } from './keyboard';
import { PracticeSession } from './practice';
import { Hand } from './song';

/** Seconds of song visible above the keyboard. */
const LOOKAHEAD = 3;
const SOLFEGE = ['Đô', 'Đô#', 'Rê', 'Rê#', 'Mi', 'Fa', 'Fa#', 'Sol', 'Sol#', 'La', 'La#', 'Si'];

const COLORS = {
  stage: '#11141c',
  lane: '#1a1f2b',
  octave: '#2a3040',
  hitLine: '#f5f1e6',
  white: '#f5f1e6',
  whiteEdge: '#b9b4a6',
  black: '#1b1e27',
  label: '#6d6a60',
  hit: '#5fd38d',
  missed: '#59606f',
  wrong: '#ef6461',
  hand: { R: '#4fd1c5', L: '#f6a04d' } as Record<Hand, string>,
  accompany: { R: '#2b6f6a', L: '#85592f' } as Record<Hand, string>,
};

export interface View {
  width: number;
  height: number;
  keyboardHeight: number;
  keys: Key[];
  /** What each currently held key should show. */
  pressed: Map<number, 'hit' | 'wrong' | 'free'>;
  /** Computer key for each piano note; empty when the hints are off. */
  keyLabels: Map<number, string>;
}

export function draw(ctx: CanvasRenderingContext2D, view: View, session: PracticeSession) {
  const { width, height, keyboardHeight, keys } = view;
  const laneHeight = height - keyboardHeight;
  ctx.fillStyle = COLORS.stage;
  ctx.fillRect(0, 0, width, height);
  drawLanes(ctx, view, laneHeight);
  drawNotes(ctx, view, session, laneHeight);
  ctx.fillStyle = COLORS.hitLine;
  ctx.fillRect(0, laneHeight - 2, width, 2);
  drawKeys(ctx, view, session, laneHeight, keyboardHeight, keys);
  drawNextCue(ctx, view, session);
}

function drawLanes(ctx: CanvasRenderingContext2D, view: View, laneHeight: number) {
  ctx.fillStyle = COLORS.octave;
  for (const key of view.keys) {
    if (key.midi % 12 === 0) ctx.fillRect(key.x, 0, 1, laneHeight);
  }
}

function drawNotes(ctx: CanvasRenderingContext2D, view: View, session: PracticeSession, laneHeight: number) {
  const byMidi = new Map(view.keys.map((k) => [k.midi, k]));
  const pxPerSecond = laneHeight / LOOKAHEAD;
  const { notes } = session.song;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  notes.forEach((note, i) => {
    const bottom = laneHeight - (note.time - session.t) * pxPerSecond;
    const noteHeight = Math.max(note.duration * pxPerSecond, 8);
    if (bottom < 0 || bottom - noteHeight > laneHeight) return;
    const key = byMidi.get(note.midi);
    if (!key) return;

    const isUser = session.isUserNote(note);
    const status = session.status[i];
    ctx.fillStyle = !isUser
      ? session.mode === 'listen'
        ? COLORS.hand[note.hand]
        : COLORS.accompany[note.hand]
      : status === 'hit'
        ? COLORS.hit
        : status === 'missed'
          ? COLORS.missed
          : COLORS.hand[note.hand];
    ctx.beginPath();
    ctx.roundRect(key.x + 1, bottom - noteHeight, key.w - 2, noteHeight, 5);
    ctx.fill();

    const label = view.keyLabels.get(note.midi) ?? SOLFEGE[note.midi % 12];
    if (isUser && status === 'pending' && noteHeight > 18 && key.w > 14) {
      ctx.fillStyle = COLORS.stage;
      ctx.font = `700 ${Math.min(15, key.w * 0.5)}px system-ui, sans-serif`;
      ctx.fillText(label, key.x + key.w / 2, bottom - 11);
    }
  });
}

function drawKeyCap(ctx: CanvasRenderingContext2D, key: Key, label: string, y: number, onBlackKey: boolean) {
  const size = Math.min(26, key.w - 4);
  if (size < 12) return;
  const x = key.x + key.w / 2 - size / 2;
  ctx.fillStyle = onBlackKey ? COLORS.white : COLORS.black;
  ctx.beginPath();
  ctx.roundRect(x, y, size, size, 5);
  ctx.fill();
  ctx.fillStyle = onBlackKey ? COLORS.black : COLORS.white;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = `700 ${Math.round(size * 0.58)}px system-ui, sans-serif`;
  ctx.fillText(label, key.x + key.w / 2, y + size / 2 + 1);
}

function drawKeys(
  ctx: CanvasRenderingContext2D,
  view: View,
  session: PracticeSession,
  top: number,
  height: number,
  keys: Key[],
) {
  const expected = new Map(session.expected().map((n) => [n.midi, COLORS.hand[n.hand]]));
  const fill = (key: Key, base: string) => {
    const pressed = view.pressed.get(key.midi);
    if (pressed === 'hit') return COLORS.hit;
    if (pressed === 'wrong') return COLORS.wrong;
    if (pressed === 'free') return '#9aa5bd';
    return expected.get(key.midi) ?? base;
  };

  for (const key of keys) {
    if (key.black) continue;
    ctx.fillStyle = fill(key, COLORS.white);
    ctx.fillRect(key.x, top, key.w, height);
    ctx.fillStyle = COLORS.whiteEdge;
    ctx.fillRect(key.x + key.w - 1, top, 1, height);
    ctx.fillStyle = COLORS.label;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'alphabetic';
    ctx.font = `${key.midi % 12 === 0 ? 700 : 500} ${Math.min(14, key.w * 0.36)}px system-ui, sans-serif`;
    ctx.fillText(SOLFEGE[key.midi % 12], key.x + key.w / 2, top + height - 10);
    const label = view.keyLabels.get(key.midi);
    if (label) drawKeyCap(ctx, key, label, top + height - 56, false);
  }
  for (const key of keys) {
    if (!key.black) continue;
    ctx.fillStyle = fill(key, COLORS.black);
    ctx.beginPath();
    ctx.roundRect(key.x, top, key.w, height * BLACK_KEY_HEIGHT, [0, 0, 4, 4]);
    ctx.fill();
    const label = view.keyLabels.get(key.midi);
    if (label) drawKeyCap(ctx, key, label, top + height * BLACK_KEY_HEIGHT - Math.min(26, key.w - 4) - 6, true);
  }
}

/** Says in words what to press next, so nobody has to hunt for it on the keys. */
function drawNextCue(ctx: CanvasRenderingContext2D, view: View, session: PracticeSession) {
  const chord = session.nextChord();
  if (chord.length === 0 || session.finished) return;
  const names = [...new Set(chord.map((n) => n.midi))].map((midi) => {
    const key = view.keyLabels.get(midi);
    return key ? `${key} (${SOLFEGE[midi % 12]})` : SOLFEGE[midi % 12];
  });
  const text = `Tiếp theo: ${names.join(' + ')}`;
  ctx.font = '700 17px system-ui, sans-serif';
  const width = ctx.measureText(text).width + 32;
  const x = view.width / 2 - width / 2;
  ctx.fillStyle = 'rgba(26, 31, 43, 0.92)';
  ctx.beginPath();
  ctx.roundRect(x, 12, width, 36, 18);
  ctx.fill();
  ctx.fillStyle = COLORS.white;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, view.width / 2, 31);
}
