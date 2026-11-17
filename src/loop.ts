/**
 * The timing rules of the live looper, kept free of audio so they can be tested.
 * Positions are in beats, so a tempo change moves every recorded note with it.
 */

export const BEATS_PER_BAR = 4;
export const LOOP_BAR_CHOICES = [1, 2, 4, 8];
const MIN_NOTE_BEATS = 0.05;
const ONE_SHOT_BEATS = 0.25;

export type InstrumentId = 'piano' | 'ep' | 'pad' | 'sine' | 'bass' | 'drums';

export interface LoopNote {
  /** Beat within the loop where the note starts. */
  at: number;
  /** Length in beats. */
  length: number;
  midi: number;
  velocity: number;
  /** The pass it was played in, which already sounded live and must not play twice. */
  pass: number;
}

export interface Layer {
  id: string;
  instrument: InstrumentId;
  notes: LoopNote[];
  muted: boolean;
  volume: number;
}

export interface LoopSession {
  bpm: number;
  bars: number;
  layers: Layer[];
  fx: { filter: number; delay: number; reverb: number };
  updatedAt: number;
}

export function emptySession(): LoopSession {
  return { bpm: 100, bars: 2, layers: [], fx: { filter: 1, delay: 0, reverb: 0.2 }, updatedAt: Date.now() };
}

export const loopBeats = (session: Pick<LoopSession, 'bars'>) => session.bars * BEATS_PER_BAR;

/** Maps audio-clock time to a pass of the loop and a beat within it. */
export class Transport {
  constructor(
    /** Audio time at which pass 0 begins. */
    public start: number,
    public bpm: number,
    public beats: number,
  ) {}

  elapsed(time: number): number {
    return ((time - this.start) * this.bpm) / 60;
  }

  position(time: number): { pass: number; beat: number } {
    const elapsed = this.elapsed(time);
    const pass = Math.floor(elapsed / this.beats);
    return { pass, beat: elapsed - pass * this.beats };
  }

  timeOf(pass: number, beat: number): number {
    return this.start + ((pass * this.beats + beat) * 60) / this.bpm;
  }

  /** Changes tempo without moving the playhead. */
  setBpm(now: number, bpm: number) {
    const elapsed = this.elapsed(now);
    this.bpm = bpm;
    this.start = now - (elapsed * 60) / bpm;
  }
}

/**
 * Snaps a played position to the grid. A note played just before the loop comes round
 * belongs to the next pass, at beat 0.
 */
export function snap(pass: number, beat: number, grid: number, beats: number): { pass: number; beat: number } {
  if (grid <= 0) return { pass, beat };
  const snapped = Math.round(beat / grid) * grid;
  return snapped >= beats - 1e-9 ? { pass: pass + 1, beat: 0 } : { pass, beat: snapped };
}

/** Turns presses and releases into notes on one layer. */
export class TakeRecorder {
  private held = new Map<number, { pass: number; at: number; elapsed: number; velocity: number }>();

  constructor(
    readonly layer: Layer,
    private readonly transport: Transport,
    /** Grid in beats, or 0 to keep timing exactly as played. */
    private readonly grid: number,
    /** Seconds between pressing and hearing; presses follow what was heard, so they are that late. */
    private readonly latency: number,
    /** Drums ring out by themselves, so their notes are complete the moment they are hit. */
    private readonly oneShot: boolean,
  ) {}

  noteOn(midi: number, velocity: number, time: number) {
    const heard = time - this.latency;
    const raw = this.transport.position(heard);
    const { pass, beat } = snap(raw.pass, raw.beat, this.grid, this.transport.beats);
    if (this.oneShot) {
      this.layer.notes.push({ at: beat, length: ONE_SHOT_BEATS, midi, velocity, pass });
      return;
    }
    this.held.set(midi, { pass, at: beat, elapsed: this.transport.elapsed(heard), velocity });
  }

  noteOff(midi: number, time: number) {
    const start = this.held.get(midi);
    if (!start) return;
    this.held.delete(midi);
    const played = this.transport.elapsed(time - this.latency) - start.elapsed;
    const length = Math.min(this.transport.beats, Math.max(MIN_NOTE_BEATS, played));
    this.layer.notes.push({ at: start.at, length, midi, velocity: start.velocity, pass: start.pass });
  }

  /** Ends any note still held, as when recording stops mid-note. */
  releaseAll(time: number) {
    for (const midi of [...this.held.keys()]) this.noteOff(midi, time);
  }
}

export interface Scheduled {
  layer: Layer;
  note: LoopNote;
  time: number;
}

/** Every note that should start in [from, to), across loop boundaries. */
export function notesBetween(layers: Layer[], transport: Transport, from: number, to: number): Scheduled[] {
  const out: Scheduled[] = [];
  const first = Math.max(0, transport.position(from).pass);
  const last = transport.position(to).pass;
  for (let pass = first; pass <= last; pass++) {
    for (const layer of layers) {
      if (layer.muted) continue;
      for (const note of layer.notes) {
        if (note.pass === pass) continue;
        const time = transport.timeOf(pass, note.at);
        if (time >= from && time < to) out.push({ layer, note, time });
      }
    }
  }
  return out.sort((a, b) => a.time - b.time);
}

export const QUANTIZE_CHOICES: { label: string; grid: number }[] = [
  { label: 'Không căn nhịp', grid: 0 },
  { label: 'Căn theo 1/8', grid: 0.5 },
  { label: 'Căn theo 1/16', grid: 0.25 },
];
