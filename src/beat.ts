import { Midi } from '@tonejs/midi';

export const STEPS_PER_BAR = 16;
export const MAX_BARS = 4;
export const MELODY_ROWS = 8;

export type Part = 'drums' | 'bass' | 'lead';
export type ScaleName = 'minor' | 'major';

export interface Drum {
  id: string;
  name: string;
  /** Computer key that plays this pad. */
  code: string;
  keyLabel: string;
  /** General MIDI drum note, for MIDI export. */
  midi: number;
}

export const DRUMS: Drum[] = [
  { id: 'kick', name: 'Trống cái', code: 'KeyZ', keyLabel: 'Z', midi: 36 },
  { id: 'snare', name: 'Trống snare', code: 'KeyX', keyLabel: 'X', midi: 38 },
  { id: 'clap', name: 'Vỗ tay', code: 'KeyC', keyLabel: 'C', midi: 39 },
  { id: 'hat', name: 'Hi-hat đóng', code: 'KeyA', keyLabel: 'A', midi: 42 },
  { id: 'open', name: 'Hi-hat mở', code: 'KeyS', keyLabel: 'S', midi: 46 },
  { id: 'tom', name: 'Trống tom', code: 'KeyD', keyLabel: 'D', midi: 45 },
  { id: 'perc', name: 'Cowbell', code: 'KeyF', keyLabel: 'F', midi: 56 },
];

const SCALES: Record<ScaleName, number[]> = {
  minor: [0, 2, 3, 5, 7, 8, 10],
  major: [0, 2, 4, 5, 7, 9, 11],
};
const PART_OCTAVE = { bass: 2, lead: 4 };

export interface Beat {
  id: string;
  name: string;
  bpm: number;
  /** 0 is straight; higher pushes every off-beat sixteenth later. */
  swing: number;
  bars: number;
  root: number;
  scale: ScaleName;
  /** Row id ("kick", "bass0", "lead3") to the steps switched on. */
  grid: Record<string, number[]>;
  muted: string[];
  mix: Record<Part, number>;
  updatedAt: number;
  /** The imported recording, played underneath the grid to compare against. */
  backing?: Backing;
  /** A YouTube video to listen to while writing the beat by ear. */
  youtube?: YouTubeRef;
}

export interface YouTubeRef {
  videoId: string;
  start: number;
  loopA: number | null;
  loopB: number | null;
  /** Video playback speed. */
  rate: number;
  /** Whether the board's Play button also runs the video. */
  linked: boolean;
}

export interface Backing {
  audioId: string;
  name: string;
  /** Where the loop begins in the recording, in seconds. */
  start: number;
  /** The recording's own tempo, so it can follow tempo changes. */
  bpm: number;
  volume: number;
  on: boolean;
}

export const newBeatId = () => `beat-${Date.now()}-${Math.random().toString(36).slice(2)}`;

export function emptyBeat(name = 'Beat mới'): Beat {
  return {
    id: newBeatId(),
    name,
    bpm: 100,
    swing: 0,
    bars: 1,
    root: 0,
    scale: 'minor',
    grid: {},
    muted: [],
    mix: { drums: 0.9, bass: 0.8, lead: 0.6 },
    updatedAt: Date.now(),
  };
}

export const stepCount = (beat: Beat) => beat.bars * STEPS_PER_BAR;
export const stepDuration = (bpm: number) => 60 / bpm / 4;
export const isOn = (beat: Beat, row: string, step: number) => beat.grid[row]?.includes(step) ?? false;

export function setStep(beat: Beat, row: string, step: number, on: boolean) {
  const steps = (beat.grid[row] ?? []).filter((s) => s !== step);
  if (on) steps.push(step);
  beat.grid[row] = steps.sort((a, b) => a - b);
}

/** Copies one bar onto the next, so a variation starts from what already works. */
export function copyBar(beat: Beat, fromBar: number) {
  const start = fromBar * STEPS_PER_BAR;
  for (const [row, steps] of Object.entries(beat.grid)) {
    const kept = steps.filter((s) => s < start + STEPS_PER_BAR || s >= start + 2 * STEPS_PER_BAR);
    const copied = steps.filter((s) => s >= start && s < start + STEPS_PER_BAR).map((s) => s + STEPS_PER_BAR);
    beat.grid[row] = [...new Set([...kept, ...copied])].sort((a, b) => a - b);
  }
}

export function partOfRow(row: string): Part {
  if (row.startsWith('bass')) return 'bass';
  if (row.startsWith('lead')) return 'lead';
  return 'drums';
}

/** Rows number scale degrees from the bottom: 0 is the root, 7 the octave above. */
export function rowMidi(beat: Beat, part: 'bass' | 'lead', degree: number): number {
  const scale = SCALES[beat.scale];
  const octaves = Math.floor(degree / scale.length);
  return beat.root + (PART_OCTAVE[part] + 1 + octaves) * 12 + scale[degree % scale.length];
}

export function rowsAtStep(beat: Beat, step: number): string[] {
  return Object.keys(beat.grid).filter((row) => !beat.muted.includes(row) && isOn(beat, row, step));
}

/** When a step sounds, counted from the start of the loop. */
export function stepTime(step: number, bpm: number, swing: number): number {
  const duration = stepDuration(bpm);
  return step * duration + (step % 2 === 1 ? swing * duration * 0.5 : 0);
}

/** The step a live tap belongs to: whichever scheduled step is closest in time. */
export function nearestStep(now: number, scheduled: { time: number; step: number }[]): number | null {
  let best: { time: number; step: number } | null = null;
  for (const entry of scheduled) {
    if (!best || Math.abs(entry.time - now) < Math.abs(best.time - now)) best = entry;
  }
  return best ? best.step : null;
}

// ---------- Starting points ----------

interface Preset {
  name: string;
  bpm: number;
  swing: number;
  root: number;
  scale: ScaleName;
  /** Drums use "x"; bass and lead use the scale degree as a digit. Each 16 characters is a bar. */
  drums: Record<string, string>;
  bass?: string;
  lead?: string;
}

export const PRESETS: Preset[] = [
  {
    name: 'Boom Bap', bpm: 90, swing: 0.3, root: 9, scale: 'minor',
    drums: { kick: 'x.....x...x.....', snare: '....x.......x...', hat: 'x.x.x.x.x.x.x.x.' },
    bass: '0.....0...2.....0.....0...4...3.',
  },
  {
    name: 'Trap', bpm: 140, swing: 0, root: 5, scale: 'minor',
    drums: { kick: 'x.....x.......x.', snare: '........x.......', hat: 'x.x.x.x.x.xxx.x.', open: '..............x.' },
    bass: '0.....0.......3.0.....0.......5.',
    lead: '4...2...0.......4...2...3...2...',
  },
  {
    name: 'House', bpm: 124, swing: 0, root: 2, scale: 'minor',
    drums: { kick: 'x...x...x...x...', clap: '....x.......x...', hat: '..x...x...x...x.', open: '..x.......x.....' },
    bass: '..0...0...0..3....0...0...0..4..',
  },
  {
    name: 'Pop', bpm: 110, swing: 0, root: 0, scale: 'major',
    drums: { kick: 'x.....x.x.......', snare: '....x.......x...', hat: 'x.x.x.x.x.x.x.x.' },
    bass: '0.......4.......5.......3.......',
    lead: '2.4.5...4.2.....5.4.2...1.......',
  },
  {
    name: 'Lo-fi', bpm: 78, swing: 0.4, root: 4, scale: 'minor',
    drums: { kick: 'x.......x.x.....', snare: '....x.......x...', hat: 'x.x.x.x.x.x.x.xx', perc: '..............x.' },
    bass: '0.......3.......5.......4.......',
    lead: '7...4...5...2...4...2...1.......',
  },
];

export function beatFromPreset(preset: Preset): Beat {
  const beat = emptyBeat(preset.name);
  beat.bpm = preset.bpm;
  beat.swing = preset.swing;
  beat.root = preset.root;
  beat.scale = preset.scale;
  const melodies = [preset.bass, preset.lead].filter(Boolean) as string[];
  beat.bars = Math.max(1, ...melodies.map((m) => m.length / STEPS_PER_BAR));

  for (const [row, pattern] of Object.entries(preset.drums)) {
    for (let bar = 0; bar < beat.bars; bar++) {
      [...pattern].forEach((c, i) => {
        if (c === 'x') setStep(beat, row, bar * STEPS_PER_BAR + i, true);
      });
    }
  }
  const melody = (part: 'bass' | 'lead', pattern?: string) => {
    [...(pattern ?? '')].forEach((c, i) => {
      if (c !== '.') setStep(beat, `${part}${c}`, i, true);
    });
  };
  melody('bass', preset.bass);
  melody('lead', preset.lead);
  return beat;
}

// ---------- Export ----------

/** Enough repeats that a one-bar loop still gives a usable clip. */
export function exportLoops(beat: Beat): number {
  return Math.max(2, Math.ceil(8 / beat.bars));
}

export function encodeWav(channels: Float32Array[], sampleRate: number): ArrayBuffer {
  const frames = channels[0].length;
  const blockAlign = channels.length * 2;
  const buffer = new ArrayBuffer(44 + frames * blockAlign);
  const view = new DataView(buffer);
  const text = (offset: number, value: string) => {
    for (let i = 0; i < value.length; i++) view.setUint8(offset + i, value.charCodeAt(i));
  };
  text(0, 'RIFF');
  view.setUint32(4, 36 + frames * blockAlign, true);
  text(8, 'WAVE');
  text(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, channels.length, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * blockAlign, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, 16, true);
  text(36, 'data');
  view.setUint32(40, frames * blockAlign, true);
  let offset = 44;
  for (let frame = 0; frame < frames; frame++) {
    for (const channel of channels) {
      const sample = Math.max(-1, Math.min(1, channel[frame]));
      view.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
      offset += 2;
    }
  }
  return buffer;
}

export function beatToMidi(beat: Beat): Uint8Array {
  const midi = new Midi();
  midi.header.setTempo(beat.bpm);
  midi.name = beat.name;
  const drums = midi.addTrack();
  drums.name = 'Trống';
  drums.channel = 9;
  const bass = midi.addTrack();
  bass.name = 'Bass';
  const lead = midi.addTrack();
  lead.name = 'Giai điệu';
  const duration = stepDuration(beat.bpm);

  for (let step = 0; step < stepCount(beat); step++) {
    const time = stepTime(step, beat.bpm, beat.swing);
    for (const row of rowsAtStep(beat, step)) {
      const part = partOfRow(row);
      if (part === 'drums') {
        const note = DRUMS.find((d) => d.id === row)?.midi;
        if (note !== undefined) drums.addNote({ midi: note, time, duration });
      } else {
        const pitch = rowMidi(beat, part, Number(row.slice(4)));
        (part === 'bass' ? bass : lead).addNote({ midi: pitch, time, duration: duration * 2 });
      }
    }
  }
  return midi.toArray();
}
