import { Note, Song } from './song';

export type HandMode = 'R' | 'L' | 'both' | 'listen';
export type NoteStatus = 'pending' | 'hit' | 'missed';
export type PressResult = 'hit' | 'wrong' | 'free';

/** How far from a note, in real seconds, a press still counts. */
export const HIT_WINDOW = 0.2;
export const LEAD_IN = -2;
const END_PADDING = 0.3;
/** Notes this close together count as one chord. */
const CHORD_SPREAD = 0.03;

/**
 * The rules of a practice run, kept free of audio and DOM. `tick` moves the song
 * forward and reports the notes the app must play itself; `press` scores a key.
 */
export class PracticeSession {
  t = LEAD_IN;
  playing = false;
  finished = false;
  waiting = false;
  wait = true;
  speed = 1;
  hits = 0;
  misses = 0;
  wrong = 0;
  loop: { a: number; b: number } | null = null;
  readonly status: NoteStatus[];

  /** Next note not yet sent to `tick`'s auto-play check. */
  private cursor = 0;
  /** Every note before this one is settled: other hand, hit, or missed. */
  private settled = 0;

  constructor(readonly song: Song, readonly mode: HandMode) {
    this.status = song.notes.map(() => 'pending');
  }

  isUserNote(note: Note): boolean {
    return this.mode === 'both' || note.hand === this.mode;
  }

  tick(dt: number): Note[] {
    if (!this.playing) return [];
    let next = this.t + dt * this.speed;
    this.waiting = false;
    this.settle(next);

    if (this.wait) {
      const blocker = this.song.notes[this.settled];
      if (blocker && next >= blocker.time) {
        next = blocker.time;
        this.waiting = true;
      }
    }

    if (this.loop && next >= this.loop.b) {
      this.seek(this.loop.a);
      return [];
    }

    const auto: Note[] = [];
    const { notes } = this.song;
    for (; this.cursor < notes.length && notes[this.cursor].time < next; this.cursor++) {
      if (!this.isUserNote(notes[this.cursor])) auto.push(notes[this.cursor]);
    }
    this.t = next;

    if (this.t >= this.song.duration + END_PADDING) {
      this.playing = false;
      this.finished = true;
    }
    return auto;
  }

  private settle(next: number) {
    const { notes } = this.song;
    const missedBefore = next - HIT_WINDOW * this.speed;
    while (this.settled < notes.length) {
      const note = notes[this.settled];
      if (this.isUserNote(note) && this.status[this.settled] === 'pending') {
        if (this.wait || note.time >= missedBefore) return;
        this.status[this.settled] = 'missed';
        this.misses++;
      }
      this.settled++;
    }
  }

  press(midi: number): PressResult {
    if (!this.playing || this.mode === 'listen') return 'free';
    const { notes } = this.song;
    const reach = HIT_WINDOW * this.speed;
    for (let i = this.settled; i < notes.length && notes[i].time <= this.t + reach; i++) {
      const note = notes[i];
      if (note.midi === midi && this.status[i] === 'pending' && this.isUserNote(note) && note.time >= this.t - reach) {
        this.status[i] = 'hit';
        this.hits++;
        return 'hit';
      }
    }
    this.wrong++;
    return 'wrong';
  }

  /** Keys to light up: the notes the player should be pressing right now. */
  expected(): Note[] {
    const { notes } = this.song;
    const reach = HIT_WINDOW * this.speed;
    const out: Note[] = [];
    for (let i = this.settled; i < notes.length && notes[i].time <= this.t + reach; i++) {
      if (this.status[i] === 'pending' && this.isUserNote(notes[i])) out.push(notes[i]);
    }
    return out;
  }

  /** The next note or chord to play, however far away it still is. */
  nextChord(): Note[] {
    const { notes } = this.song;
    const out: Note[] = [];
    for (let i = this.settled; i < notes.length; i++) {
      if (out.length > 0 && notes[i].time > out[0].time + CHORD_SPREAD) break;
      if (this.status[i] === 'pending' && this.isUserNote(notes[i])) out.push(notes[i]);
    }
    return out;
  }

  /** True once every note the player owns has been played or missed. */
  get complete(): boolean {
    return this.song.notes.every((note, i) => !this.isUserNote(note) || this.status[i] !== 'pending');
  }

  /** Moves to `t`; notes from there on can be played and scored again. */
  seek(t: number) {
    const { notes } = this.song;
    this.t = t;
    this.finished = false;
    this.waiting = false;
    this.cursor = notes.findIndex((n) => n.time >= t);
    if (this.cursor < 0) this.cursor = notes.length;
    this.settled = this.cursor;
    for (let i = this.cursor; i < notes.length; i++) this.status[i] = 'pending';
  }

  restart() {
    this.status.fill('pending');
    this.hits = this.misses = this.wrong = 0;
    this.seek(this.loop ? this.loop.a : LEAD_IN);
    this.playing = true;
  }

  get accuracy(): number | null {
    const total = this.hits + this.misses + this.wrong;
    return total === 0 ? null : Math.round((this.hits / total) * 100);
  }
}
